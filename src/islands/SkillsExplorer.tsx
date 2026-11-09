import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  GitBranch,
  Layers3,
  Package,
  Search,
  Sparkles,
  Star,
  Terminal,
  X,
} from "lucide-react";
import {
  skillCategories,
  skillCategoryName,
  SKILLS_SNAPSHOT,
  type SkillItem,
  type SkillKind,
} from "@/data/skills";
import { p } from "@/lib/paths";
import { fuzzyMatch } from "@/lib/search";
import type { Locale } from "@/i18n";

type KindFilter = "all" | SkillKind;
type SortKey = "heat" | "name" | "category";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export default function SkillsExplorer({
  skills,
  locale = "zh",
}: {
  skills: SkillItem[];
  locale?: Locale;
}) {
  const en = locale === "en";
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("heat");
  const [copied, setCopied] = useState<string | null>(null);
  const urlSynced = useRef(false);

  /* 支持 /skills/?q=<name>：全局搜索与 Skill 卡片「在库中查看」都靠这个参数定位条目 */
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q) setQuery(q);
    } catch {
      /* 地址栏解析失败时保持空关键词 */
    }
  }, []);

  useEffect(() => {
    if (!urlSynced.current) {
      urlSynced.current = true;
      return;
    }
    try {
      const url = new URL(window.location.href);
      const q = query.trim();
      if (q) url.searchParams.set("q", q);
      else url.searchParams.delete("q");
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* 某些浏览器限制 history API 时只影响地址栏，不影响筛选 */
    }
  }, [query]);

  const counts = useMemo(
    () => ({
      skill: skills.filter((s) => s.kind === "skill").length,
      collection: skills.filter((s) => s.kind === "collection").length,
    }),
    [skills],
  );

  const list = useMemo(() => {
    const q = query.trim();
    const matched = skills.filter((s) => {
      if (kind !== "all" && s.kind !== kind) return false;
      if (category !== "all" && s.category !== category) return false;
      if (!q) return true;
      /* 与全站搜索同一套模糊匹配：连字符 / 空格不敏感，容忍 1~2 个拼写误差 */
      return fuzzyMatch(
        q,
        s.name,
        s.repo,
        s.description,
        s.descriptionEn,
        s.tags,
        s.platforms,
        skillCategoryName(s.category, "zh"),
        skillCategoryName(s.category, "en"),
        s.install,
        s.url,
      );
    });
    const sorted = [...matched];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "category")
      sorted.sort(
        (a, b) =>
          a.category.localeCompare(b.category) || b.heat - a.heat,
      );
    else sorted.sort((a, b) => b.heat - a.heat || a.name.localeCompare(b.name));
    return sorted;
  }, [skills, query, kind, category, sort]);

  const copyInstall = async (item: SkillItem) => {
    if (!item.install) return;
    const text = item.install;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 浏览器不支持剪贴板时静默降级 */
      }
      document.body.removeChild(ta);
    }
    setCopied(item.id);
    window.setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 1600);
  };

  const kindTabs: { key: KindFilter; zh: string; en: string }[] = [
    { key: "all", zh: "全部", en: "All" },
    { key: "skill", zh: "单个 Skill", en: "Skills" },
    { key: "collection", zh: "合集 / 框架", en: "Collections" },
  ];

  return (
    <div className="min-w-0">
      {/* 筛选工具条 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={en ? "Search skills, repos, tags…" : "搜索 Skill、仓库、标签…"}
              aria-label={en ? "Search skills" : "搜索 Skill"}
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

          <div className="flex w-full shrink-0 items-center gap-1 rounded-[8px] border border-border bg-card p-1 sm:w-auto">
            {kindTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setKind(t.key)}
                aria-pressed={kind === t.key}
                className={`flex-1 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors sm:flex-none ${
                  kind === t.key
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {en ? t.en : t.zh}
              </button>
            ))}
          </div>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label={en ? "Filter by category" : "按分类筛选"}
            className="input !h-10 min-w-0 flex-1 cursor-pointer !py-0 text-xs sm:flex-none sm:max-w-[150px] select"
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
            className="input !h-10 min-w-0 flex-1 cursor-pointer !py-0 text-xs sm:flex-none sm:max-w-[130px] select"
          >
            <option value="heat">{en ? "Most popular" : "综合热度"}</option>
            <option value="name">{en ? "Name A–Z" : "名称 A–Z"}</option>
            <option value="category">{en ? "By category" : "按分类"}</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          <span>
            {en
              ? `${list.length} shown · ${counts.skill} skills + ${counts.collection} collections`
              : `共 ${list.length} 条 · ${counts.skill} 个单技能 + ${counts.collection} 个合集`}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {en
              ? `Data snapshot ${SKILLS_SNAPSHOT} · installs from skills.sh, stars from GitHub`
              : `数据快照 ${SKILLS_SNAPSHOT} · 安装量来自 skills.sh，Star 来自 GitHub`}
          </span>
        </div>
      </div>

      {/* 卡片列表 */}
      {list.length === 0 ? (
        <div className="card mt-6 flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Search className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">
            {en ? "No skills found" : "没有找到匹配的 Skill"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {en ? "Try another keyword or clear the filters." : "换个关键词，或清空筛选条件试试。"}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setKind("all");
              setCategory("all");
            }}
            className="btn btn-outline mt-2 !h-8 px-3 text-xs"
          >
            {en ? "Reset filters" : "重置筛选"}
          </button>
        </div>
      ) : (
        <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2">
          {list.map((item, i) => (
            <SkillCard
              key={item.id}
              item={item}
              rank={i + 1}
              en={en}
              locale={locale}
              copied={copied === item.id}
              onCopy={() => void copyInstall(item)}
            />
          ))}
        </div>
      )}

      {/* 底部说明 + 提交入口 */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-secondary/30 p-4">
        <p className="min-w-0 flex-1 text-[12px] leading-5 text-muted-foreground">
          {en
            ? "Ranking is a curated snapshot, not a paid placement. Install counts and stars change over time — click through to check the latest numbers. Skill submissions are reviewed before listing."
            : "排序为人工精选快照，不售卖排名；安装量与 Star 会随时间变化，点击卡片可查看最新数据。Skill 提交需核验后收录，不会进入产品列表。"}
        </p>
        <a
          href={p("/submit/?type=skill", locale)}
          className="btn btn-accent shrink-0 !h-9 px-4 text-xs"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {en ? "Submit a Skill" : "提交 Skill"}
        </a>
      </div>
    </div>
  );
}

function SkillCard({
  item,
  rank,
  en,
  locale,
  copied,
  onCopy,
}: {
  item: SkillItem;
  rank: number;
  en: boolean;
  locale: Locale;
  copied: boolean;
  onCopy: () => void;
}) {
  const cat = skillCategories.find((c) => c.slug === item.category);
  const metric = item.installs
    ? { value: formatCount(item.installs), label: en ? "installs" : "安装" }
    : item.stars
      ? { value: formatCount(item.stars), label: "Stars" }
      : null;

  return (
    <article className="card group flex min-w-0 flex-col p-4 transition-colors hover:border-border-strong">
      {/* 头部 */}
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-[12px] font-bold text-white"
          style={{ backgroundColor: cat?.color ?? "#a8a29e" }}
          aria-hidden="true"
        >
          {rank < 10 ? `0${rank}` : rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h2 className="min-w-0 break-all font-mono text-[14px] font-bold leading-5 text-foreground">
              {item.name}
            </h2>
            {item.official && (
              <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                {en ? "Official" : "官方"}
              </span>
            )}
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {item.kind === "skill" ? (
                <Package className="h-2.5 w-2.5" aria-hidden="true" />
              ) : (
                <Layers3 className="h-2.5 w-2.5" aria-hidden="true" />
              )}
              {item.kind === "skill" ? (en ? "Skill" : "单技能") : en ? "Collection" : "合集"}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{item.repo}</p>
        </div>
        {metric && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-accent/25 bg-accent/5 px-2 py-0.5 text-[11px] font-semibold text-accent">
            {item.stars && !item.installs ? (
              <Star className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3 w-3" aria-hidden="true" />
            )}
            {metric.value}
            <span className="font-normal opacity-70">{metric.label}</span>
          </span>
        )}
      </div>

      {/* 描述 */}
      <p className="mt-3 line-clamp-2 min-w-0 text-[13px] leading-6 text-foreground/80">
        {en ? item.descriptionEn : item.description}
      </p>

      {/* 分类 / 平台 / 标签 */}
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: cat?.color ?? "#a8a29e" }}
            aria-hidden="true"
          />
          {en ? cat?.nameEn : cat?.name}
        </span>
        {item.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
            {tag}
          </span>
        ))}
      </div>
      <p className="mt-2 truncate text-[11px] text-muted-foreground">
        {en ? "Works with" : "兼容"}：{item.platforms.join(" · ")}
      </p>

      {/* 安装命令 */}
      {item.install && (
        <div className="mt-3 flex min-w-0 items-center gap-2 rounded-[7px] border border-border bg-secondary/40 px-2.5 py-1.5">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">{item.install}</code>
          <button
            type="button"
            onClick={onCopy}
            title={en ? "Copy install command" : "复制安装命令"}
            aria-label={en ? "Copy install command" : "复制安装命令"}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      {/* 外链 */}
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
        >
          {item.url.includes("skills.sh") ? (en ? "View on skills.sh" : "在 skills.sh 查看") : en ? "View on GitHub" : "在 GitHub 查看"}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
        {item.github && item.github !== item.url && (
          <a
            href={item.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <GitBranch className="h-3 w-3" aria-hidden="true" />
            GitHub
          </a>
        )}
        <a
          href={p("/submit/?type=skill", locale)}
          className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
        >
          {en ? "Suggest an edit" : "纠错 / 提交"}
        </a>
      </div>
    </article>
  );
}
