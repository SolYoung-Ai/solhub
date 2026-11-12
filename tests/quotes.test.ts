import { describe, expect, it } from "vitest";
import { assembleQuotes, fetchQuotes, parseEastMoney, parseSinaBtc } from "../worker/quotes.js";

/** 东财 ulist 的真实回包结构（字段精简到业务用到的几个） */
const EM = JSON.stringify({
  rc: 0,
  data: {
    total: 7,
    diff: [
      { f2: 3655.83, f3: -0.67, f4: -24.81, f12: "000001", f14: "上证指数" },
      { f2: 11197.98, f3: -1.68, f4: -191.76, f12: "399001", f14: "深证成指" },
      { f2: 25468.26, f3: 0.01, f4: 2.07, f12: "NDX", f14: "纳斯达克" },
      { f2: 7626.44, f3: 0.09, f4: 7.06, f12: "SPX", f14: "标普500" },
      { f2: 24008.55, f3: -1.26, f4: -307.37, f12: "HSI", f14: "恒生指数" },
      { f2: 3884.4, f3: -2.9, f4: -116.1, f12: "GC00Y", f14: "COMEX黄金" },
      { f2: 103.18, f3: 0.25, f4: 0.26, f12: "UDI", f14: "美元指数" },
    ],
  },
});

/** 新浪比特币的真实回包（2026-11-13 02:35 抓的原文） */
const SINA =
  'var hq_str_btc_btcbtcusd="02:35:28,0.0000,0.0000,74015.1900,0,74015.2000,74217.4900,71255.0200,72005.3800,比特币美元指数(BTC/USD),13166.3300,2026-11-13,955255953.6889,20111062.0000,USD,,0";';

function emBody(text: string) {
  return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text) };
}

/** 造一个只会认 URL 的假 fetch */
function stubFetch(opts: { em?: string | null; sina?: string | null }) {
  return async (url: string) => {
    if (url.includes("eastmoney")) {
      if (opts.em === null) throw new Error("boom");
      return emBody(opts.em ?? EM) as unknown as Response;
    }
    if (opts.sina === null) throw new Error("boom");
    return emBody(opts.sina ?? SINA) as unknown as Response;
  };
}

describe("parseEastMoney", () => {
  it("七个指数全部解析出来，顺序与配置一致", () => {
    const out = parseEastMoney(JSON.parse(EM));
    expect(out.map((q) => q.key)).toEqual(["sh", "sz", "ndx", "spx", "hsi", "gold", "dxy"]);
    expect(out[0]).toMatchObject({ zh: "上证指数", price: 3655.83, pct: -0.67, digits: 2 });
    expect(out[5].en).toBe("Gold (COMEX)");
  });

  it("价格是 \"-\"（停牌/无成交）的条目直接跳过，不显示半条", () => {
    const payload = {
      data: {
        diff: [
          { f2: "-", f3: "-", f4: "-", f12: "NDX", f14: "纳斯达克" },
          { f2: 3655.83, f3: -0.67, f4: -24.81, f12: "000001", f14: "上证指数" },
        ],
      },
    };
    const out = parseEastMoney(payload);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("sh");
  });

  it("涨跌幅离谱（源串了行）按脏数据丢掉", () => {
    const payload = { data: { diff: [{ f2: 100, f3: 300, f4: 1, f12: "SPX", f14: "标普500" }] } };
    expect(parseEastMoney(payload)).toHaveLength(0);
  });

  it("回包缺 data 不抛异常", () => {
    expect(parseEastMoney({})).toEqual([]);
    expect(parseEastMoney(null)).toEqual([]);
  });
});

describe("parseSinaBtc", () => {
  it("取第 8 位最新价、第 3 位昨收，自己算涨跌幅", () => {
    const q = parseSinaBtc(SINA);
    expect(q).not.toBeNull();
    expect(q!.price).toBe(72005.38);
    expect(q!.change).toBeCloseTo(-2009.81, 2);
    expect(q!.pct).toBeCloseTo(-2.72, 1);
    expect(q!.digits).toBe(0);
  });

  it("回包结构不对时返回 null，不返回半条数据", () => {
    expect(parseSinaBtc("")).toBeNull();
    expect(parseSinaBtc('var hq_str_btc_btcbtcusd="";')).toBeNull();
    expect(parseSinaBtc('var hq_str_btc_btcbtcusd="02:35:28,0,0,0,0,0,0,0,0,x";')).toBeNull();
  });
});

describe("assembleQuotes", () => {
  it("比特币排在黄金和美元指数之间", () => {
    const em = parseEastMoney(JSON.parse(EM));
    const btc = parseSinaBtc(SINA);
    const out = assembleQuotes([em, btc ? [btc] : []]);
    expect(out.map((q) => q.key)).toEqual(["sh", "sz", "ndx", "spx", "hsi", "gold", "btc", "dxy"]);
  });

  it("同一 key 重复时以先出现的为准", () => {
    const a = { key: "sh", zh: "A", en: "A", price: 1, change: 0, pct: 0, digits: 2 };
    const b = { key: "sh", zh: "B", en: "B", price: 2, change: 0, pct: 0, digits: 2 };
    expect(assembleQuotes([[a], [b]])[0].zh).toBe("A");
  });
});

describe("fetchQuotes", () => {
  it("两个源都正常时返回 8 条", async () => {
    const out = await fetchQuotes(stubFetch({}) as unknown as typeof fetch);
    expect(out).not.toBeNull();
    expect(out!.items).toHaveLength(8);
    expect(out!.items.map((q) => q.key)).toEqual(["sh", "sz", "ndx", "spx", "hsi", "gold", "btc", "dxy"]);
    expect(Number.isFinite(Date.parse(out!.updatedAt))).toBe(true);
  });

  it("比特币源挂了，其余 7 个照常显示", async () => {
    const out = await fetchQuotes(stubFetch({ sina: null }) as unknown as typeof fetch);
    expect(out!.items).toHaveLength(7);
    expect(out!.items.some((q) => q.key === "btc")).toBe(false);
  });

  it("东财挂了只剩 1 条 → 判为整体失败，交给上层回退旧快照", async () => {
    const out = await fetchQuotes(stubFetch({ em: null }) as unknown as typeof fetch);
    expect(out).toBeNull();
  });

  it("两个源都挂 → null", async () => {
    const out = await fetchQuotes(stubFetch({ em: null, sina: null }) as unknown as typeof fetch);
    expect(out).toBeNull();
  });
});
