import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchIndex } from "@/lib/search";
import { products } from "@/data/products";
import { tools } from "@/data/tools";

describe("Search index", () => {
  const index = buildSearchIndex(products, tools);

  it("indexes all implemented tools and products", () => {
    expect(index.filter((e) => e.kind === "tool").length).toBe(tools.filter((t) => t.isImplemented).length);
    expect(index.filter((e) => e.kind === "product").length).toBe(products.length);
  });

  it("finds tools by name", () => {
    const r = searchIndex("json", index);
    expect(r.some((e) => e.kind === "tool" && e.slug === "json-formatter")).toBe(true);
  });

  it("finds products by name", () => {
    const r = searchIndex("solyoung", index);
    expect(r.some((e) => e.kind === "product")).toBe(true);
  });

  it("finds by tag", () => {
    const r = searchIndex("qr", index);
    expect(r.some((e) => e.slug === "qr-generator")).toBe(true);
  });

  it("finds by Chinese keyword", () => {
    const r = searchIndex("时间戳", index);
    expect(r.some((e) => e.slug === "timestamp-converter")).toBe(true);
  });

  it("returns empty for no query", () => {
    expect(searchIndex("", index)).toHaveLength(0);
  });

  it("returns empty for unmatched query", () => {
    expect(searchIndex("zzzz-no-such-thing", index)).toHaveLength(0);
  });
});
