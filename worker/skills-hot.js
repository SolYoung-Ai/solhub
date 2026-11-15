/**
 * Skill 今日热门 · 每日抓取引擎
 * =====================================================
 *
 * 给 /skills/ 页面的「今日热门」栏供货：从 GitHub 全网搜热门 Skill，
 * solhub-cron 每天跑一轮、写进 kv:skills:hot:v1，读取侧（/skills-hot）只读。
 *
 * 为什么不用 skills.sh：它是个纯 JS 流式渲染站（Next.js RSC），没有公开 API，
 * 云函数里刮 HTML 既慢又脆。GitHub Search API 才是「全网最火」的可验证来源：
 *   1. 只收仓库根目录真实存在 SKILL.md 的（Agent Skills 规范：一个 Skill = 一个
 *      含 SKILL.md 的目录），name / description 直接读 frontmatter 原文，不生成不翻译不推测；
 *   2. 每条都带可点击核验的 GitHub 源文件链接（rawUrl）；
 *   3. fork / archived 一律排除。
 *
 * 可达性（2026-11-16 从 CloudBase 上海实测）：api.github.com 与
 * raw.githubusercontent.com 都通（200，<1s），unauthenticated 搜索限额
 * 10 次/分钟——本引擎一轮只发 4 次搜索 + 最多 40 次 raw 读取，安全。
 *
 * 描述翻译：复用热点那套 translateBatch（Pollinations 免费 LLM），
 * 翻译失败的条目沿用昨天的中文描述（按 repo 对齐旧数据），绝不展示半条坏数据。
 */

import { translateBatch } from "./translate.js";

/** 快照在 kv 表里的键；改结构时升版本号，旧键留给回滚 */
const SKILLS_HOT_KEY = "skills:hot:v1";

/** 最终榜单条数。精选区已有 46 条，热门栏一屏能扫完就行 */
const SKILLS_HOT_LIMIT = 24;

/** raw SKILL.md / GitHub API 的单次超时 */
const GH_TIMEOUT = 10000;

/** 搜索查询。前三条是「全时段热门」，最后一条专挖最近 7 天冒出来的新星。
    topic 是 GitHub 的官方维度，agent-skills / claude-skills 覆盖了绝大多数
    真正的 Skill 仓库；加 fork:false archived:false 挡掉搬运号和弃坑仓库。 */
function ghQueries(sinceDays = 7) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  return [
    `topic:agent-skills topic:claude-skills fork:false archived:false sort:stars`,
    `topic:agent-skills fork:false archived:false stars:>80 sort:stars`,
    `topic:claude-skills fork:false archived:false stars:>30 sort:stars`,
    `topic:agent-skills fork:false archived:false pushed:>${since} stars:>10 sort:updated`,
  ];
}

/** 官方组织：加「官方」徽标 */
const OFFICIAL_OWNERS = new Set(["anthropics", "openai"]);

/** 一句话描述里混进了 YAML 换行 / 引号的，压成单行 */
function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim();
}

/** 解析 SKILL.md 的 YAML frontmatter，取 name 与 description */
function parseFrontmatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(String(text || ""));
  if (!m) return null;
  const fm = m[1];
  const name = oneLine(/(?:^|\n)name:\s*([^\n]+)/.exec(fm)?.[1] || "");
  const desc = oneLine(/(?:^|\n)description:\s*([^\n]+)/.exec(fm)?.[1] || "");
  if (!name || name.length < 3 || desc.length < 12) return null;
  /* 模板占位（anthropics/skills 的 template-skill 这类）和纯符号名直接丢 */
  if (/replace with|placeholder|TODO:?|lorem ipsum/i.test(desc)) return null;
  return { name, desc };
}

/**
 * 发请求并把 body 读完，整个过程（连接 + 响应头 + body）都在同一个
 * AbortController 罩内。为什么要连 body 一起罩：之前只罩 fetch()，
 * 响应头一到定时器就被清掉，结果某个仓库的 body 流在 SCF 网关上卡死，
 * res.text() 永远悬着——整轮抓取就这么挂满 300 秒超时，云上实测复现。
 */
/** race 硬超时：到点直接返回 null 继续走。云函数环境实测 AbortController
    偶发不打断悬死的 socket（SCF 出网链路），所以 abort 只当资源回收手段，
    真正的时限靠 race 兜底——宁可丢一个仓库，不能悬死整轮。 */
function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function ghFetchText(url, env) {
  const headers = { "User-Agent": "solhub-skills-hot", Accept: "application/vnd.github+json" };
  const token = (env && (env.GITHUB_TOKEN || env.GITHUB_PAT)) || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GH_TIMEOUT);
  const work = (async () => {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    /* 流式读 body，超 3MB 直接放弃——tree 接口对超大仓库能吐几十 MB，
       全量 res.text() 会把 256MB 的小内存函数逼进 GC 假死（定时器全饿死） */
    if (!res.body) return await res.text();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > 3_000_000) {
        ctrl.abort();
        return null;
      }
    }
    text += decoder.decode();
    return text;
  })();
  try {
    return await withTimeout(work, GH_TIMEOUT + 2000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 同上，但解析 JSON（search API 用） */
async function ghFetchJSON(url, env) {
  const text = await ghFetchText(url, env);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 一个仓库里可疑的 SKILL.md 路径太多时，单仓最多收几条（防大合集刷屏） */
const MAX_PER_REPO = 2;

/** 仓库里 SKILL.md 超过这个数就是「清单堆放库」（awesome 类搬运库）：
    一堆编号文件夹 + 百来个随手写的 skill，热度全靠仓库本身的 star，
    收进热门栏只会刷屏。整仓剔除，精选区已经覆盖了这类合集。 */
const DUMP_THRESHOLD = 20;

/** 列出仓库里的 SKILL.md 路径；isDump=true 表示这是个堆放库，整仓跳过。
    没有任何 SKILL.md 返回 null（不是 Skill 仓库，跳过）。 */
async function listSkillPaths(fullName, branch, env) {
  try {
    /* 先按文本收，超 3MB 判为超大仓库放弃解析——这是第二道内存防线 */
    const text = await ghFetchText(
      `https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      env,
    );
    if (!text) return null;
    if (text.length > 3_000_000) return { isDump: true, paths: [], tooBig: true };
    const body = JSON.parse(text);
    if (!Array.isArray(body.tree)) return null;
    const paths = body.tree
      .filter(
        (t) =>
          t.type === "blob" &&
          (t.path === "SKILL.md" || t.path.endsWith("/SKILL.md")) &&
          !/(^|\/)(node_modules|test|tests|fixtures|examples?|archive)\//.test(t.path),
      )
      .map((t) => t.path);
    if (!paths.length) return null;
    if (paths.length > DUMP_THRESHOLD) return { isDump: true, paths: [] };
    return {
      isDump: false,
      /* 浅的优先：根目录 > 一级目录 > 更深。太深的多半是示例或文档 */
      paths: paths.sort((a, b) => a.split("/").length - b.split("/").length).slice(0, MAX_PER_REPO),
    };
  } catch {
    return null;
  }
}

/** 抓单个 SKILL.md 并解析 frontmatter */
async function fetchDoc(fullName, branch, path) {
  const url = `https://raw.githubusercontent.com/${fullName}/${branch}/${path}`;
  try {
    const text = await ghFetchText(url, null);
    if (!text) return null;
    const fm = parseFrontmatter(text);
    if (!fm) return null;
    return { ...fm, rawUrl: url, blobUrl: `https://github.com/${fullName}/blob/${branch}/${path}` };
  } catch {
    return null;
  }
}

/**
 * 抓一轮。返回 { ok, date, updatedAt, items, stored, translation, queries }。
 * 全部搜索失败时 ok:false（上层保留昨天的旧数据，不清空）。
 */
async function collectSkillsHot(env, opts = {}) {
  const startedAt = Date.now();
  const now = new Date();
  const queries = ghQueries();
  const repoMap = new Map(); // full_name -> repo 对象（search API 的原始数据 + 来源标记）
  const queryReports = [];

  for (const q of queries) {
    try {
      const body = await ghFetchJSON(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=25`,
        env,
      );
      if (!body) {
        queryReports.push({ q, ok: false, error: "fetch/parse failed" });
        continue;
      }
      const items = Array.isArray(body.items) ? body.items : [];
      for (const r of items) {
        if (!r || r.fork || r.archived) continue;
        /* 同一仓库多查询命中取 stars 大者（其实相同，防抖而已） */
        const prev = repoMap.get(r.full_name);
        if (!prev || (r.stargazers_count || 0) > (prev.stargazers_count || 0)) {
          repoMap.set(r.full_name, r);
        }
      }
      queryReports.push({ q, ok: true, count: items.length });
    } catch (err) {
      queryReports.push({ q, ok: false, error: String((err && err.message) || err) });
    }
  }

  console.log(`[skills] 搜索完成 ${queryReports.filter((x) => x.ok).length}/${queries.length}，候选 ${repoMap.size}`);
  const okQueries = queryReports.filter((x) => x.ok);
  if (!okQueries.length) {
    return { ok: false, error: "所有 GitHub 搜索都失败", queries: queryReports, items: [] };
  }

  /* 验 SKILL.md：光靠 star 排不行——大量高星仓库根本没有 SKILL.md（它们是普通
     工具库），不验证就会出一堆点进去没内容的卡。每个仓库一次 trees 调用拿全
     文件树，挑最浅的几条 SKILL.md（热门仓库的 skill 几乎都在子目录里）。 */
  const candidates = [...repoMap.values()]
    /* size 是仓库体积（KB）：超大仓库的 recursive 树能到几十 MB，解析会把
       函数内存打爆（云上实测 433 OOM），直接跳过——它们多半也不是 Skill 仓库 */
    .filter((r) => !r.size || r.size < 60000)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 20);
  const verified = [];
  console.log(`[skills] trees 开始，候选 ${candidates.length}`);
  for (let i = 0; i < candidates.length; i += 4) {
    const batch = candidates.slice(i, i + 4);
    console.log(`[skills] trees batch ${i / 4 + 1}: ${batch.map((r) => r.full_name).join(", ")}`);
    const results = await Promise.all(
      batch.map(async (r) => {
        const branch = r.default_branch || "main";
        const listed = await listSkillPaths(r.full_name, branch, env);
        if (!listed || listed.isDump) return { repo: r, docs: [] };
        const docs = (
          await Promise.all(listed.paths.map((path) => fetchDoc(r.full_name, branch, path)))
        ).filter(Boolean);
        return { repo: r, docs };
      }),
    );
    for (const { repo, docs } of results) for (const doc of docs) verified.push({ repo, doc });
    console.log(`[skills] trees batch ${i / 4 + 1} 完成，已验证 ${verified.length}`);
  }

  /* 热度分：star 为主（对数压量级），最近推送加新鲜度分。 */
  const nowMs = now.getTime();
  const scored = verified.map(({ repo, doc }) => {
    const stars = repo.stargazers_count || 0;
    const days = Math.max(0, (nowMs - Date.parse(repo.pushed_at || now.toISOString())) / 86400000);
    const score = Math.log10(stars + 1) * 40 + Math.max(0, 14 - days) * 3;
    return {
      repo: repo.full_name,
      name: doc.name,
      descEn: doc.desc.slice(0, 200),
      stars,
      pushedAt: repo.pushed_at || "",
      official: OFFICIAL_OWNERS.has(String(repo.full_name).split("/")[0]),
      url: doc.blobUrl || `https://github.com/${repo.full_name}`,
      rawUrl: doc.rawUrl,
      score,
    };
  });

  /* 同名去重（不同仓库的 frontmatter 可能撞名），分高者留 */
  const byName = new Map();
  for (const it of scored.sort((a, b) => b.score - a.score)) {
    if (!byName.has(it.name)) byName.set(it.name, it);
  }
  const picked = [...byName.values()].slice(0, SKILLS_HOT_LIMIT);

  /* 描述翻译：与热点同一套批翻。失败时沿用旧中文描述，还没有就展示英文原文。 */
  const oldByRepo = new Map();
  for (const it of opts.old || []) if (it && it.repo) oldByRepo.set(it.repo, it);
  const pending = picked.filter((it) => !oldByRepo.get(it.repo)?.desc).map((it) => it.descEn);
  let translation = { tried: 0, done: 0 };
  if (pending.length) {
    try {
      const batch = await translateBatch(pending, "summary", { budgetMs: opts.budgetMs || 150000 });
      /* translateBatch 返回 { out, provider }，不是数组 */
      const translated = (batch && Array.isArray(batch.out)) ? batch.out : [];
      translation = { tried: pending.length, done: translated.filter(Boolean).length };
      console.log(`[skills] 翻译完成 ${translation.done}/${translation.tried}`);
      const queue = [...translated];
      for (const it of picked) {
        const prev = oldByRepo.get(it.repo);
        if (it.descEn && pending.includes(it.descEn)) {
          const zh = queue.shift();
          it.desc = zh || prev?.desc || "";
        } else {
          it.desc = prev?.desc || "";
        }
      }
    } catch {
      translation = { tried: pending.length, done: 0 };
      for (const it of picked) it.desc = oldByRepo.get(it.repo)?.desc || "";
    }
  } else {
    /* 今天没新面孔：沿用旧描述即可，不花翻译额度 */
    for (const it of picked) it.desc = oldByRepo.get(it.repo)?.desc || "";
  }

  const items = picked.map(({ score, ...rest }) => ({ ...rest, translated: !!rest.desc && rest.desc !== rest.descEn }));

  return {
    ok: true,
    date: now.toISOString().slice(0, 10),
    updatedAt: now.toISOString(),
    items,
    stored: items.length,
    translation,
    queries: queryReports,
    elapsed: Date.now() - startedAt,
  };
}

export { SKILLS_HOT_KEY, SKILLS_HOT_LIMIT, collectSkillsHot, parseFrontmatter, ghQueries };
