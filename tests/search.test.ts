import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchIndex } from "@/lib/search";
import { products } from "@/data/products";

describe("Search index", () => {
  const index = buildSearchIndex(products);

  it("indexes all products", () => {
    expect(index).toHaveLength(products.length);
    expect(index.every((e) => e.kind === "product")).toBe(true);
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
});
