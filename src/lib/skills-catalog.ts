/**
 * 全网 Skill 索引（1000 条真实 SKILL.md）的客户端加载层。
 *
 * 这份数据有 ~800KB，**刻意不进 BaseLayout 的构建期搜索索引**——否则 48 个静态页面
 * 每个都会内联上千条数据。改为：搜索浮层打开 / 首页 Hero 挂载时按需 fetch 一次，
 * 进程内缓存，再转成 SearchIndexEntry 与精选索引合并。
 */
import { useEffect, useState } from "react";
import type { SearchIndexEntry } from "@/data/types";
import { skillCategoryName } from "@/data/skills";
import { snapshot as catalogSnapshot } from "../data/skills-catalog-meta.json";
import type { Locale } from "@/i18n";

/* 带快照版本：重新采集后 URL 随之变化，自动绕过 GitHub Pages / CDN 的旧缓存，
   否则更新了 skills-catalog.json 线上可能仍拿到上一版数据。
   用具名 import 只取 snapshot，避免把整份 meta（含 15 条来源）打进客户端 bundle。 */
export const CATALOG_URL = `/data/skills-catalog.json?v=${encodeURIComponent(catalogSnapshot)}`;

export interface CatalogSource {
  repo: string;
  label: string;
  labelEn: string;
  tier: number;
  official: boolean;
  url: string;
  stars: number;
  branch?: string;
  skillMdCount: number;
  included: number;
  truncated: boolean;
  error?: string;
}

export interface CatalogReference {
  group: "official" | "aggregator" | "directory";
  name: string;
  nameEn: string;
  url: string;
  note: string;
  noteEn: string;
}

export interface CatalogMeta {
  generatedAt: string;
  snapshot: string;
  total: number;
  scannedCandidates: number;
  totalCandidates: number;
  method: string;
  methodZh: string;
  sortedBy?: string;
  heatMethod?: string;
  heatMethodZh?: string;
  sources: CatalogSource[];
  references: CatalogReference[];
}

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  /** 中文简介：由 src/data/skills-zh.json 合并进来，缺失时回落到英文原文 */
  descriptionZh?: string;
  repo: string;
  sourceLabel: string;
  sourceLabelEn: string;
  official: boolean;
  category: string;
  stars: number;
  topics: string[];
  pushedAt: string;
  /** 热度 0–100：仓库 Star 对数归一（75%）+ 推送新鲜度（25%），官方 +5 */
  heat?: number;
  /** 榜单名次，1 = 最热；快照已按热度降序写死 */
  rank?: number;
  url: string;
  github: string;
  path: string;
}

export interface CatalogData {
  meta: CatalogMeta;
  items: CatalogItem[];
}

let cached: CatalogData | null = null;
let inflight: Promise<CatalogData> | null = null;

/** 全站只下载一次：导航搜索、首页 Hero、Skill 库页共用同一份缓存 */
export function loadCatalog(): Promise<CatalogData> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch(CATALOG_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`catalog HTTP ${r.status}`);
      return r.json() as Promise<CatalogData>;
    })
    .then((d) => {
      if (!d?.meta || !Array.isArray(d.items)) throw new Error("catalog malformed");
      cached = d;
      return d;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 把真实 SKILL.md 条目转成全站搜索索引；跳到 Skill 库并预填名称 */
export function catalogSearchEntries(items: CatalogItem[], locale: Locale): SearchIndexEntry[] {
  return items.map((it) => ({
    kind: "skill",
    slug: `catalog:${it.id}`,
    name: it.name,
    description: it.description,
    category: it.category,
    categoryName: `Skill · ${skillCategoryName(it.category, locale)}`,
    tags: [...it.topics, it.repo, it.sourceLabel],
    keywords: [
      it.path,
      it.sourceLabelEn,
      it.description,
      it.descriptionZh ?? "",
      "SKILL.md",
      "skill",
      "agent",
      "技能",
      it.official ? "official 官方" : "",
    ].filter(Boolean),
    href: `/skills/?q=${encodeURIComponent(it.name)}`,
  }));
}

/** 搜索浮层用的 hook：异步追加 1000 条真实 Skill，失败时静默退回精选索引 */
export function useCatalogSearchEntries(locale: Locale): SearchIndexEntry[] {
  const [entries, setEntries] = useState<SearchIndexEntry[]>([]);
  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((d) => {
        if (alive) setEntries(catalogSearchEntries(d.items, locale));
      })
      .catch(() => {
        /* 离线 / 静态资源未就绪时不阻塞原有产品与精选 Skill 搜索 */
      });
    return () => {
      alive = false;
    };
  }, [locale]);
  return entries;
}

/**
 * 把 GitHub 的 blob 链接换成 raw 直链。
 * 教程让用户「把链接发给 Agent 让它装技能」，raw 链接里只有 SKILL.md 原文，
 * Agent 能整段读到；blob 链接拿到的是带导航、Star、按钮的网页，容易被一起喂进去。
 * 只做前缀替换，所以分支名里带斜杠也不影响。
 */
export function rawUrl(url: string): string {
  return url.replace(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//,
    "https://raw.githubusercontent.com/$1/$2/",
  );
}
