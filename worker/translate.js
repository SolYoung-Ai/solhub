/**
 * SolHub 热点 · 翻译层
 * =====================================================
 *
 * 站内读者是中文，但「全球媒体」里只有一部分是中文供稿。英文源要能进榜，
 * 就得在抓取这一侧把标题与摘要翻成中文 —— 读者点进卡片仍跳原站看原文，
 * 这里翻的是索引，不是内容。
 *
 * 为什么不在浏览器里翻：
 *   1. 每个访客各翻一次，等于把翻译服务当自家 CDN 用；
 *   2. 翻完的结果进不了库，去重、分类、搜索全都做在英文原标题上，命中率差；
 *   3. 前端翻意味着首屏白等一次网络往返。
 *
 * provider 链：
 *   pollinations（免费 LLM，质量最好，能处理数字与专有名词）
 *     → mymemory（免费机翻，配额小，兜底用）
 *     → 都不行就返回空，条目留在库里等下一轮重试，不展示未翻译的英文。
 *
 * 批处理是必须的：单条调用要 2~4 秒，一轮二三十条就顶满函数超时。
 * 这里一次送 12 条，让模型按行输出，行数不匹配就判整批失败 —— 宁可重试，
 * 也不要错位（错位会把 A 的译文贴到 B 的标题上，比不翻更糟）。
 */

import { toSimplified, needsT2S } from "./t2s.js";

/** 单批最多几条。超过这个数，模型容易漏行。 */
const BATCH_SIZE = 12;

/** 翻译请求超时。LLM 一批要 20~40 秒，给足余量。 */
const LLM_TIMEOUT = 60000;
const MYMEMORY_TIMEOUT = 12000;

const LLM_ENDPOINT = "https://text.pollinations.ai/openai";
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

const TITLE_PROMPT =
  "把下面的英文科技新闻标题逐条翻译成简体中文。要求：\n" +
  "1. 只输出译文，每行一条，顺序与原文一致；\n" +
  "2. 不要编号、不要引号、不要解释、不要空行；\n" +
  "3. 公司名与产品名保留英文（如 OpenAI、NVIDIA、iPhone）；\n" +
  "4. 数字、金额、百分比必须保留，不要改写成「数十亿」这种模糊说法；\n" +
  "5. 译文要像中文科技媒体的标题，不要逐词直译。";

const SUMMARY_PROMPT =
  "把下面的英文新闻摘要逐条翻译成简体中文。要求：\n" +
  "1. 只输出译文，每行一条，顺序与原文一致；\n" +
  "2. 不要编号、不要引号、不要解释、不要空行；\n" +
  "3. 每条不超过 60 个汉字，句子要完整；\n" +
  "4. 公司名与产品名保留英文。";

/* ---------------------------------------------------------------- 工具 */

/** 去掉模型偶尔加回来的序号、项目符号、包裹引号 */
function stripLine(line) {
  return String(line || "")
    .replace(/^\s*(\d{1,3}\s*[.、)．]|[-*•·])\s*/, "")
    .replace(/^["'「『]|["'」』]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 译文是否「像中文」：至少要有相当比例的中文字符，否则当成翻译失败 */
function looksChinese(text) {
  if (!text) return false;
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (han === 0) return false;
  /* 纯英文标题里专有名词很多（OpenAI、NVIDIA…），所以看的是汉字占比而不是英文有无 */
  return han >= Math.max(2, Math.floor((han + letters) * 0.25));
}

/* ---------------------------------------------------------------- Pollinations */

async function translateWithLLM(lines, prompt, timeout) {
  if (!lines.length) return [];
  const first = await translateOnceLLM(lines, prompt, timeout);
  if (first) return first;
  /* 重试一次。免费端点的失败多是偶发（连接被掐、返回半截），
     隔两秒重发通常就过了；不重试的话一批 12 条会整批作废。 */
  await new Promise((r) => setTimeout(r, 2000));
  return translateOnceLLM(lines, prompt, timeout);
}

async function translateOnceLLM(lines, prompt, timeout) {

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(LLM_ENDPOINT, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages: [{ role: "user", content: `${prompt}\n\n${lines.join("\n")}` }],
        temperature: 0.2,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? String(data.choices[0].message.content || "")
        : "";
    const out = content
      .split("\n")
      .map(stripLine)
      .filter((x) => x.length > 0);

    /* 行数不一致就不敢用：错位会把 A 的译文贴到 B 头上。
       多出来的是模型自言自语，少了的是漏行，两种都判失败。 */
    if (out.length !== lines.length) return null;
    if (!out.every(looksChinese)) return null;
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- MyMemory */

async function translateOneMyMemory(text) {
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MYMEMORY_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return "";
    const data = await res.json();
    const t =
      data && data.responseData && typeof data.responseData.translatedText === "string"
        ? data.responseData.translatedText
        : "";
    return looksChinese(t) ? t : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- 对外 */

/**
 * 批量翻译一组文本。
 *
 * @param {string[]} lines 待翻文本（英文）
 * @param {"title"|"summary"} kind 决定用哪套 prompt 与长度上限
 * @param {{ budgetMs?: number }} opts
 * @returns {Promise<{ out: string[], provider: string }>} out 与 lines 等长，失败位置为空串
 */
async function translateBatch(lines, kind, opts = {}) {
  const list = lines.map((x) => String(x || "").trim().slice(0, kind === "title" ? 200 : 400));
  const out = new Array(list.length).fill("");
  if (!list.length) return { out, provider: "none" };

  const prompt = kind === "title" ? TITLE_PROMPT : SUMMARY_PROMPT;
  /* 默认 190 秒：一批 12 条约 35 秒，36 条要 3 批 ≈ 105 秒，再加冷启动与重试余量。
     这个值曾经写成 90 秒，结果第 3 批被 deadline 截断，日志里表现为「翻译 12/36」——
     看起来像限流，其实是自己把时间掐了。 */
  const deadline = Date.now() + (opts.budgetMs || 190000);

  for (let start = 0; start < list.length; start += BATCH_SIZE) {
    if (Date.now() > deadline) break;
    const chunk = list.slice(start, start + BATCH_SIZE);
    const remain = Math.max(8000, Math.min(LLM_TIMEOUT, deadline - Date.now()));

    const llm = await translateWithLLM(chunk, prompt, remain);
    if (llm) {
      llm.forEach((t, i) => {
        out[start + i] = t;
      });
      continue;
    }

    /* LLM 整批失败：只对这批里的短文本逐条走机翻兜底。
       长文本一条要好几秒，且 mymemory 配额按字符算，不能无节制地用。 */
    for (let i = 0; i < chunk.length; i += 1) {
      if (Date.now() > deadline) break;
      const t = await translateOneMyMemory(chunk[i].slice(0, 180));
      if (t) out[start + i] = t;
    }
  }

  const done = out.filter(Boolean).length;
  const provider = done === list.length ? "llm" : done > 0 ? "mixed" : "none";
  return { out, provider };
}

/** 清理译文里的繁体、多余空白 */
function normalizeZh(text) {
  let t = String(text || "").trim();
  if (needsT2S(t)) t = toSimplified(t);
  return t.replace(/\s+/g, " ").replace(/\s+([，。！？；：、])/g, "$1").trim();
}

export {
  translateBatch,
  normalizeZh,
  needsT2S,
  toSimplified,
  looksChinese,
  stripLine,
  BATCH_SIZE,
};
