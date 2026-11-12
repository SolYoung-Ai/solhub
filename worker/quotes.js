/**
 * 行情快照（/quotes）
 * =====================================================
 *
 * 给 /hot/ 顶部那条指数栏供货：上证、深证、纳斯达克、标普 500、恒生、
 * COMEX 黄金、比特币、美元指数。
 *
 * 为什么是「按需刷新」而不是定时函数：
 *   行情 60 秒一次就够读者看了，而定时器是 24 小时不停地烧资源点（1 分钟一次
 *   ≈ 840 点/月）。这里改成「有人访问且缓存过期了才回源」，没人看就不花钱，
 *   冷启动的第一笔开销也就是两次 HTTP。
 *
 * 数据源分工（2026-11-13 实测，从 CloudBase 上海出发）：
 *   东方财富 push2  —— 7 个指数/商品/汇率，一条请求拿完，UTF-8 JSON，约 300ms。
 *   新浪 hq.sinajs  —— 只补比特币。注意两点：
 *     · 必须带 Referer，不带直接 403 Forbidden；
 *     · 它的 int_nasdaq / int_dji / int_sp500 是陈旧数据（纳斯达克回 22484，
 *       东财同日回 25468），所以美股指数一律走东财，别贪省事全用新浪。
 *   币安 / OKX / CoinGecko 从云函数出发全部不可达，所以加密货币只剩新浪这一条路。
 *
 * 取不到怎么办：
 *   两个源各自独立失败，谁成功就显示谁；成功不足 4 个就整体判为失败，
 *   让上层回退到 KV 里的旧快照（前端会把它标成「延迟」）；旧快照也没有，
 *   返回空列表，前端整条隐藏 —— 页面上永远不出现报错，也永远不出现半条数据。
 */

/** 行情快照在 kv 表里的键；改结构时升版本号，旧键留给回滚 */
const QUOTES_KEY = "quotes:v1";

/** 60 秒。前端也是 60 秒轮询，两边对齐才不会每个请求都触发回源 */
const QUOTES_TTL_MS = 60 * 1000;

/**
 * 东方财富的指数清单。顺序即展示顺序的前半段。
 *   secid  ：市场前缀.代码（1=沪 0=深 100=海外指数 101=海外期货）
 *   code   ：回包里的 f12，用来把返回行对回配置项
 *   digits ：价格保留几位小数（指数两位，比特币整数）
 */
const EASTMONEY = [
  { key: "sh", secid: "1.000001", code: "000001", zh: "上证指数", en: "SSE Composite", digits: 2 },
  { key: "sz", secid: "0.399001", code: "399001", zh: "深证成指", en: "SZSE Component", digits: 2 },
  { key: "ndx", secid: "100.NDX", code: "NDX", zh: "纳斯达克", en: "Nasdaq 100", digits: 2 },
  { key: "spx", secid: "100.SPX", code: "SPX", zh: "标普 500", en: "S&P 500", digits: 2 },
  { key: "hsi", secid: "100.HSI", code: "HSI", zh: "恒生指数", en: "Hang Seng", digits: 2 },
  { key: "gold", secid: "101.GC00Y", code: "GC00Y", zh: "COMEX 黄金", en: "Gold (COMEX)", digits: 2 },
  { key: "dxy", secid: "100.UDI", code: "UDI", zh: "美元指数", en: "Dollar Index", digits: 2 },
];

const BTC = { key: "btc", zh: "比特币", en: "Bitcoin", digits: 0 };

/** 展示顺序：比特币夹在黄金和美元指数之间，和其他站的习惯一致 */
const ORDER = ["sh", "sz", "ndx", "spx", "hsi", "gold", "btc", "dxy"];

const EM_URL =
  "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f14&secids=" +
  EASTMONEY.map((x) => x.secid).join(",");

const SINA_BTC_URL = "https://hq.sinajs.cn/list=btc_btcbtcusd";

/** 涨跌幅超过这个数按脏数据处理 —— 正常指数单日不可能动这么多，多半是源串了 */
const MAX_ABS_PCT = 60;

/** 价格字段可能是 "-" / "" / null，统一成 number | null */
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function decoder(enc) {
  try {
    return new TextDecoder(enc);
  } catch {
    /* Cloudflare Workers 的 TextDecoder 只保证 utf-8；BTC 那一串除了名称全 ASCII，
       退化成 utf-8 解码也不影响取数（名称是我们自己配的，不用源里的）。 */
    return new TextDecoder("utf-8");
  }
}

async function requestText(fetchImpl, url, headers, enc, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: ctl.signal });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "no response"));
    const buf = await res.arrayBuffer();
    return decoder(enc).decode(buf);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析东财 ulist 回包。返回 [{ key, zh, en, digits, price, change, pct }]
 * 缺失或不合法的条目直接跳过 —— 少一格比画错一格好。
 */
function parseEastMoney(payload) {
  const rows = (payload && payload.data && payload.data.diff) || [];
  const byCode = new Map();
  for (const r of rows) if (r && r.f12 !== undefined) byCode.set(String(r.f12), r);

  const out = [];
  for (const spec of EASTMONEY) {
    const r = byCode.get(spec.code);
    if (!r) continue;
    const price = num(r.f2);
    const pct = num(r.f3);
    if (price === null || price <= 0 || pct === null || Math.abs(pct) > MAX_ABS_PCT) continue;
    out.push({
      key: spec.key,
      zh: spec.zh,
      en: spec.en,
      digits: spec.digits,
      price,
      change: num(r.f4),
      pct,
    });
  }
  return out;
}

/**
 * 解析新浪比特币回包。
 *
 * 字段布局是实测出来的，不是猜的（连测两次，只有这两个位置在动）：
 *   0 时间 / 3 昨收 / 5 今开 / 6 最高 / 7 最低 / 8 最新价 / 9 名称
 * 所以涨跌幅要自己算 —— 新浪这串里没有现成的百分比。
 */
function parseSinaBtc(text) {
  const m = /hq_str_btc_btcbtcusd="([^"]*)"/.exec(String(text || ""));
  if (!m) return null;
  const f = m[1].split(",");
  const prev = num(f[3]);
  const price = num(f[8]);
  if (price === null || price <= 0) return null;
  if (prev === null || prev <= 0) return null;
  const change = price - prev;
  const pct = (change / prev) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > MAX_ABS_PCT) return null;
  return { key: BTC.key, zh: BTC.zh, en: BTC.en, digits: BTC.digits, price, change, pct };
}

/** 把两个源的结果按 ORDER 拼成一条列表；缺席的键直接不出现 */
function assembleQuotes(groups) {
  const byKey = new Map();
  for (const g of groups) for (const q of g || []) if (q && !byKey.has(q.key)) byKey.set(q.key, q);
  return ORDER.map((k) => byKey.get(k)).filter(Boolean);
}

/**
 * 回源取一次行情。任一侧失败不影响另一侧；可用条目不足 4 个就当整体失败，
 * 返回 null 让调用方去用旧快照。
 *
 * @param {(url: string, init?: object) => Promise<Response>} fetchImpl
 */
async function fetchQuotes(fetchImpl) {
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) return null;

  const [em, btc] = await Promise.allSettled([
    requestText(f, EM_URL, {}, "utf-8", 8000).then(JSON.parse).then(parseEastMoney),
    requestText(f, SINA_BTC_URL, { Referer: "https://finance.sina.com.cn/" }, "gbk", 8000).then(parseSinaBtc),
  ]);

  const groups = [
    em.status === "fulfilled" ? em.value : [],
    btc.status === "fulfilled" && btc.value ? [btc.value] : [],
  ];
  const items = assembleQuotes(groups);
  if (items.length < 4) return null;

  return { updatedAt: new Date().toISOString(), items };
}

export {
  QUOTES_KEY,
  QUOTES_TTL_MS,
  fetchQuotes,
  parseEastMoney,
  parseSinaBtc,
  assembleQuotes,
};
