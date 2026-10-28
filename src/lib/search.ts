import type { Product, SearchIndexEntry, Tool } from "@/data/types";

export type { SearchIndexEntry };
import { categoryName } from "@/data/categories";
import { productCategoryName } from "@/data/product-categories";
import type { Locale } from "@/i18n";
import {
  toolDescription,
  productShortDescription,
  productDescription,
  productCategoryNameLocalized,
} from "@/i18n/data";

/**
 * 全局搜索 —— 数据来自统一数据源（products.ts + tools.ts），
 * 首页、导航搜索、榜单筛选共用同一份索引。locale 决定展示文案语言。
 */
export function buildSearchIndex(
  products: Product[],
  tools: Tool[],
  locale: Locale = "zh",
): SearchIndexEntry[] {
  const productEntries: SearchIndexEntry[] = products.map((p) => ({
    kind: "product",
    slug: p.slug,
    name: p.name,
    description: `${productShortDescription(p.slug, p.shortDescription, locale)} ${productDescription(p.slug, p.description, locale)}`,
    category: p.category,
    categoryName: productCategoryNameLocalized(p.category, productCategoryName(p.category), locale),
    tags: p.tags,
    isDemo: p.isDemo,
  }));
  const toolEntries: SearchIndexEntry[] = tools
    .filter((t) => t.isImplemented)
    .map((t) => ({
      kind: "tool",
      slug: t.slug,
      name: t.name,
      description: toolDescription(t.slug, t.description, locale),
      category: t.category,
      categoryName: categoryName(t.category),
      tags: t.tags,
      keywords: t.keywords,
    }));
  return [...toolEntries, ...productEntries];
}

/** 简单的关键词评分匹配：名称命中 > 分类/标签/关键词命中 > 描述命中 */
export function searchIndex(
  query: string,
  index: SearchIndexEntry[],
  _locale?: Locale,
): SearchIndexEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const scored = index
    .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((r) => r.entry);
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function scoreEntry(entry: SearchIndexEntry, q: string): number {
  const name = normalize(entry.name);
  const desc = normalize(entry.description);
  const tags = entry.tags.map(normalize).join(" ");
  const cat = normalize(entry.categoryName);
  const keywords = (entry.keywords ?? []).map(normalize).join(" ");
  const haystack = `${name} ${desc} ${tags} ${cat} ${keywords}`;
  if (!haystack.includes(q)) return 0;
  let score = 1; // 描述/标签命中
  if (name.includes(q)) score += 3;
  if (name.startsWith(q)) score += 1;
  if (tags.includes(q) || cat.includes(q) || keywords.includes(q)) score += 2;
  return score;
}
