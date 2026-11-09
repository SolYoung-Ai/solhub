import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogSearchEntries, rawUrl, type CatalogData } from "@/lib/skills-catalog";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data: CatalogData = JSON.parse(
  readFileSync(path.join(root, "public/data/skills-catalog.json"), "utf8"),
);

const VALID_CATEGORIES = [
  "engineering", "design", "docs", "writing",
  "research", "automation", "growth", "collections",
];

describe("全网 Skill 索引快照", () => {
  it("至少收录 1000 条，且 meta 与实际条目一致", () => {
    expect(data.meta.total).toBeGreaterThanOrEqual(1000);
    expect(data.items).toHaveLength(data.meta.total);
    expect(data.meta.sources.length).toBeGreaterThan(5);
  });

  it("每条都指向真实 GitHub SKILL.md，且带 frontmatter 原文简介", () => {
    for (const it of data.items) {
      expect(it.name.length).toBeGreaterThan(1);
      expect(it.description.length).toBeGreaterThanOrEqual(12);
      // 只收录真实存在的文件，不允许占位 / 编造链接
      expect(it.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/.+\/SKILL\.md$/);
      expect(it.github).toBe(`https://github.com/${it.repo}`);
      expect(it.url.startsWith(`${it.github}/blob/`)).toBe(true);
      expect(it.stars).toBeGreaterThanOrEqual(0);
      expect(VALID_CATEGORIES).toContain(it.category);
    }
  });

  it("名称不重复（按大小写归一）", () => {
    expect(new Set(data.items.map((i) => i.name.toLowerCase())).size).toBe(data.items.length);
  });

  it("来源计数可核对，参考链接均为 https", () => {
    expect(data.meta.sources.reduce((n, s) => n + s.included, 0)).toBe(data.meta.total);
    expect(data.meta.references.length).toBeGreaterThanOrEqual(10);
    for (const r of data.meta.references) {
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.name.length).toBeGreaterThan(1);
    }
  });

  it("转成全站搜索条目后 slug 唯一、跳转回 Skill 库", () => {
    const entries = catalogSearchEntries(data.items.slice(0, 20), "zh");
    expect(entries).toHaveLength(20);
    expect(new Set(entries.map((e) => e.slug)).size).toBe(20);
    expect(entries.every((e) => e.kind === "skill" && e.href.startsWith("/skills/?q="))).toBe(true);
  });
});

describe("raw 直链推导", () => {
  it("把 blob 链接换成 raw，保留分支与路径", () => {
    expect(
      rawUrl("https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md"),
    ).toBe("https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md");
    // 分支名里带斜杠也不能被拆错
    expect(rawUrl("https://github.com/o/r/blob/feat/x/docs/SKILL.md")).toBe(
      "https://raw.githubusercontent.com/o/r/feat/x/docs/SKILL.md",
    );
  });

  it("非 GitHub / 非 blob 链接原样返回", () => {
    expect(rawUrl("https://example.com/a/SKILL.md")).toBe("https://example.com/a/SKILL.md");
  });

  it("快照里 1000 条全部能转成可访问的 raw 地址", () => {
    for (const it of data.items) {
      expect(rawUrl(it.url)).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/.+\/SKILL\.md$/,
      );
    }
  });
});
