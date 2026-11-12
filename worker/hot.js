/**
 * SolHub 热点抓取引擎
 * =====================================================
 *
 * 抓一批中外科技媒体 / 金融机构 / 科学媒体的 RSS，归一化成统一条目，
 * 供 /hot 页面消费。
 *
 * 两条腿走路：
 *   1. 中文源（15 个）：中国大陆 + 港台。原样入库，零成本，质量最高 ——
 *      这批媒体本身就在做小时级编译。
 *   2. 全球源（19 个）：TechCrunch / The Verge / Ars Technica / WIRED /
 *      MIT Technology Review / The Information / Tech in Asia / The Decoder /
 *      Hacker News / Techmeme / Product Hunt / Google AI / WSJ / CNBC /
 *      MarketWatch / Barron's / Sifted / Nature / ScienceDaily。
 *      标题与摘要在云函数里翻成中文再入库，读者看到的一律是中文，
 *      点卡片仍跳原站看原文。
 *
 * 为什么翻译放在服务端：
 *   见 worker/translate.js 顶部。一句话 —— 翻一次给所有人看，比每次访客各翻一遍便宜。
 *
 * 未翻译的英文条目不进 items（前端看不到），留在库里等下一轮重试。
 * 宁可晚几分钟出现，也不要让英文标题混进一个中文站的热点流。
 *
 * 只存标题 / 链接 / 来源 / 时间 / 一句摘要，不存正文、不镜像图片 ——
 * 「导流式聚合」，不是内容转载。
 */

import { translateBatch, normalizeZh, needsT2S, toSimplified } from "./translate.js";

/**
 * 数据源。
 *   lang   原文语言（zh / en）
 *   region 地区，仅用于运维排查，不参与展示
 *   strict 只收「明显是科技/财经」的条目。
 *          综合站（界面新闻）和泛财经站（MarketWatch）会把副市长任命、
 *          「我该不该签婚后协议」这类内容混进同一个 feed，靠黑名单永远补不全，
 *          所以这几个源改成白名单：必须命中科技词或财经词才放行。
 *   cap    单轮最多取几条 —— 防单个大源把榜单冲垮（WIRED 一轮 50 条、
 *          Nature 一轮 75 条，不截断的话首页会变成它俩的镜像站）
 */
const FEEDS = [
  /* ---------------- 中文：大陆 ---------------- */
  { id: "ithome", name: "IT之家", url: "https://www.ithome.com/rss/", category: "tech", weight: 10, lang: "zh", region: "cn", cap: 14 },
  { id: "qbitai", name: "量子位", url: "https://www.qbitai.com/feed", category: "ai", weight: 10, lang: "zh", region: "cn", cap: 10 },
  { id: "geekpark", name: "极客公园", url: "https://www.geekpark.net/rss", category: "product", weight: 9, lang: "zh", region: "cn", cap: 10 },
  { id: "ifanr", name: "爱范儿", url: "https://www.ifanr.com/feed", category: "product", weight: 8, lang: "zh", region: "cn", cap: 10 },
  { id: "leiphone", name: "雷锋网", url: "https://www.leiphone.com/feed", category: "ai", weight: 8, lang: "zh", region: "cn", cap: 10 },
  { id: "tmtpost", name: "钛媒体", url: "https://www.tmtpost.com/rss.xml", category: "tech", weight: 7, lang: "zh", region: "cn", cap: 10 },
  { id: "oschina", name: "开源中国", url: "https://www.oschina.net/news/rss", category: "tech", weight: 6, lang: "zh", region: "cn", cap: 8 },
  { id: "solidot", name: "Solidot", url: "https://www.solidot.org/index.rss", category: "tech", weight: 7, lang: "zh", region: "cn", cap: 10 },
  { id: "sspai", name: "少数派", url: "https://sspai.com/feed", category: "product", weight: 5, lang: "zh", region: "cn", cap: 6 },
  { id: "jiemian", name: "界面新闻", url: "https://a.jiemian.com/index.php?m=article&a=rss", category: "tech", weight: 7, lang: "zh", region: "cn", cap: 10, strict: true },
  { id: "sina-tech", name: "新浪科技", url: "https://rss.sina.com.cn/tech/rollnews.xml", category: "tech", weight: 6, lang: "zh", region: "cn", cap: 8 },
  { id: "wallstreetcn", name: "华尔街见闻", url: "https://dedicated.wallstreetcn.com/rss.xml", category: "finance", weight: 8, lang: "zh", region: "cn", cap: 12 },

  /* ---------------- 中文：港台（繁体，入库前转简） ---------------- */
  { id: "ithome-tw", name: "iThome 台湾", url: "https://www.ithome.com.tw/rss", category: "tech", weight: 7, lang: "zh", region: "tw", cap: 10 },
  { id: "pansci", name: "泛科学", url: "https://pansci.asia/feed", category: "tech", weight: 5, lang: "zh", region: "tw", cap: 6 },
  { id: "managertoday", name: "经理人", url: "https://www.managertoday.com.tw/rss", category: "product", weight: 5, lang: "zh", region: "tw", cap: 6 },

  /* ---------------- 全球：科技媒体 ---------------- */
  { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "tech", weight: 10, lang: "en", region: "us", cap: 12 },
  { id: "the-verge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "tech", weight: 10, lang: "en", region: "us", cap: 10 },
  { id: "ars-technica", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "tech", weight: 9, lang: "en", region: "us", cap: 12 },
  { id: "wired", name: "WIRED", url: "https://www.wired.com/feed/rss", category: "tech", weight: 9, lang: "en", region: "us", cap: 12 },
  { id: "mit-tech-review", name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", category: "tech", weight: 9, lang: "en", region: "us", cap: 8 },
  { id: "the-information", name: "The Information", url: "https://www.theinformation.com/feed", category: "tech", weight: 9, lang: "en", region: "us", cap: 8 },
  { id: "tech-in-asia", name: "Tech in Asia", url: "https://www.techinasia.com/feed", category: "tech", weight: 8, lang: "en", region: "sg", cap: 10 },
  { id: "sifted", name: "Sifted", url: "https://sifted.eu/feed", category: "tech", weight: 6, lang: "en", region: "eu", cap: 8 },
  { id: "the-decoder", name: "The Decoder", url: "https://the-decoder.com/feed/", category: "ai", weight: 8, lang: "en", region: "de", cap: 8 },
  { id: "google-ai", name: "Google AI", url: "https://blog.google/technology/ai/rss/", category: "ai", weight: 8, lang: "en", region: "us", cap: 6 },

  /* ---------------- 全球：聚合与社区 ---------------- */
  { id: "hacker-news", name: "Hacker News", url: "https://hnrss.org/frontpage?points=150", category: "tech", weight: 8, lang: "en", region: "us", cap: 10 },
  { id: "techmeme", name: "Techmeme", url: "https://www.techmeme.com/feed.xml", category: "tech", weight: 8, lang: "en", region: "us", cap: 10, strict: true },
  { id: "product-hunt", name: "Product Hunt", url: "https://www.producthunt.com/feed", category: "product", weight: 7, lang: "en", region: "us", cap: 10 },

  /* ---------------- 全球：财经 ---------------- */
  { id: "wsj-tech", name: "WSJ Tech", url: "https://feeds.a.dj.com/rss/RSSWSJD.xml", category: "tech", weight: 9, lang: "en", region: "us", cap: 8 },
  { id: "cnbc-tech", name: "CNBC Tech", url: "https://www.cnbc.com/id/19854910/device/rss/rss.html", category: "tech", weight: 8, lang: "en", region: "us", cap: 10 },
  { id: "marketwatch", name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", category: "finance", weight: 7, lang: "en", region: "us", cap: 8, strict: true },
  { id: "barrons", name: "Barron's", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", category: "finance", weight: 7, lang: "en", region: "us", cap: 8 },

  /* ---------------- 全球：科学 ---------------- */
  { id: "nature", name: "Nature", url: "https://www.nature.com/nature.rss", category: "tech", weight: 7, lang: "en", region: "uk", cap: 6 },
  { id: "science-daily", name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/science.xml", category: "tech", weight: 5, lang: "en", region: "us", cap: 6 },
];

/*
 * 明明能通却没进榜的源，记在这里省得下次又试一遍：
 *   - 36氪 / 机器之心 / 虎嗅 / 品玩 / InfoQ 中文：feed 返回 0 条或 404
 *   - BBC 中文 / 纽约时报中文 / DW 中文 / FT 中文 / 法广 / 美国之音 / 日经中文：
 *     被墙，云函数直连 fetch failed
 *   - 科技新报 / 数位时代 / INSIDE / 明报 / 香港01 / 星洲 / 南洋：Cloudflare 拦云 IP
 *   - Engadget / VentureBeat / Yahoo Finance：202 / 429，反爬
 *   - Bloomberg / FT / 路透 / SCMP / Nikkei Asia：被墙或需订阅
 */

/** 分类中文名（前端与接口共用，避免两边各写一份） */
const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "ai", label: "AI" },
  { id: "product", label: "产品" },
  { id: "tech", label: "科技" },
  { id: "finance", label: "金融" },
];

/** 单次抓取超时。雷锋网单个请求要 4~16 秒且波动大，给足 20 秒；整轮并发，
    最慢的源决定一轮耗时。 */
const FEED_TIMEOUT = 20000;
/** 库里最多保留多少条 */
const MAX_ITEMS = 600;
/** 超过这个时长的条目不再保留（源多之后 48 小时已经够 400+ 条） */
const MAX_AGE_MS = 48 * 3600 * 1000;
/** 单一来源最多保留多少条 */
const MAX_PER_SOURCE = 26;
/** 未翻译的英文条目最多留多少条，防止翻译服务挂掉时把库塞满 */
const MAX_PENDING = 120;

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
/* 英文源的同类噪音：deals / coupon / best buy 榜单 */
const NOISE_RE_EN = /\b(best deals?|deal of the day|coupon|promo code|save \$\d+|prime day|black friday|best .{0,20} to buy)\b/i;
/* 纯行情播报：MarketWatch / Barron's 会推「盘前涨跌」这类无信息量的条目 */
const NOISE_RE_QUOTE = /\b(premarket|pre-market|after-hours|stocks to watch|market wrap|live updates?)\b/i;

/* 英文源的同类噪音：天气、枪击、庭审这类社会新闻会被 WIRED / Ars 混进科技流；
   「我体验了 X，欢迎提问」这种则是论坛式互动帖，不是新闻。 */
const OFFTOPIC_RE_EN = /\b(polar vortex|weather warning|heat ?wave|hurricane|wildfire|earthquake|shooting|gunman|mass shooting|murder|arrested|charged with|sentenced|box office|reality show|celebrity)\b/i;

/**
 * 「来问我」型帖子：Reddit/HN 上的 AMA、编辑部的「我体验了 XX，欢迎提问」。
 *
 * 这类条目本身是个问答征集帖，点进去没有内容，混在新闻流里很突兀。
 * 必须在翻译之前就拦：The Verge 的原标题是
 * "I tried Apple's HomeView — ask me anything"，只认 AMA 三个字母挡不住，
 * 等翻成中文「欢迎提问」再拦，已经晚了一步（中文正则这时才看得到标题）。
 */
const AMA_RE = /(欢迎提问|问我任何|有问必答|ask me anything|any questions|\bAMA\b)/i;


/* strict 源的白名单词表。刻意不含「发布」这类泛动词 —— 界面新闻的
   「东莞发布处置情况」会因此漏网。行业词 + 公司名才靠得住。 */
const ONTOPIC_RE = /(人工智能|大模型|芯片|半导体|算力|数据中心|云计算|软件|互联网|算法|平台|手机|电脑|笔记本|平板|耳机|电池|电动|充电|机器人|自动驾驶|卫星|通信|5G|6G|网络|应用|技术|科技|开发者|开源|编程|操作系统|浏览器|数据库|安全漏洞|黑客|芯片|光刻|存储|传感器|显示器|显卡|服务器|云服务|\bai\b|chip|semiconductor|gpu|cpu|data ?center|cloud|software|internet|algorithm|platform|smartphone|laptop|tablet|earbuds|battery|electric|robot|autonomous|satellite|network|developer|open ?source|browser|database|hack|server|sensor|display|startup|app\b)/i;
const ONTOPIC_FIN_RE = /(股价|财报|营收|净利|市值|融资|并购|ipo|上市|基金|债券|比特币|加密|美联储|降息|加息|关税|通胀|cpi|gdp|投资人|估值|\bstock|\bearnings|revenue|market cap|valuation|funding|investor|\bfed\b|inflation|tariff|bitcoin|crypto|bond)/i;

function isOnTopic(title) {
  const t = String(title || "");
  return ONTOPIC_RE.test(t) || ONTOPIC_FIN_RE.test(t);
}

/* 界面新闻、新浪科技这类综合站会把时政、社会、娱乐新闻混在同一个 feed 里。
   热点页是「AI / 产品 / 科技 / 金融」，一条「副市长任命」出现在这里就是跑题。 */
/* 注意「任命」不能收进来：商业新闻里「任命首席财务官为临时 CEO」遍地都是，
   收了会把公司人事变动全挡在门外。只留强政治色彩的词。 */
const OFFTOPIC_RE = /(副市长|市长|省长|县委书记|人大常委会|政协|纪委|反腐|落马|双开|被查|免职|人事任免|巡视组|中央委员|天气预报|台风|暴雨预警|高温预警|地震|车祸|火灾|刑事案件|判刑|有期徒刑|庭审|检察院|娱乐圈|明星|综艺|电影票房|电视剧|演唱会|枪击|枪手|极地涡旋|寒潮|热浪|飓风|野火|洪水|干旱)/;

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
  const head = String(title || "").replace(/\s+/g, "");
  if (head && text.replace(/\s+/g, "").startsWith(head)) text = text.slice(head.length).trim();
  if (!text) return "";
  return text.length > 160 ? `${text.slice(0, 158).trimEnd()}…` : text;
}

/* ---------------------------------------------------------------- 分类判定 */

const AI_RE = /(人工智能|大模型|智能体|多模态|机器学习|深度学习|神经网络|算力|推理芯片|具身智能|ai\b|aigc|llm|gpt|chatgpt|openai|anthropic|claude|gemini|deepseek|kimi|豆包|通义|文心|混元|sora|midjourney|英伟达|nvidia|hugging ?face|transformer)/i;
/* 「上市」在这里刻意不收：中文里它既指 IPO，也指「新车正式上市」。
   把它归到金融，"比亚迪腾势 N8 正式上市：售 26.99 万元起" 就会被塞进财经板块。
   真要判 IPO，靠 ipo / 敲钟 / 招股书 这些词就够了。 */
const FIN_RE = /(股价|涨停|跌停|财报|营收|净利|亏损|融资|并购|ipo|退市|证监会|央行|美联储|降息|加息|利率|汇率|国债|债券|基金|a股|港股|美股|纳斯达克|恒生|比特币|以太坊|加密|cpi|gdp|关税|市值)/i;
const PRODUCT_RE = /(发布|上线|开卖|发售|新品|新版|更新|升级|降价|预售|公测|内测|众筹|开源|正式上市|开启预售)/i;

/* 「强金融信号」：财报、股价、估值这类词一出现，就该进财经，哪怕标题里的主角
   是英伟达或 OpenAI —— 「英伟达股价大涨 8%」属于财经板块，不属于 AI 板块。
   这条规则排在 AI 之前，否则凡是带 AI 公司名的财报都会跑到 AI 里去。 */
const FIN_STRONG = /(股价|涨停|跌停|财报|营收|净利|亏损|市值|招股|ipo|退市)/i;
const FIN_STRONG_EN = /\b(stock|stocks|shares|earnings|revenue|net loss|profit|market cap|ipo|valuation|quarter|q[1-4])\b/i;

/* 英文标题在翻译前也要能分类，否则首轮全挤进源默认分类 */
const AI_RE_EN = /\b(ai|a\.i\.|artificial intelligence|machine learning|deep learning|llm|llms|gpt|chatgpt|openai|anthropic|claude|gemini|deepseek|neural|robot|robots|agent|agents|agentic|nvidia|hugging ?face|transformer|inference|training|model|models|genai|copilot|multimodal)\b/i;
const FIN_RE_EN = /\b(stock|stocks|shares|earnings|revenue|profit|net loss|market cap|ipo|valuation|funding|fundraise|series [a-e]|invest|investors?|fed|federal reserve|rate cut|rate hike|inflation|tariff|tariffs|nasdaq|dow|s&p|bitcoin|crypto|bond|yields?|merger|acquisition|acquire|billion|quarter|q[1-4])\b/i;
const PRODUCT_RE_EN = /\b(launch|launches|unveil|unveils|release|releases|announce|announces|update|upgrade|preorder|beta|rollout|debut|introduc\w*|now available)\b/i;

/**
 * 分类优先级：AI 关键词 > 金融关键词 > 产品关键词 > 源默认分类。
 * 源默认兜底，所以哪怕标题看不懂，也不会掉到「未分类」。
 */
function classify(title, feed) {
  const text = String(title || "");
  const zh = /[\u4e00-\u9fff]/.test(text);
  if (zh) {
    if (FIN_STRONG.test(text)) return "finance";
    if (AI_RE.test(text)) return "ai";
    if (FIN_RE.test(text)) return "finance";
    if (feed.category !== "finance" && PRODUCT_RE.test(text)) return "product";
  } else {
    if (FIN_STRONG_EN.test(text)) return "finance";
    if (AI_RE_EN.test(text)) return "ai";
    if (FIN_RE_EN.test(text)) return "finance";
    if (feed.category !== "finance" && PRODUCT_RE_EN.test(text)) return "product";
  }
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

/**
 * 标题是不是纯外文。
 *
 * 中文源偶尔夹带英文稿 —— 钛媒体的 feed 里就混过一条
 * "Chinese Workers Are Paying Their Own AI Bills to Stay Productive"。
 * 只看 feed.lang 会把它当成品直接放行，整个中文列表里冒出一行英文。
 * 有汉字就当中文（"Google 发布 Gemini 3" 这种夹英文单词的不算），
 * 一个汉字都没有且有成串拉丁字母，就送去翻译。
 */
function looksEnglish(text) {
  const t = String(text || "");
  if (/[\u4e00-\u9fa5]/.test(t)) return false;
  return /[A-Za-z]{4,}/.test(t);
}

/** 解析一个源的 XML → 条目数组 */
function parseFeed(xml, feed, now) {
  const out = [];
  const seenTitle = new Set();
  for (const block of splitEntries(xml)) {
    if (out.length >= (feed.cap || 12)) break;
    let title = cleanText(pickTag(block, ["title"]));
    if (!title || title.length < 4) continue;
    if (NOISE_RE.test(title) || NOISE_RE_EN.test(title) || NOISE_RE_QUOTE.test(title)) continue;
    if (AMA_RE.test(title)) continue;
    if (OFFTOPIC_RE.test(title) || OFFTOPIC_RE_EN.test(title)) continue;
    if (feed.strict && !isOnTopic(title)) continue;

    /* 港台源是繁体。入库前转简，否则同一张列表里简繁混排，看着像两个站拼的。
       转换放在这里而不是翻译阶段：中文条目根本不该进翻译队列。 */
    const lang = feed.lang === "en" || looksEnglish(title) ? "en" : "zh";
    if (lang === "zh" && needsT2S(title)) title = toSimplified(title);

    /* 同一源内标题完全重复（多见于分页/置顶重推）只留第一条 */
    const titleKey = title.replace(/[\s\p{P}]/gu, "").slice(0, 40);
    if (seenTitle.has(titleKey)) continue;
    seenTitle.add(titleKey);

    const url = pickLink(block, feed.url);
    if (!url) continue;
    const ts = parseDate(pickTag(block, ["pubDate", "published", "updated", "dc:date"]));
    let summary = makeSummary(pickTag(block, ["description", "summary", "content:encoded"]), title);
    if (lang === "zh" && summary && needsT2S(summary)) summary = toSimplified(summary);

    /* titleRaw / summaryRaw 只有英文条目才有，用 JSDoc 放宽类型，
       否则 tsc 会认为它们不存在（测试里要断言这两个字段）。 */
    /** @type {any} */
    const item = {
      id: hashId(url),
      title: title.slice(0, 140),
      url,
      source: feed.id,
      sourceName: feed.name,
      category: classify(title, feed),
      publishedAt: ts ? new Date(ts).toISOString() : new Date(now).toISOString(),
      summary: summary && summary !== title ? summary : "",
      lang,
      /* 中文源抓到即成品；英文源要等翻译，先标未翻译 */
      translated: lang !== "en",
    };

    /* 英文条目：把原文留在 titleRaw / summaryRaw 上。
       翻译成功后才删，失败则下一轮拿着原文重试 —— 不用再抓一遍源。 */
    if (lang === "en") {
      item.titleRaw = title.slice(0, 200);
      if (summary) item.summaryRaw = summary.slice(0, 400);
    }

    out.push(item);
  }
  return out;
}

/* ---------------------------------------------------------------- 抓取 */

/**
 * 并发池。
 * 34 个源同时发请求会把云函数的出网连接打满，日志里表现为「一半的海外源
 * fetch failed，下一轮又好了」—— 不是对方挂了，是本地挤爆了。
 * 分 8 个一组跑，总耗时从「全部并发 3 秒」变成「15 秒」，但成功率从七成到九成。
 */
async function pool(list, limit, fn) {
  const out = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= list.length) return;
      out[idx] = await fn(list[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

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
    /* 超时不重试（重试只会让慢源拖成两倍耗时）；连接层的抖动重试一次通常就好了。 */
    if (error !== "timeout" && feed.lang === "en") {
      clearTimeout(timer);
      return fetchFeedOnce(feed, now, true);
    }
    return { feed: feed.id, ok: false, error, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试标记的第二次请求，不再嵌套重试（避免指数放大的请求风暴） */
async function fetchFeedOnce(feed, now, isRetry) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SolHubHot/1.0; +https://solhub.solyoung.top/hot/)",
        accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return { feed: feed.id, ok: false, error: `HTTP ${res.status}`, items: [] };
    const xml = await res.text();
    return { feed: feed.id, ok: true, items: parseFeed(xml, feed, now) };
  } catch (err) {
    const error = err && err.name === "AbortError" ? "timeout" : String((err && err.message) || err);
    return { feed: feed.id, ok: false, error: isRetry ? `${error} (retried)` : error, items: [] };
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
    /* 已翻好的旧条目遇到同一链接的新抓取，别把译文覆盖回英文：
       新抓的这条还是 translated:false，而旧的那条已经翻过。 */
    const prev = map.get(item.id);
    if (prev && prev.translated && prev.title && !item.translated) {
      const kept = { ...item, title: prev.title, summary: prev.summary || item.summary, translated: true, lang: "zh" };
      delete kept.titleRaw;
      delete kept.summaryRaw;
      map.set(item.id, kept);
      continue;
    }
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

  /* 未翻译的英文条目单独限额：翻译服务挂掉时它们会逐轮堆积，
     不设上限的话会把整个库挤满，中文条目全被挤出去。 */
  const pending = deduped.filter((x) => x.lang === "en" && !x.translated).slice(0, MAX_PENDING);
  const ready = deduped.filter((x) => !(x.lang === "en" && !x.translated));

  const merged = [...ready, ...pending].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );

  /* 顺手把库里历史条目的繁体也转掉。转换表换过一次（手写表漏字），
     已经入库的旧条目不会重新走 parseFeed，只能在这里补一刀；
     已经掉出 RSS 的条目否则会一直带着繁体字躺着。 */
  for (const item of merged) {
    /* 源标了中文、标题却是英文的漏网条目（改 lang 字段之前入的库）：
       降级成待翻译，下一轮补翻。留着会让中文列表里冒英文行。 */
    if (item.lang === "zh" && looksEnglish(item.title)) {
      item.lang = "en";
      item.translated = false;
      if (!item.titleRaw) item.titleRaw = item.title;
      if (!item.summaryRaw && item.summary) item.summaryRaw = item.summary;
    }
    if (item.lang !== "zh") continue;
    if (needsT2S(item.title)) item.title = toSimplified(item.title);
    if (item.summary && needsT2S(item.summary)) item.summary = toSimplified(item.summary);
  }

  /* 历史条目按当前规则再筛一遍：过滤规则是后来才加的，库里还躺着当时放行的
     社会新闻和政治新闻，不清掉的话得等它们自然过期。 */
  const FEED_BY_ID = new Map(FEEDS.map((f) => [f.id, f]));
  const cleaned = merged.filter((item) => {
    const t = item.title || "";
    if (OFFTOPIC_RE.test(t) || OFFTOPIC_RE_EN.test(t) || AMA_RE.test(t)) return false;
    const feed = FEED_BY_ID.get(item.source);
    if (feed && feed.strict && !isOnTopic(t)) return false;
    return true;
  });

  /* 每源最多留 MAX_PER_SOURCE 条。IT之家一轮 14 条 × 48 小时能堆到 70+，
     把外媒全挤到第二页去 —— 读者要的是「全球媒体」，不是一个镜像站。 */
  const perSource = new Map();
  const capped = cleaned.filter((item) => {
    const n = (perSource.get(item.source) || 0) + 1;
    perSource.set(item.source, n);
    return n <= MAX_PER_SOURCE;
  });

  /* 相似去重放在最后：前面的完全同标题去重、每源上限都是 O(n)，
     相似度比较是 O(n²)，越晚做样本越少。 */
  return spread(capByTopic(dedupeSimilar(capped))).slice(0, MAX_ITEMS);
}

/**
 * 相似标题去重。
 *
 * 一条大新闻出来，20 家媒体会各写一个标题，逐字不同但说的是同一件事：
 *   「黄仁勋辞去 Nvidia CEO 职务」
 *   「Nvidia CEO 黄仁勋辞职」
 *   「英伟达的黄仁勋辞职，任命 CFO 为临时 CEO」
 * 只按字符串完全相同去重挡不住它们，榜单会被一件事刷满 —— 实测那天 389 条里
 * 有 20 条在讲同一件事。
 *
 * 用字符 2-gram 的 Jaccard 相似度：中文不需要分词，短标题也够稳。
 * 阈值 0.62 是权衡出来的：再低会误杀「苹果发布 iPhone / 苹果发布 iPad」这类
 * 同主体不同事件，再高则挡不住改写过的同一新闻。
 */
function bigrams(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
  const set = new Set();
  for (let i = 0; i < t.length - 1; i += 1) set.add(t.slice(i, i + 2));
  /* 极短标题（一两个词）没有 2-gram，退化成整串 */
  if (!set.size && t) set.add(t);
  return set;
}

/** 标题里的数字集合。
 *  两条标题只要数字不一样，就不是同一件事：「召回 12000 辆」和「召回 1200 辆」
 *  2-gram 几乎完全相同，但这是两条新闻；「iOS 18」和「iOS 18.1」也是。 */
function numbersOf(text) {
  return new Set(String(text || "").match(/\d+(?:\.\d+)?/g) || []);
}

function sameNumbers(a, b) {
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function dedupeSimilar(list, threshold = 0.62) {
  const kept = [];
  const keptGrams = [];
  const keptNums = [];
  for (const item of list) {
    const g = bigrams(item.title);
    const nums = numbersOf(item.title);
    let dup = false;
    for (let i = 0; i < keptGrams.length; i += 1) {
      /* 数字不同就不是同一件事，直接放过（见 numbersOf 的注释） */
      if (!sameNumbers(nums, keptNums[i])) continue;
      /* 长度差太多的标题不可能相似，先挡掉省一轮 Jaccard */
      const ratio = g.size / keptGrams[i].size;
      if (ratio < 0.65 || ratio > 1.54) continue;
      if (jaccard(g, keptGrams[i]) >= threshold) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    kept.push(item);
    keptGrams.push(g);
    keptNums.push(nums);
  }
  return kept;
}

/**
 * 话题配额。
 *
 * 一条大新闻（今天：黄仁勋辞职）会让 20 家媒体同时开火，相似度去重只能挡住
 * 措辞几乎一致的，挡不住「董事会内幕」「接班人是谁」「股价影响」这些不同角度。
 * 实测那天 391 条里 32 条在讲英伟达，占了一屏还多 —— 读者会觉得这个站只会报一家公司。
 *
 * 做法不是删，是把超额的话题条目移到列表尾部：既压住刷屏，又不丢内容。
 * 每条只认第一个命中的话题（英伟达的新闻里常同时出现 OpenAI）。
 */
const TOPICS = [
  { id: "nvidia", re: /(英伟达|輝達|nvidia|黄仁勋|jensen huang)/i },
  { id: "openai", re: /(openai|chatgpt|奥特曼|sam altman)/i },
  { id: "apple", re: /(苹果公司|apple\b|iphone|ipad|macbook|imac|ios\b|蒂姆·库克|tim cook)/i },
  { id: "google", re: /(谷歌|google\b|alphabet|gemini|sundar pichai)/i },
  { id: "meta", re: /(meta\b|facebook|扎克伯格|zuckerberg)/i },
  { id: "tesla", re: /(特斯拉|tesla\b|埃隆·马斯克|elon musk)/i },
  { id: "microsoft", re: /(微软|microsoft|copilot|纳德拉|nadella)/i },
  { id: "anthropic", re: /(anthropic|claude)/i },
  { id: "bytedance", re: /(字节|抖音|tiktok|豆包)/i },
  { id: "alibaba", re: /(阿里|alibaba|通义|qwen|千问)/i },
];

function topicOf(title) {
  const t = String(title || "");
  for (const topic of TOPICS) if (topic.re.test(t)) return topic.id;
  return "";
}

/** 单话题最多留在正常排序里多少条，其余移到尾部 */
const MAX_PER_TOPIC = 6;

function capByTopic(list, max = MAX_PER_TOPIC) {
  const seen = new Map();
  const head = [];
  const tail = [];
  for (const item of list) {
    const topic = topicOf(item.title);
    if (!topic) {
      head.push(item);
      continue;
    }
    const n = (seen.get(topic) || 0) + 1;
    seen.set(topic, n);
    if (n <= max) head.push(item);
    else tail.push(item);
  }
  return [...head, ...tail];
}

/**
 * 打散同源连排。
 * 起因：源多了之后，WIRED 一轮 50 条、Nature 75 条、9to5Mac 100 条，
 * 纯按时间排会被单一来源刷屏，首页看上去像某一家媒体的镜像站。
 * 规则是同源最多连排 2 条，超了就往后找下一条不同源的顶上 —— 只在本地重排，不丢条目。
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

/* ---------------------------------------------------------------- 翻译队列 */

/**
 * 把未翻译的英文条目翻成中文。每轮限量，翻不完的下轮继续。
 *
 * 限量的原因：一批 12 条要 20~40 秒，一轮翻 200 条会让函数超时；
 * 而 15 分钟一轮的节奏下，每轮 24 条已经能消化两倍于实际新增量的积压。
 *
 * @param {any[]} items 全量条目（会就地改）
 * @param {{ budget?: number, budgetMs?: number }} opts
 */
async function translatePending(items, opts = {}) {
  const budget = Math.max(1, Math.min(60, opts.budget || 36));
  const pending = items
    .filter((x) => x.lang === "en" && !x.translated && x.titleRaw)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, budget);

  if (!pending.length) return { tried: 0, done: 0, providers: [] };

  const titles = pending.map((x) => x.titleRaw);
  /* 摘要只有一部分条目有。空串也送去翻会让模型少返回一行，整批就废了，
     所以先挑出非空的、记下原下标，翻完再按下标贴回去。 */
  const summaryIdx = [];
  pending.forEach((x, i) => {
    if (x.summaryRaw) summaryIdx.push(i);
  });
  const summaryList = summaryIdx.map((i) => pending[i].summaryRaw);

  /* 标题与摘要并发翻：串行最坏要 80 秒，并发只要 40 秒左右，
     而函数超时是有限的，能省一半就省一半。 */
  const [titleRes, summaryRes] = await Promise.all([
    translateBatch(titles, "title", { budgetMs: opts.budgetMs || 190000 }),
    translateBatch(summaryList, "summary", { budgetMs: opts.budgetMs || 190000 }),
  ]);

  const summaryOf = new Map();
  summaryIdx.forEach((itemIdx, j) => {
    const v = normalizeZh(summaryRes.out[j] || "");
    if (v) summaryOf.set(itemIdx, v);
  });

  let done = 0;
  pending.forEach((item, i) => {
    const t = normalizeZh(titleRes.out[i] || "");
    if (!t) return;
    item.title = t.slice(0, 160);
    const s = summaryOf.get(i);
    if (s) item.summary = s.slice(0, 200);
    /* 翻完就扔掉英文原文：库里 600 条 × 每条两段原文，白占几十 KB，
       而且原文留在库里等于把「未翻译」和「已翻译」混在一起分不清。 */
    delete item.titleRaw;
    delete item.summaryRaw;
    item.lang = "zh";
    item.translated = true;
    item.category = classify(item.title, FEEDS.find((f) => f.id === item.source) || { category: item.category });
    done += 1;
  });

  return {
    tried: pending.length,
    done,
    providers: [titleRes.provider, summaryRes.provider],
  };
}

/* ------------------------------------------------------------------ 对外 */

/**
 * 抓全部源 → 合并 → 翻译 → 返回可展示条目。
 *
 * @param {{ old?: any[], now?: number, budget?: number }} opts
 */
async function collectHot(opts = {}) {
  const now = Number(opts.now) || Date.now();
  /* 8 个一组：见 pool() 的注释。抓取整轮从「34 个同时发」降到 5 批，成功率明显提升。 */
  const results = await pool(FEEDS, 8, (f) => fetchFeed(f, now));
  const fresh = results.flatMap((r) => r.items);
  const merged = mergeItems(fresh, opts.old || [], now);

  let translation = { tried: 0, done: 0, providers: [] };
  try {
    translation = await translatePending(merged, { budget: opts.budget, budgetMs: opts.budgetMs });
  } catch (err) {
    /* 翻译挂了不该让整轮失败：已翻好的条目照常发布，英文的留在库下一轮再来 */
    console.error("[hot] 翻译失败:", (err && err.message) || err);
  }

  /* 前端只收中文条目。英文没翻完的留在库里等下一轮 —— 一个中文站的热点流里
     混进英文标题，比晚几分钟出现更难看。 */
  const visible = merged.filter((x) => x.lang === "zh" && x.title);

  return {
    fetchedAt: new Date(now).toISOString(),
    total: visible.length,
    /* 写库要全量（含未翻完的英文），否则下一轮没有原文可翻 */
    allItems: merged,
    items: visible,
    /* 库里中文 + 待翻的总数，运维看积压用 */
    stored: merged.length,
    pending: merged.filter((x) => x.lang === "en" && !x.translated).length,
    translation,
    feeds: results.map((r) => ({
      id: r.feed,
      ok: r.ok,
      count: r.items.length,
      ...(r.error ? { error: r.error } : {}),
    })),
  };
}

export {
  FEEDS,
  CATEGORIES,
  collectHot,
  mergeItems,
  parseFeed,
  classify,
  normalizeUrl,
  hashId,
  cleanText,
  spread,
  translatePending,
};
