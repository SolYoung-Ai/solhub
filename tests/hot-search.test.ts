import { describe, expect, it } from "vitest";
import { queryNeedles, searchHotItems } from "../worker/hot-search.js";

const mk = (title: string, summary = "", sourceName = "IT之家") => ({
  id: title,
  title,
  summary,
  sourceName,
});

/** worker 里的模块是 JS，测试这边把返回值收窄成带 id 的数组，省得每处都写注解 */
const ids = (items: { id: string }[], q: string): string[] =>
  (searchHotItems(items, q) as { id: string }[]).map((it) => it.id);

describe("searchHotItems", () => {
  it("空查询原样返回，不做过滤", () => {
    const items = [mk("甲"), mk("乙")];
    expect(searchHotItems(items, "")).toBe(items);
    expect(searchHotItems(items, "   ")).toBe(items);
  });

  it("中文按子串匹配（没有词边界这回事）", () => {
    const items = [mk("英伟达市值再创新高"), mk("苹果发布新芯片")];
    expect(ids(items, "英伟达")).toEqual(["英伟达市值再创新高"]);
    expect(searchHotItems(items, "市值")).toHaveLength(1);
  });

  it("英文短词按词边界，不能把 said / chain 当成 AI", () => {
    const items = [
      mk("AI 芯片出货量翻倍"),
      mk("He said the chain is broken"),
      mk("Retail investors pile in"),
    ];
    expect(ids(items, "ai")).toEqual(["AI 芯片出货量翻倍"]);
  });

  it("英文大小写不敏感，且能搜带符号的型号", () => {
    const items = [mk("GPT-5 提前泄露"), mk("Gemini 3 发布")];
    expect(searchHotItems(items, "gpt-5")).toHaveLength(1);
    expect(searchHotItems(items, "GEMINI")).toHaveLength(1);
  });

  it("多个关键词是 AND，不是 OR", () => {
    const items = [mk("苹果发布 M5 芯片"), mk("苹果上调订阅价格"), mk("高通发布新芯片")];
    expect(ids(items, "苹果 芯片")).toEqual(["苹果发布 M5 芯片"]);
  });

  it("导语和来源名也能搜到", () => {
    const items = [mk("某公司季度财报", "营收同比增长 30%", "华尔街见闻"), mk("另一条", "", "TechCrunch")];
    expect(searchHotItems(items, "营收")).toHaveLength(1);
    expect(ids(items, "华尔街")).toEqual(["某公司季度财报"]);
  });

  it("关键词数量和长度都有上限，防止拿超长串打服务端", () => {
    expect(queryNeedles("a b c d e f g h")).toHaveLength(6);
    expect(queryNeedles("x".repeat(200))[0]).toHaveLength(60);
  });

  it("正则元字符按字面处理，不会让查询变成通配", () => {
    const items = [mk("价格 3.5 美元"), mk("价格 395 美元")];
    expect(ids(items, "3.5")).toEqual(["价格 3.5 美元"]);
  });
});
