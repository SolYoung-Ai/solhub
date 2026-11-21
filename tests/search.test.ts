import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchIndex, fuzzyMatch } from "@/lib/search";
import { products } from "@/data/products";

describe("Search index", () => {
  const index = buildSearchIndex(products);

  it("indexes all products", () => {
    expect(index).toHaveLength(products.length);
    expect(index.every((e) => e.kind === "product")).toBe(true);
    expect(index.every((e) => e.href.startsWith("/"))).toBe(true);
  });

  it("finds products by name", () => {
    const r = searchIndex("solyoung", index);
    expect(r.some((e) => e.slug === "solyoung")).toBe(true);
  });

  it("finds by tag", () => {
    const r = searchIndex("portfolio", index);
    expect(r.some((e) => e.slug === "solyoung")).toBe(true);
  });

  it("finds by Chinese keyword", () => {
    const r = searchIndex("作品集", index);
    expect(r.some((e) => e.slug === "solyoung")).toBe(true);
  });

  it("returns empty for no query", () => {
    expect(searchIndex("", index)).toHaveLength(0);
  });

  it("returns empty for unmatched query", () => {
    expect(searchIndex("zzzz-no-such-thing", index)).toHaveLength(0);
  });

  it("requires every token to match (AND)", () => {
    /* 用现存目录产品验证多词 AND（原来的 solyoung-studio 已下架，别再引用它） */
    expect(searchIndex("account insight", index).some((e) => e.slug === "xinsight")).toBe(true);
    expect(searchIndex("solyoung 完全不存在的词", index)).toHaveLength(0);
  });
});

describe("Fuzzy matching", () => {
  it("matches separated words and multiple tokens", () => {
    expect(fuzzyMatch("json format", "json-format", "a json formatting tool")).toBe(true);
    expect(fuzzyMatch("二维码", "在线二维码生成器")).toBe(true);
  });

  it("tolerates small typos without matching everything", () => {
    expect(fuzzyMatch("camsin", "camsim")).toBe(true);
    expect(fuzzyMatch("zzzz-no-such-thing", "camsim", "打字迷你")).toBe(false);
  });
});
