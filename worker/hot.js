/**
 * SolHub 热点抓取引擎
 * =====================================================
 *
 * 抓一批中文科技媒体的 RSS，归一化成统一条目，供 /hot 页面消费。
 *
 * 为什么只用中文源、不做翻译：
 *   站内读者是中文。英文源（TechCrunch / HN / OpenAI）要变成可读中文就得调翻译，
 *   每条一次 API 调用、还有失败重试与成本问题；而这批中文媒体的价值恰恰在于
 *   它们已经在做人肉编译 —— IT之家、量子位、极客公园对海外新闻的覆盖是小时级的。
 *   用它们的稿子比自己机翻质量高、成本为零、还不违反转载边界（只取标题+链接，
 *   正文一律跳原站）。
 *
 * 只存标题 / 链接 / 来源 / 时间 / 一句摘要，不存正文、不镜像图片 —— 这是
 * 「导流式聚合」，不是内容转载。页面上每条都跳回原站。
 *
 * 缓存策略：每轮只抓到各源最新的几十条，靠 mergeItems() 与库里的历史累加，
 * 所以短时抖动（某个源 502）不会让已展示的内容消失。
 */

/** 数据源。weight 只用于同时间桶内的排序微调，不影响分类。 */
const FEEDS = [
  { id: "ithome", name: "IT之家", url: "https://www.ithome.com/rss/", category: "tech", weight: 10 },
  { id: "qbitai", name: "量子位", url: "https://www.qbitai.com/feed", category: "ai", weight: 9 },
  { id: "geekpark", name: "极客公园", url: "https://www.geekpark.net/rss", category: "product", weight: 9 },
  { id: "ifanr", name: "爱范儿", url: "https://www.ifanr.com/feed", category: "product", weight: 8 },
  { id: "leiphone", name: "雷锋网", url: "https://www.leiphone.com/feed", category: "ai", weight: 8 },
  { id: "tmtpost", name: "钛媒体", url: "https://www.tmtpost.com/rss.xml", category: "tech", weight: 7 },
  { id: "oschina", name: "开源中国", url: "https://www.oschina.net/news/rss", category: "tech", weight: 6 },
  { id: "solidot", name: "Solidot", url: "https://www.solidot.org/index.rss", category: "tech", weight: 6 },
  { id: "sspai", name: "少数派", url: "https://sspai.com/feed", category: "product", weight: 5 },
  { id: "wallstreetcn", name: "华尔街见闻", url: "https://dedicated.wallstreetcn.com/rss.xml", category: "finance", weight: 8 },
];

/*
 * 雪球 hots/topic 曾经在列表里，压测后拿掉了：它推的是股民长文（「题材炒作和价值
 * 投资的根本逻辑」），不是「热点」，而且一轮 20 条会把首页刷满。金融板块留给
 * 华尔街见闻的快讯，时效性和新闻性都更对。 */

/** 分类中文名（前端与接口共用，避免两边各写一份） */
const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "ai", label: "AI" },
  { id: "product", label: "产品" },
  { id: "tech", label: "科技" },
  { id: "finance", label: "金融" },
];

/** 单次抓取超时。雷锋网单个请求要 4~16 秒且波动大，给足 20 秒；整轮并发，
    最慢的源决定一轮耗时，函数超时设 60 秒，余量足够。 */
const FEED_TIMEOUT = 20000;
/** 库里最多保留多少条（约 3~4 天量） */
const MAX_ITEMS = 400;
/** 超过这个时长的条目不再保留 */
const MAX_AGE_MS = 72 * 3600 * 1000;

/* ---------------------------------------------------------------- 文本处理 */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”",
  lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–", hellip: "…", middot: "·", times: "×",
};

function decodeEntities(s) {
  return String(s || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const v = ENTITIES[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** 去 CDATA、去标签、解实体、压空白 */
function cleanText(s) {
  let t = String(s || "");
  /* 两轮清洗：不少源把整段 HTML 又实体转义了一遍（&lt;p&gt;），一轮下来标签会以
     字面量形式留在摘要里（页面上显示成「<p data-vmark=...>」）。第二轮处理解出来的
     新标签与新实体。 */
  for (let i = 0; i < 2; i += 1) {
    t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    t = decodeEntities(t);
    t = t.replace(/<[^>]*>/g, " ");
  }
  return t.replace(/\s+/g, " ").trim();
}

/* 电商促销帖过滤器。IT之家一类媒体站会把「双11 返场领 1.1 元红包」「松下台灯史低」
   混在新闻流里，混进热点榜就是噪音 —— 读者来这里不是找优惠券的。 */
const NOISE_RE = /(红包|优惠券|领券|满减|拼单|秒杀|百亿补贴|史低|好价|绝对值|下单立减|到手价|低至|新低|【\d{1,2}:\d{2}[~-]\d{1,2}:\d{2}】)/;

/** 32 位 FNV-1a：给条目生成稳定 id（同一链接每轮得到同一个 id，前端才能判断新增） */
function hashId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

/** 链接规范化：去掉 utm_* / from / spm 等跟踪参数，避免同一内容被当成两条 */
function normalizeUrl(raw, base) {
  let u;
  try {
    u = new URL(String(raw || "").trim(), base || undefined);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(u.protocol)) return "";
  const drop = [];
  u.searchParams.forEach((_, k) => {
    if (/^(utm_|spm|from|share_|ref$|source$|src$)/i.test(k)) drop.push(k);
  });
  for (const k of drop) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}

/** 摘要：描述字段去掉标签后截断，只做一句话导语 */
function makeSummary(raw, title) {
  let text = cleanText(raw);
  if (!text) return "";
  /* 很多源的 description 就是「标题 + 正文」，摘要把标题再念一遍很难看 */
  const head = title.replace(/\s+/g, "");
  if (head && text.replace(/\s+/g, "").startsWith(head)) text = text.slice(head.length).trim();
  if (!text) return "";
  return text.length > 160 ? `${text.slice(0, 158).trimEnd()}…` : text;
}

/* ---------------------------------------------------------------- 分类判定 */

const AI_RE = /(人工智能|大模型|智能体|多模态|机器学习|深度学习|神经网络|算力|推理芯片|具身智能|ai\b|aigc|llm|gpt|chatgpt|openai|anthropic|claude|gemini|deepseek|kimi|豆包|通义|文心|混元|sora|midjourney|英伟达|nvidia|hugging ?face|transformer)/i;
const FIN_RE = /(股价|涨停|跌停|财报|营收|净利|亏损|融资|并购|ipo|上市|退市|央行|美联储|降息|加息|利率|汇率|国债|债券|基金|a股|港股|美股|纳斯达克|恒生|比特币|以太坊|加密|cpi|gdp|关税|市值)/i;
const PRODUCT_RE = /(发布|上线|开卖|发售|新品|新版|更新|升级|降价|预售|公测|内测|众筹|开源)/i;

/**
 * 分类优先级：AI 关键词 > 金融关键词 > 源默认分类。
 * 源默认兜底，所以哪怕标题看不懂，也不会掉到「未分类」。
 */
function classify(title, feed) {
  if (AI_RE.test(title)) return "ai";
  if (FIN_RE.test(title)) return "finance";
  if (feed.category !== "finance" && PRODUCT_RE.test(title)) return "product";
  return feed.category;
}

/* ------------------------------------------------------------------ 解析 */

/** 从一段 XML 里取出 item/entry 块（RSS 用 item，Atom 用 entry） */
function splitEntries(xml) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  if (items.length) return items;
  return xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
}

function pickTag(block, tags) {
  for (const tag of tags) {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
    if (m && m[1]) return m[1];
  }
  return "";
}

function pickLink(block, base) {
  const plain = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i.exec(block);
  if (plain && plain[1]) {
    /* 有的源整个 URL 包在 CDATA 里（Solidot 就是 <link><![CDATA[...]]></link>），
       直接拿原文会被下面的「含尖括号」判断挡掉，这里先拆壳。 */
    const inner = String(plain[1]).trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    if (inner && !/<[a-z/]/i.test(inner)) {
      const v = normalizeUrl(inner, base);
      if (v) return v;
    }
  }
  /* Atom：<link rel="alternate" href="..."/> */
  const atom = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i.exec(block);
  if (atom) return normalizeUrl(decodeEntities(atom[1]), base);
  const guid = /<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i.exec(block);
  if (guid && /^https?:/i.test(cleanText(guid[1]))) return normalizeUrl(cleanText(guid[1]), base);
  return "";
}

function parseDate(raw) {
  const text = cleanText(raw);
  if (!text) return 0;
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : 0;
}

/** 解析一个源的 XML → 条目数组 */
function parseFeed(xml, feed, now) {
  const out = [];
  const seenTitle = new Set();
  for (const block of splitEntries(xml)) {
    const title = cleanText(pickTag(block, ["title"]));
    if (!title || title.length < 4) continue;
    if (NOISE_RE.test(title)) continue;
    /* 同一源内标题完全重复（多见于分页/置顶重推）只留第一条 */
    const titleKey = title.replace(/[\s\p{P}]/gu, "").slice(0, 40);
    if (seenTitle.has(titleKey)) continue;
    seenTitle.add(titleKey);
    const url = pickLink(block, feed.url);
    if (!url) continue;
    const ts = parseDate(pickTag(block, ["pubDate", "published", "updated", "dc:date"]));
    const summary = makeSummary(pickTag(block, ["description", "summary", "content:encoded"]), title);
    out.push({
      id: hashId(url),
      title: title.slice(0, 140),
      url,
      source: feed.id,
      sourceName: feed.name,
      category: classify(title, feed),
      publishedAt: ts ? new Date(ts).toISOString() : new Date(now).toISOString(),
      summary: summary && summary !== title ? summary : "",
    });
  }
  return out;
}

/* ---------------------------------------------------------------- 抓取 */

async function fetchFeed(feed, now) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        /* 不带 UA 会被部分站点直接 403；带自己的标识方便对方统计来源 */
        "user-agent": "Mozilla/5.0 (compatible; SolHubHot/1.0; +https://solhub.solyoung.top/hot/)",
        accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return { feed: feed.id, ok: false, error: `HTTP ${res.status}`, items: [] };
    const xml = await res.text();
    const items = parseFeed(xml, feed, now);
    return { feed: feed.id, ok: true, items, empty: !items.length };
  } catch (err) {
    const error = err && err.name === "AbortError" ? "timeout" : String((err && err.message) || err);
    return { feed: feed.id, ok: false, error, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 合并新旧条目：按 id 去重，新的覆盖旧的（标题微调也能同步），
 * 再按发布时间倒序、砍掉过期与超量部分。
 */
function mergeItems(fresh, old, now) {
  const map = new Map();
  for (const item of old || []) {
    if (!item || !item.id || !item.url) continue;
    map.set(item.id, item);
  }
  for (const item of fresh || []) {
    if (!item || !item.id || !item.url) continue;
    map.set(item.id, item);
  }
  const floor = now - MAX_AGE_MS;
  const sorted = [...map.values()]
    .filter((x) => {
      const t = Date.parse(x.publishedAt);
      return Number.isFinite(t) && t >= floor;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  /* 跨源同标题去重：同一篇稿子常被两三家同时转载，列表里连着出现很潦草。
     时间倒序后先到的留下，后来的丢弃。 */
  const seenTitle = new Set();
  const deduped = [];
  for (const item of sorted) {
    const key = String(item.title || "").replace(/[\s\p{P}]/gu, "").slice(0, 40);
    if (key && seenTitle.has(key)) continue;
    if (key) seenTitle.add(key);
    deduped.push(item);
  }

  return spread(deduped).slice(0, MAX_ITEMS);
}

/**
 * 打散同源连排。
 * 起因：IT之家一天 60 条、量子位 10 条，纯按时间排会被单一来源刷屏，
 * 首页看上去像「IT之家镜像站」。规则是同源最多连排 2 条，超了就往后找
 * 下一条不同源的顶上 —— 只在本地重排，不丢任何条目。
 */
function spread(list, maxRun = 2) {
  const pool = list.slice();
  const out = [];
  let runSource = "";
  let runCount = 0;
  while (pool.length) {
    let idx = 0;
    if (runCount >= maxRun) {
      const alt = pool.findIndex((x) => x.source !== runSource);
      idx = alt === -1 ? 0 : alt;
    }
    const item = pool.splice(idx, 1)[0];
    if (item.source === runSource) runCount += 1;
    else {
      runSource = item.source;
      runCount = 1;
    }
    out.push(item);
  }
  return out;
}

/**
 * 抓全部源并返回合并结果。
 * @param {{ old?: any[], now?: number }} opts
 */
async function collectHot(opts = {}) {
  const now = Number(opts.now) || Date.now();
  const results = await Promise.all(FEEDS.map((f) => fetchFeed(f, now)));
  const fresh = results.flatMap((r) => r.items);
  const items = mergeItems(fresh, opts.old || [], now);
  return {
    fetchedAt: new Date(now).toISOString(),
    total: items.length,
    items,
    /* 单个源挂掉不影响整体，但要把情况带回去，方便排查「某个源长期没内容」 */
    feeds: results.map((r) => ({
      id: r.feed,
      ok: r.ok,
      count: r.items.length,
      ...(r.error ? { error: r.error } : {}),
    })),
  };
}

export { FEEDS, CATEGORIES, collectHot, mergeItems, parseFeed, classify, normalizeUrl, hashId, cleanText, spread };
