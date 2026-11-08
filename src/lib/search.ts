import type { Product, SearchIndexEntry } from "@/data/types";
import type { SkillItem } from "@/data/skills";
import { skillCategoryName } from "@/data/skills";

export type { SearchIndexEntry };
import { productCategoryName } from "@/data/product-categories";
import type { Locale } from "@/i18n";
import {
  productShortDescription,
  productDescription,
  productCategoryNameLocalized,
} from "@/i18n/data";

/** Skill 的通用检索词：让「技能 / 指令 / agent / claude」等模糊词也能落到 Skill 上 */
const SKILL_KEYWORDS = [
  "skill", "skills", "agent", "智能体", "技能", "技能包", "指令", "提示词",
  "SKILL.md", "npx", "plugin", "插件", "工作流", "教程", "安装命令",
  "claude code", "codex", "cursor", "workbuddy", "skills.sh",
];

/**
 * 全局搜索索引 —— 产品来自 products.ts，Skill 来自 data/skills.ts（可选传入）。
 * 首页 Hero、导航搜索共用同一份索引；产品列表页只传 products，避免把 Skill 混进产品筛选。
 * locale 决定展示文案语言，但索引里同时保留中英文，方便跨语言模糊搜索。
 */
export function buildSearchIndex(
  products: Product[],
  locale: Locale = "zh",
  skillItems: SkillItem[] = [],
): SearchIndexEntry[] {
  const productEntries: SearchIndexEntry[] = products.map((p) => ({
    kind: "product",
    slug: p.slug,
    name: p.name,
    description: `${productShortDescription(p.slug, p.shortDescription, locale)} ${productDescription(p.slug, p.description, locale)}`,
    category: p.category,
    categoryName: productCategoryNameLocalized(p.category, productCategoryName(p.category), locale),
    tags: p.tags,
    keywords: [
      p.developerName,
      p.shortDescriptionEn ?? "",
      p.descriptionEn ?? "",
      locale === "en" ? p.shortDescription : "",
      locale === "en" ? p.description : "",
    ].filter(Boolean),
    isDemo: p.isDemo,
    href: `/products/${p.slug}/`,
  }));

  const skillEntries: SearchIndexEntry[] = skillItems.map((s) => ({
    kind: "skill",
    slug: `skill:${s.id}`,
    name: s.name,
    description: locale === "en" ? s.descriptionEn : s.description,
    category: s.category,
    categoryName: `Skill · ${skillCategoryName(s.category, locale)}`,
    tags: [...s.tags, ...s.platforms, s.repo],
    keywords: [
      s.description,
      s.descriptionEn,
      s.repo,
      s.install ?? "",
      s.github ?? "",
      s.kind === "collection" ? "合集 框架 collection" : "单技能 skill",
      s.official ? "官方 official" : "",
      ...SKILL_KEYWORDS,
    ].filter(Boolean),
    /* Skill 没有独立详情页：跳到 Skill 库并预填该名称，用户可直接看到 install 命令 */
    href: `/skills/?q=${encodeURIComponent(s.name)}`,
  }));

  return [...productEntries, ...skillEntries];
}

/**
 * 关键词评分匹配：名称命中 > 分类 / 标签 / 关键词命中 > 描述命中。
 * - 多个词之间是 AND（都要命中），所以「pdf 转换」只会返回同时相关的条目；
 * - 单个词支持模糊：连字符/空格不敏感（find skills ↔ find-skills）、
 *   以及 1~2 个字符的拼写误差（frontedn-design 也能找到 frontend-design）；
 * - 中文按子串匹配，不走编辑距离，避免误召回。
 */
export function searchIndex(
  query: string,
  index: SearchIndexEntry[],
  _locale?: Locale,
): SearchIndexEntry[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  return index
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === "product" ? -1 : 1) ||
      a.entry.name.localeCompare(b.entry.name),
    )
    .map((r) => r.entry);
}

/**
 * 给页面内的即时筛选复用：所有词都能在 haystack 里（精确 / 去分隔符 / 模糊）命中即为匹配。
 */
export function fuzzyMatch(query: string, ...fields: (string | string[] | undefined | null)[]): boolean {
  const tokens = tokenize(query);
  if (!tokens.length) return true;
  const text = normalize(
    fields
      .flatMap((f) => (Array.isArray(f) ? f : [f]))
      .filter((x): x is string => typeof x === "string")
      .join(" "),
  );
  const compactText = compact(text);
  const words = wordsOf(text);
  return tokens.every((t) => {
    if (text.includes(t)) return true;
    const ct = compact(t);
    if (ct && compactText.includes(ct)) return true;
    return fuzzyEligible(t) && words.some((w) => closeEnough(w, t));
  });
}

/* ---------------- 文本归一化与模糊工具 ---------------- */

/** 小写 + 把常见分隔符（连字符 / 下划线 / 斜杠 / 标点）折叠成空格 */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(s: string): string {
  return normalize(s).replace(/\s+/g, "");
}

function tokenize(query: string): string[] {
  return normalize(query).split(" ").filter(Boolean);
}

function wordsOf(text: string): string[] {
  return text.split(" ").filter((w) => w.length >= 3);
}

/** 只对 ≥4 位的拉丁词做模糊，中文 / 短词保持精确，避免「啥都能搜到」 */
function fuzzyEligible(t: string): boolean {
  return /^[a-z0-9]{4,}$/.test(t);
}

function maxEdits(len: number): number {
  return len >= 8 ? 2 : 1;
}

/** 有上限的编辑距离（Levenshtein）；长度差已超标直接剪枝 */
function closeEnough(a: string, b: string): boolean {
  if (a === b) return true;
  if (!/^[a-z0-9]+$/.test(a)) return false;
  const limit = maxEdits(b.length);
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 1; i <= b.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= a.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1),
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return false;
    prev = cur;
  }
  return prev[a.length] <= limit;
}

function scoreEntry(entry: SearchIndexEntry, tokens: string[]): number {
  const name = normalize(entry.name);
  const nameCompact = compact(name);
  const desc = normalize(entry.description);
  const meta = normalize(
    [entry.categoryName, ...entry.tags, ...(entry.keywords ?? [])].join(" "),
  );
  const metaCompact = compact(meta);
  const full = `${name} ${desc} ${meta}`;
  const words = wordsOf(`${name} ${meta}`);

  let total = 0;
  for (const t of tokens) {
    let best = 0;
    if (name.includes(t)) best = 4 + (name === t ? 2 : name.startsWith(t) ? 1 : 0);
    else if (nameCompact && compact(t) && nameCompact.includes(compact(t))) best = 4;
    if (meta.includes(t)) best = Math.max(best, 3);
    else if (compact(t) && metaCompact.includes(compact(t))) best = Math.max(best, 3);
    if (desc.includes(t)) best = Math.max(best, 1);
    if (!best && fuzzyEligible(t) && words.some((w) => closeEnough(w, t))) best = 1;
    /* 有一个词完全没命中就淘汰整条，保证多词搜索是 AND 而不是 OR */
    if (!best) return 0;
    total += best;
  }
  if (tokens.length > 1 && full.includes(tokens.join(" "))) total += 2;
  return total;
}
