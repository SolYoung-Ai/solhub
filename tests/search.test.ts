import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchIndex, fuzzyMatch } from "@/lib/search";
import { products } from "@/data/products";
import { skills } from "@/data/skills";

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

describe("Skill & fuzzy search", () => {
  const index = buildSearchIndex(products, "zh", skills);

  it("indexes products and skills together", () => {
    expect(index).toHaveLength(products.length + skills.length);
    expect(index.filter((e) => e.kind === "skill")).toHaveLength(skills.length);
    expect(index.every((e) => e.href.startsWith("/"))).toBe(true);
  });

  it("finds skills by name, repo and keyword", () => {
    expect(searchIndex("find-skills", index).some((e) => e.slug === "skill:find-skills")).toBe(true);
    expect(searchIndex("superpowers", index).some((e) => e.slug === "skill:superpowers")).toBe(true);
    expect(searchIndex("技能", index).some((e) => e.kind === "skill")).toBe(true);
    const entry = index.find((e) => e.slug === "skill:find-skills");
    expect(entry?.href).toContain("/skills/?q=");
  });

  it("matches separated words and multiple tokens (AND)", () => {
    expect(searchIndex("find skills", index).some((e) => e.slug === "skill:find-skills")).toBe(true);
    expect(searchIndex("document skills", index).some((e) => e.slug === "skill:document-skills")).toBe(true);
    expect(fuzzyMatch("find skills", "find-skills", "vercel-labs/skills")).toBe(true);
  });

  it("tolerates small typos without matching everything", () => {
    expect(searchIndex("frontedn-design", index).some((e) => e.slug === "skill:frontend-design")).toBe(true);
    expect(searchIndex("zzzz-no-such-thing", index)).toHaveLength(0);
  });
});
