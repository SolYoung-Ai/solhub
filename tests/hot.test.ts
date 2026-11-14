import { describe, expect, it } from "vitest";
import { classify, cleanText, hashId, mergeItems, normalizeUrl, parseFeed, parseHnAlgolia, spread } from "../worker/hot.js";

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

const AI_FEED = { id: "qbitai", name: "量子位", url: "https://example.com/feed", category: "ai", lang: "zh" };
const TECH_FEED = { id: "ithome", name: "IT之家", url: "https://example.com/feed", category: "tech", lang: "zh" };
const EN_FEED = { id: "the-verge", name: "The Verge", url: "https://example.com/feed", category: "tech", lang: "en" };
const TW_FEED = { id: "ithome-tw", name: "iThome 台湾", url: "https://example.com/feed", category: "tech", lang: "zh" };

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

  it("「正式上市」是卖产品，不是 IPO", () => {
    expect(classify("比亚迪腾势 N8 正式上市：售 26.99 万元起", TECH_FEED)).toBe("product");
  });

  it("英文标题在翻译前也能分类（否则首轮全挤进源默认分类）", () => {
    expect(classify("OpenAI launches a new reasoning model", EN_FEED)).toBe("ai");
    expect(classify("Nvidia earnings beat expectations as revenue jumps", EN_FEED)).toBe("finance");
    expect(classify("Apple unveils the new MacBook Pro", EN_FEED)).toBe("product");
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

  it("英文源：留原文到 titleRaw，标成未翻译", () => {
    const xml = `<rss><channel><item>
      <title>Apple unveils new AI chips for data centers</title>
      <link>https://example.com/en1</link>
      <description>The chips are built for inference workloads.</description>
      <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate>
    </item></channel></rss>`;
    const [item] = parseFeed(xml, EN_FEED, now);
    expect(item.lang).toBe("en");
    expect(item.translated).toBe(false);
    expect(item.titleRaw).toBe("Apple unveils new AI chips for data centers");
    expect(item.summaryRaw).toContain("inference");
  });

  it("繁体源入库前转简（否则简繁混排像两个站拼的）", () => {
    const xml = `<rss><channel><item>
      <title>臺灣電動車產業開發新電池</title>
      <link>https://example.com/tw1</link>
      <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate>
    </item></channel></rss>`;
    const [item] = parseFeed(xml, TW_FEED, now);
    expect(item.title).toBe("台湾电动车产业开发新电池");
    expect(item.lang).toBe("zh");
    expect(item.translated).toBe(true);
  });

  it("英文促销帖也过滤掉（best deals / promo code）", () => {
    const xml = `<rss><channel><item>
      <title>Best deals on laptops this week</title>
      <link>https://example.com/en2</link>
      <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate>
    </item></channel></rss>`;
    expect(parseFeed(xml, EN_FEED, now)).toHaveLength(0);
  });

  it("综合站的时政/社会/娱乐新闻挡在外面", () => {
    const xml = `<rss><channel>
      <item><title>黎晓华任广东阳江市副市长、代理市长</title><link>https://example.com/o1</link>
        <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate></item>
      <item><title>台风"海葵"今夜登陆，多地发布暴雨预警</title><link>https://example.com/o2</link>
        <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate></item>
      <item><title>某电视剧收视破纪录</title><link>https://example.com/o3</link>
        <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate></item>
      <item><title>某公司发布新一代 AI 芯片</title><link>https://example.com/o4</link>
        <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate></item>
    </channel></rss>`;
    const items = parseFeed(xml, TECH_FEED, now);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("AI 芯片");
  });

  it("「来问我」型帖子挡在外面，中英文都要拦", () => {
    const xml = `<rss><channel>
      <item><title>I tried Apple's HomeView — ask me anything</title>
        <link>https://example.com/ama1</link>
        <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate></item>
      <item><title>我们拆了新款 MacBook，欢迎提问</title>
        <link>https://example.com/ama2</link>
        <pubDate>Thu, 12 Nov 2026 09:00:00 +0800</pubDate></item>
      <item><title>Apple HomeView 评测：Siri 响应偏慢</title>
        <link>https://example.com/ama3</link>
        <pubDate>Thu, 12 Nov 2026 08:00:00 +0800</pubDate></item>
    </channel></rss>`;
    const items = parseFeed(xml, EN_FEED, now);
    /* 只留正经评测；AMA 的英文原标题不含 "AMA" 三个字母，靠 ask me anything 拦 */
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("HomeView");
  });

  it("中文源夹带的英文稿按英文处理，不能直接放行", () => {
    const xml = `<rss><channel>
      <item><title>Chinese Workers Are Paying Their Own AI Bills to Stay Productive</title>
        <link>https://example.com/mix1</link>
        <description>Employees are buying AI tools themselves.</description>
        <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate></item>
      <item><title>Google 发布 Gemini 3，推理速度翻倍</title>
        <link>https://example.com/mix2</link>
        <pubDate>Thu, 12 Nov 2026 09:00:00 +0800</pubDate></item>
    </channel></rss>`;
    const items = parseFeed(xml, TECH_FEED, now);
    expect(items).toHaveLength(2);
    /* 第一条源标的是中文，标题却是英文 —— 必须去翻译，否则中文列表里冒英文行 */
    expect(items[0].lang).toBe("en");
    expect(items[0].translated).toBe(false);
    expect(items[0].titleRaw).toContain("AI Bills");
    /* 第二条夹着英文单词但有汉字，仍算中文 */
    expect(items[1].lang).toBe("zh");
    expect(items[1].translated).toBe(true);
  });

  it("每源按 cap 截断，不让单一大源刷屏", () => {
    const items = Array.from({ length: 20 })
      .map(
        (_, i) => `<item><title>标题编号 ${i} 足够长</title><link>https://example.com/c${i}</link>
        <pubDate>Thu, 12 Nov 2026 10:00:00 +0800</pubDate></item>`,
      )
      .join("");
    const out = parseFeed(`<rss><channel>${items}</channel></rss>`, { ...TECH_FEED, cap: 5 }, now);
    expect(out).toHaveLength(5);
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

  it("超过 48 小时的条目被清掉", () => {
    const out = mergeItems([], [mk("old", "很久以前", 100)], now);
    expect(out).toHaveLength(0);
  });

  it("已翻好的条目不会被同一链接的新抓取覆盖回英文", () => {
    const translated = {
      ...mk("1", "苹果发布新芯片", 2, "techcrunch"),
      lang: "zh",
      translated: true,
      titleRaw: undefined,
    };
    const refetched = {
      ...mk("1", "Apple unveils new chip", 2, "techcrunch"),
      lang: "en",
      translated: false,
      titleRaw: "Apple unveils new chip",
    };
    const out = mergeItems([refetched], [translated], now);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("苹果发布新芯片");
    expect(out[0].lang).toBe("zh");
  });

  it("跨源同标题只留一条", () => {
    const out = mergeItems([mk("a1", "同一个新闻标题", 1, "a"), mk("b1", "同一个新闻标题", 2, "b")], [], now);
    expect(out).toHaveLength(1);
  });

  it("库里遗留的「中文源 + 英文标题」旧条目会被降级去翻译", () => {
    const stale = {
      ...mk("1", "Chinese Workers Are Paying Their Own AI Bills", 2, "tmtpost"),
      lang: "zh",
      translated: true,
    };
    const out = mergeItems([], [stale], now);
    expect(out).toHaveLength(1);
    expect(out[0].lang).toBe("en");
    expect(out[0].translated).toBe(false);
    expect(out[0].titleRaw).toContain("AI Bills");
  });

  it("单一来源最多留 26 条（否则 IT之家 会把外媒全挤到第二页）", () => {
    const many = Array.from({ length: 40 }).map((_, i) => mk(`x${i}`, `标题 ${i}`, i + 1, "ithome"));
    const out = mergeItems(many, [], now);
    expect(out.filter((x) => x.source === "ithome")).toHaveLength(26);
  });

  it("同一件事被多家改写标题时只留一条", () => {
    const list = [
      mk("a", "黄仁勋辞去 Nvidia CEO 职务", 1, "wired"),
      mk("b", "Nvidia CEO 黄仁勋辞职", 2, "the-verge"),
      mk("c", "英伟达的黄仁勋辞职，任命首席财务官为临时首席执行官", 3, "techcrunch"),
      mk("d", "苹果发布新一代 MacBook Pro", 4, "ars"),
    ];
    const out = mergeItems(list, [], now);
    /* 前两条措辞接近，合成一条；第三条是更长、带了细节的报道，
       2-gram 被稀释到 0.1 左右，会被当成不同条目留下 —— 这是想要的：
       同一条新闻里信息更完整的版本应该保留。 */
    expect(out).toHaveLength(3);
    expect(out.some((x) => x.id === "b")).toBe(false);
    expect(out.some((x) => x.title.includes("MacBook"))).toBe(true);
  });

  it("数字不同的相似标题不算重复（召回 12000 辆 vs 1200 辆）", () => {
    const list = [
      mk("a", "特斯拉召回 12000 辆 Cybertruck", 1, "wired"),
      mk("b", "特斯拉召回 1200 辆 Cybertruck", 2, "ars"),
    ];
    expect(mergeItems(list, [], now)).toHaveLength(2);
  });

  it("单个话题最多占 6 条正常位置，超出的移到尾部（不删除）", () => {
    const nv = Array.from({ length: 12 }).map((_, i) =>
      mk(`nv${i}`, `英伟达第 ${i} 条消息，董事会讨论接班安排`, i + 1, `s${i}`),
    );
    const other = Array.from({ length: 4 }).map((_, i) =>
      mk(`ot${i}`, `某创业公司获得融资，用于拓展海外市场 ${i}`, i + 10, `t${i}`),
    );
    const out = mergeItems([...nv, ...other], [], now);
    /* 一条都没丢 */
    expect(out).toHaveLength(16);
    /* 前 8 条里英伟达最多 8 条，其余被推到尾部 */
    const head = out.slice(0, 6).filter((x) => x.title.includes("英伟达")).length;
    expect(head).toBeLessThanOrEqual(6);
    expect(out.filter((x) => x.title.includes("英伟达")).length).toBe(12);
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

describe("羊毛分类", () => {
  const TECH = { category: "tech", lang: "zh" };
  const FREE_FEED = { category: "free", lang: "en" };

  it("中文标题里的免费 / 开源信号进羊毛", () => {
    expect(classify("阿里云免费开放 100 万 token 额度", TECH)).toBe("free");
    expect(classify("某团队开源了一个本地推理框架", TECH)).toBe("free");
    expect(classify("白嫖 30 天：这家云厂商的学生包又回来了", TECH)).toBe("free");
  });

  it("英文的 free tier / open-source alternative 也进羊毛", () => {
    expect(classify("Cloudflare adds a free tier for GPU inference", TECH)).toBe("free");
    expect(classify("Show HN: An open-source alternative to Notion", TECH)).toBe("free");
  });

  it("羊毛源整源锁分类，不会被 AI 关键词抢走", () => {
    expect(classify("Show HN: An AI agent that runs on Cloudflare", FREE_FEED)).toBe("free");
  });

  it("强金融信号仍然优先于羊毛", () => {
    expect(classify("英伟达股价大涨，免费送显卡", TECH)).toBe("finance");
  });

  it("普通产品新闻不会被误判成羊毛", () => {
    expect(classify("小米发布新手机", TECH)).toBe("product");
    expect(classify("Nothing 发布新款耳机", TECH)).toBe("product");
  });
});

describe("羊毛源（HN Algolia）", () => {
  const FEED = {
    id: "hn-free-api",
    name: "Hacker News",
    category: "free",
    lang: "en",
    cap: 8,
    type: "json",
    require: /\bfree\b/i,
  };
  const now = Date.parse("2026-11-14T08:00:00Z");
  const hit = (o: Record<string, unknown>) => ({
    objectID: "1",
    title: "Show HN: A free API for weather",
    url: "https://example.com/a",
    created_at: "2026-11-13T10:00:00Z",
    points: 30,
    ...o,
  });

  it("解析 JSON 命中并归到羊毛", () => {
    const items = parseHnAlgolia({ hits: [hit({})] }, FEED, now);
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("free");
    expect(items[0].lang).toBe("en");
    expect(items[0].titleRaw).toContain("free API");
  });

  it("没有外链时退回 HN 讨论页，不留空链接", () => {
    const items = parseHnAlgolia({ hits: [hit({ url: null, objectID: "42" })] }, FEED, now);
    expect(items[0].url).toBe("https://news.ycombinator.com/item?id=42");
  });

  it("Algolia 的模糊匹配结果被 require 挡掉", () => {
    const noise = hit({ objectID: "2", title: "FIRE says US to end efforts to curb App", url: "https://example.com/b" });
    expect(parseHnAlgolia({ hits: [noise] }, FEED, now)).toHaveLength(0);
  });

  it("坏 JSON / 空 hits 不抛错", () => {
    expect(parseHnAlgolia({}, FEED, now)).toHaveLength(0);
    expect(parseHnAlgolia({ hits: null }, FEED, now)).toHaveLength(0);
  });
});

describe("羊毛条目的保留期", () => {
  const now = Date.parse("2026-11-14T08:00:00Z");
  const mk = (id: string, daysAgo: number, category: string) => ({
    id,
    title: `标题 ${id}`,
    url: `https://example.com/${id}`,
    source: "hn-oss-alt",
    sourceName: "Hacker News",
    category,
    publishedAt: new Date(now - daysAgo * 86400000).toISOString(),
    summary: "",
    lang: "zh",
    translated: true,
  });

  it("新闻超过 48 小时清掉，羊毛留到 14 天", () => {
    const out = mergeItems([], [mk("a", 3, "tech"), mk("b", 3, "free"), mk("c", 20, "free")], now);
    const ids = out.map((x: { id: string }) => x.id);
    expect(ids).toContain("b");
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("c");
  });
});

describe("羊毛源的噪音否决", () => {
  it("free speech / tax-free 这类字面带 free 的新闻不进羊毛", () => {
    const DENY = /\b(free speech|tax[- ]free|duty[- ]free|ai[- ]free|free press|free trade|free market|free world|smoke[- ]free|sugar[- ]free|free will|free fall|free agent|free agency|risk[- ]free|hands[- ]free|free lunch|free food)\b/i;
    expect(DENY.test("Why Google is cutting off Search from AI-free schools")).toBe(true);
    expect(DENY.test("Free speech group sues the government")).toBe(true);
    expect(DENY.test("Show HN: A free API for weather")).toBe(false);
    expect(DENY.test("Cloudflare adds a free tier for GPU inference")).toBe(false);
  });
});

describe("HN 摘要清洗", () => {
  it("摘掉 Article URL / Comments URL / Points 这类元数据，保留真正的摘要", () => {
    const xml = `<rss><channel>
      <item><title>Show HN: A free pixel map</title><link>https://example.com/p</link>
        <description>&lt;p&gt;Article URL: https://example.com/p&lt;/p&gt;&lt;p&gt;Comments URL: https://news.ycombinator.com/item?id=1&lt;/p&gt;&lt;p&gt;Points: 113 # Comments: 13&lt;/p&gt;</description>
        <pubDate>Fri, 13 Nov 2026 10:00:00 +0000</pubDate></item>
    </channel></rss>`;
    const items = parseFeed(xml, { id: "hn-show", name: "Show HN", category: "free", lang: "en", cap: 6, hn: true }, Date.parse("2026-11-14T00:00:00Z"));
    expect(items).toHaveLength(1);
    expect(items[0].summary || "").not.toMatch(/Article URL|Comments URL|Points:/);
  });
});
