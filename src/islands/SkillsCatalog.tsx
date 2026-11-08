import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  GitBranch,
  Loader2,
  Search,
  Star,
  X,
} from "lucide-react";
import { skillCategories, skillCategoryName } from "@/data/skills";
import { fuzzyMatch } from "@/lib/search";
import { loadCatalog, type CatalogData, type CatalogItem } from "@/lib/skills-catalog";
import type { Locale } from "@/i18n";

const PAGE_SIZE = 24;
type SortKey = "official" | "stars" | "name" | "source";

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/**
 * 「全网 Skill 索引」：1000 条来自真实 GitHub SKILL.md 的条目，客户端按需加载。
 * 与上方 34 条人工精选分开，是因为两者口径不同：精选有中文介绍和安装命令，
 * 索引则是机器采集的原始 frontmatter，强调可核验的来源链接。
 */
export default function SkillsCatalog({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [data, setData] = useState<CatalogData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("official");
  const [page, setPage] = useState(1);

  const start = () => {
    setStatus("loading");
    loadCatalog()
      .then((d) => {
        setData(d);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };

  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((d) => {
        if (alive) {
          setData(d);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  /* 全局搜索跳 /skills/?q=<name> 时预填。只读初始值：URL 的 q 由上方精选组件维护，
     两边都写会互相覆盖，产生地址栏抖动。 */
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q) setQuery(q);
    } catch {
      /* 地址栏解析失败时保持空关键词 */
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, source, category, sort]);

  const sources = useMemo(
    () =>
      (data?.meta.sources ?? [])
        .filter((s) => s.included > 0)
        .sort((a, b) => b.included - a.included),
    [data],
  );

  const list = useMemo(() => {
    if (!data) return [];
    const q = query.trim();
    const matched = data.items.filter((it) => {
      if (source !== "all" && it.repo !== source) return false;
      if (category !== "all" && it.category !== category) return false;
      if (!q) return true;
      return fuzzyMatch(
        q,
        it.name,
        it.description,
        it.repo,
        it.sourceLabel,
        it.sourceLabelEn,
        it.topics,
        it.path,
        skillCategoryName(it.category, "zh"),
        skillCategoryName(it.category, "en"),
      );
    });
    const sorted = [...matched];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "source")
      sorted.sort((a, b) => a.repo.localeCompare(b.repo) || a.name.localeCompare(b.name));
    else if (sort === "stars")
      sorted.sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
    else
      sorted.sort(
        (a, b) =>
          Number(b.official) - Number(a.official) ||
          b.stars - a.stars ||
          a.name.localeCompare(b.name),
      );
    return sorted;
  }, [data, query, source, category, sort]);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageItems = list.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="min-w-0">
      {/* 口径说明：明确「真实」的边界，不把自动归类说成人工审核 */}
      <div className="mb-4 rounded-[10px] border border-border bg-secondary/30 px-4 py-3">
        <p className="text-[12px] leading-5 text-muted-foreground">
          {en
            ? "Every entry below is a real SKILL.md file in a public GitHub repository. Names and descriptions are read verbatim from each file's YAML frontmatter — no generated text, no invented star counts or install commands. Categories are auto-assigned by keyword. Star counts belong to the source repository, not the individual skill."
            : "以下每条都对应公开 GitHub 仓库中真实存在的 SKILL.md 文件。名称与简介逐字取自该文件 YAML frontmatter，未生成、未翻译；Star 为所属仓库数据，分类按关键词自动归类。不提供未经核实的安装命令，点开卡片即可查看源文件。"}
        </p>
        {data && (
          <p className="mt-1.5 text-[11px] text-muted-foreground/80">
            {en
              ? `${data.meta.total.toLocaleString()} entries · ${sources.length} repositories · ${data.meta.totalCandidates.toLocaleString()} SKILL.md found · snapshot ${data.meta.snapshot}`
              : `共 ${data.meta.total.toLocaleString()} 条 · ${sources.length} 个来源仓库 · 全网发现 ${data.meta.totalCandidates.toLocaleString()} 个 SKILL.md · 快照 ${data.meta.snapshot}`}
          </p>
        )}
      </div>

      {/* 筛选工具条 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-0 sm:w-auto sm:max-w-[300px] sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={en ? "Search SKILL.md by name, description, repo…" : "搜索 Skill 名称、简介、仓库…"}
              aria-label={en ? "Search the Skill index" : "搜索全网 Skill 索引"}
              className="input !h-10 !pl-9 !pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={en ? "Clear search" : "清空搜索"}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label={en ? "Filter by source repository" : "按来源仓库筛选"}
            className="input !h-10 min-w-0 flex-1 cursor-pointer !py-0 text-xs sm:max-w-[210px] sm:flex-none"
          >
            <option value="all">{en ? "All sources" : "全部来源"}</option>
            {sources.map((s) => (
              <option key={s.repo} value={s.repo}>
                {en ? s.labelEn : s.label} ({s.included})
              </option>
            ))}
          </select>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label={en ? "Filter by category" : "按分类筛选"}
            className="input !h-10 min-w-0 flex-1 cursor-pointer !py-0 text-xs sm:max-w-[140px] sm:flex-none"
          >
            <option value="all">{en ? "All categories" : "全部分类"}</option>
            {skillCategories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {en ? c.nameEn : c.name}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label={en ? "Sort" : "排序"}
            className="input !h-10 min-w-0 flex-1 cursor-pointer !py-0 text-xs sm:max-w-[130px] sm:flex-none"
          >
            <option value="official">{en ? "Official first" : "官方优先"}</option>
            <option value="stars">{en ? "Repo stars" : "仓库 Star"}</option>
            <option value="name">{en ? "Name A–Z" : "名称 A–Z"}</option>
            <option value="source">{en ? "By source" : "按来源"}</option>
          </select>
        </div>

        {status === "ready" && (
          <p className="text-[12px] text-muted-foreground">
            {en
              ? `${list.length.toLocaleString()} matching SKILL.md${list.length !== data?.meta.total ? ` of ${data?.meta.total.toLocaleString()}` : ""}`
              : `匹配 ${list.length.toLocaleString()} 条${list.length !== data?.meta.total ? ` / 共 ${data?.meta.total.toLocaleString()} 条` : ""}`}
          </p>
        )}
      </div>

      {status === "loading" && (
        <div className="card mt-6 flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {en ? "Loading the Skill index…" : "正在加载全网 Skill 索引…"}
        </div>
      )}

      {status === "error" && (
        <div className="card mt-6 flex flex-col items-center gap-3 py-14 text-center">
          <p className="text-sm text-muted-foreground">
            {en ? "Could not load the Skill index." : "全网 Skill 索引加载失败。"}
          </p>
          <button type="button" onClick={start} className="btn btn-outline !h-8 px-3 text-xs">
            {en ? "Retry" : "重试"}
          </button>
        </div>
      )}

      {status === "ready" && list.length === 0 && (
        <div className="card mt-6 flex flex-col items-center gap-3 py-14 text-center">
          <Search className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">
            {en ? "No matching SKILL.md" : "没有匹配的 SKILL.md"}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSource("all");
              setCategory("all");
            }}
            className="btn btn-outline mt-1 !h-8 px-3 text-xs"
          >
            {en ? "Reset filters" : "重置筛选"}
          </button>
        </div>
      )}

      {status === "ready" && list.length > 0 && (
        <>
          <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2">
            {pageItems.map((it) => (
              <CatalogCard key={it.id} item={it} en={en} />
            ))}
          </div>

          {/* 分页：1000 条约 42 页，给页码下拉方便直接跳 */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] text-muted-foreground">
              {en
                ? `Page ${current} of ${totalPages} · showing ${pageItems.length}`
                : `第 ${current} / ${totalPages} 页 · 本页 ${pageItems.length} 条`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={current <= 1}
                onClick={() => setPage((v) => Math.max(1, v - 1))}
                className="btn btn-outline !h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                {en ? "← Prev" : "← 上一页"}
              </button>
              <select
                value={current}
                onChange={(e) => setPage(Number(e.target.value))}
                aria-label={en ? "Jump to page" : "跳到第几页"}
                className="input !h-8 w-[92px] cursor-pointer !py-0 text-xs"
              >
                {Array.from({ length: totalPages }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} / {totalPages}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={current >= totalPages}
                onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
                className="btn btn-outline !h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                {en ? "Next →" : "下一页 →"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CatalogCard({ item, en }: { item: CatalogItem; en: boolean }) {
  const cat = skillCategories.find((c) => c.slug === item.category);
  return (
    <article className="card group flex min-w-0 flex-col p-3.5 transition-colors hover:border-border-strong">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 break-all font-mono text-[13px] font-bold leading-5 text-foreground">
              {item.name}
            </h3>
            {item.official && (
              <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                {en ? "Official" : "官方"}
              </span>
            )}
          </div>
          <a
            href={item.github}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground hover:text-accent"
          >
            {item.repo}
          </a>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground" title={en ? "Stars of the source repository" : "所属仓库 Star"}>
          <Star className="h-2.5 w-2.5" aria-hidden="true" />
          {formatCount(item.stars)}
        </span>
      </div>

      {/* 描述为 SKILL.md frontmatter 原文，不翻译、不改写 */}
      <p className="mt-2 line-clamp-2 min-w-0 text-[12px] leading-5 text-foreground/80">
        {item.description}
      </p>

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cat?.color ?? "#a8a29e" }} aria-hidden="true" />
          {en ? cat?.nameEn : cat?.name}
        </span>
        {item.topics.slice(0, 3).map((tag) => (
          <span key={tag} className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
        >
          {en ? "View SKILL.md" : "查看 SKILL.md"}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
        <a
          href={item.github}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          {en ? "Repository" : "源仓库"}
        </a>
        <span className="ml-auto truncate text-[10px] text-muted-foreground">
          {en ? item.sourceLabelEn : item.sourceLabel}
        </span>
      </div>
    </article>
  );
}
