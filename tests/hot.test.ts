import { describe, expect, it } from "vitest";
import { classify, cleanText, hashId, mergeItems, normalizeUrl, parseFeed, spread } from "../worker/hot.js";

/** 一个最小可用的 RSS 片段，用来验证解析与清洗 */
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[OpenAI 发布新模型，推理成本下降 40%]]></title>
    <link><![CDATA[https://example.com/a?utm_source=rss&id=1]]></link>
    <description><![CDATA[<p>这是一段<b>正文</b>。</p>]]></description>
    <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate>
  </item>
  <item>
    <title>英伟达股价大涨 8%，市值再创新高</title>
    <link>https://example.com/b</link>
    <description>&lt;p&gt;被转义了两次的&lt;b&gt;标签&lt;/b&gt;&lt;/p&gt;</description>
    <pubDate>Thu, 12 Nov 2026 09:00:00 +0800</pubDate>
  </item>
  <item>
    <title>双11 返场：领 1.1 元红包</title>
    <link>https://example.com/c</link>
    <pubDate>Thu, 12 Nov 2026 08:00:00 +0800</pubDate>
  </item>
</channel></rss>`;

const AI_FEED = { id: "qbitai", name: "量子位", url: "https://example.com/feed", category: "ai" };
const TECH_FEED = { id: "ithome", name: "IT之家", url: "https://example.com/feed", category: "tech" };

describe("cleanText", () => {
  it("拆 CDATA 并剥掉标签", () => {
    expect(cleanText("<![CDATA[<p>你好</p>]]>")).toBe("你好");
  });

  it("处理被实体转义了一层的 HTML（很多源这么干）", () => {
    expect(cleanText("&lt;p&gt;正文&lt;/p&gt;")).toBe("正文");
  });

  it("解开常见实体但不吃掉未知实体", () => {
    expect(cleanText("A&amp;B&nbsp;C")).toBe("A&B C");
    expect(cleanText("&unknownent;")).toBe("&unknownent;");
  });

  it("压缩空白", () => {
    expect(cleanText("a\n\n  b\t c")).toBe("a b c");
  });
});

describe("normalizeUrl", () => {
  it("去掉 utm 等跟踪参数", () => {
    expect(normalizeUrl("https://example.com/a?utm_source=rss&id=1")).toBe("https://example.com/a?id=1");
  });

  it("去掉 hash", () => {
    expect(normalizeUrl("https://example.com/a#top")).toBe("https://example.com/a");
  });

  it("非 http(s) 一律返回空（javascript: 之类的伪协议不能进列表）", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBe("");
    expect(normalizeUrl("")).toBe("");
  });

  it("相对链接按站点基址补全", () => {
    expect(normalizeUrl("/story/1", "https://example.com/rss")).toBe("https://example.com/story/1");
  });
});

describe("hashId", () => {
  it("同一输入稳定，不同输入不同", () => {
    expect(hashId("https://a.com/1")).toBe(hashId("https://a.com/1"));
    expect(hashId("https://a.com/1")).not.toBe(hashId("https://a.com/2"));
  });
});

describe("classify", () => {
  it("AI 关键词优先于源的默认分类", () => {
    expect(classify("OpenAI 发布新模型", TECH_FEED)).toBe("ai");
    expect(classify("AI 芯片出货量翻倍", TECH_FEED)).toBe("ai");
  });

  it("财经关键词归金融", () => {
    expect(classify("某公司发布财报，营收同比下滑", TECH_FEED)).toBe("finance");
  });

  it("金融源的默认分类是金融", () => {
    expect(classify("今天的市场综述", { id: "ws", name: "华尔街见闻", url: "", category: "finance" })).toBe("finance");
  });

  it("有发布类动词的非金融源归产品", () => {
    expect(classify("新一代耳机正式发布", TECH_FEED)).toBe("product");
  });

  it("没有关键词就落回源默认分类，不会出现「未分类」", () => {
    expect(classify("一条普通的消息", AI_FEED)).toBe("ai");
  });
});

describe("parseFeed", () => {
  const now = Date.parse("2026-11-12T12:00:00+08:00");

  it("解析标题、链接、时间与摘要", () => {
    const items = parseFeed(RSS, AI_FEED, now);
    const a = items.find((x) => x.url.includes("id=1"));
    expect(a).toBeTruthy();
    expect(a!.title).toContain("OpenAI");
    expect(a!.summary).toBe("这是一段 正文 。");
    expect(a!.publishedAt).toBe("2026-11-12T02:00:00.000Z");
    expect(a!.sourceName).toBe("量子位");
  });

  it("促销帖不进列表", () => {
    const items = parseFeed(RSS, AI_FEED, now);
    expect(items.some((x) => x.title.includes("红包"))).toBe(false);
  });

  it("url 已规范化", () => {
    const items = parseFeed(RSS, AI_FEED, now);
    expect(items.every((x) => !x.url.includes("utm_"))).toBe(true);
  });

  it("空 feed 返回空数组而不是抛错", () => {
    expect(parseFeed("<rss><channel></channel></rss>", AI_FEED, now)).toEqual([]);
  });
});

describe("mergeItems", () => {
  const now = Date.parse("2026-11-12T12:00:00+08:00");
  const mk = (id: string, title: string, hoursAgo: number, source = "a") => ({
    id,
    title,
    url: `https://example.com/${id}`,
    source,
    sourceName: source,
    category: "tech",
    publishedAt: new Date(now - hoursAgo * 3600 * 1000).toISOString(),
    summary: "",
  });

  it("新旧合并、按时间倒序", () => {
    const out = mergeItems([mk("2", "新的", 1)], [mk("1", "旧的", 5)], now);
    expect(out.map((x) => x.id)).toEqual(["2", "1"]);
  });

  it("同 id 用新数据覆盖旧数据", () => {
    const out = mergeItems([mk("1", "改过的标题", 5)], [mk("1", "旧标题", 5)], now);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("改过的标题");
  });

  it("超过 72 小时的条目被清掉", () => {
    const out = mergeItems([], [mk("old", "很久以前", 100)], now);
    expect(out).toHaveLength(0);
  });

  it("跨源同标题只留一条", () => {
    const out = mergeItems([mk("a1", "同一个新闻标题", 1, "a"), mk("b1", "同一个新闻标题", 2, "b")], [], now);
    expect(out).toHaveLength(1);
  });

  it("抓取全失败（fresh 为空）时不会把旧数据清掉", () => {
    const out = mergeItems([], [mk("1", "还没有过期", 2)], now);
    expect(out).toHaveLength(1);
  });
});

describe("spread", () => {
  it("同源不连续超过两条", () => {
    const list = Array.from({ length: 9 }).map((_, i) => ({
      id: String(i),
      source: i < 6 ? "a" : "b",
    }));
    const out = spread(list, 2);
    let run = 0;
    let last = "";
    for (const item of out) {
      if (item.source === last) run += 1;
      else {
        last = item.source;
        run = 1;
      }
      expect(run).toBeLessThanOrEqual(2);
    }
    expect(out).toHaveLength(9);
  });

  it("只有单一来源时原样返回，不会死循环", () => {
    const list = Array.from({ length: 5 }).map((_, i) => ({ id: String(i), source: "a" }));
    expect(spread(list, 2)).toHaveLength(5);
  });
});
