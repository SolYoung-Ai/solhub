/**
 * 热点流（/hot/）
 * =================
 *
 * 数据由后端定时抓取；这里只在首屏、切分类、搜索或手动刷新时读取，不再后台轮询，
 * 避免页面挂着时反复唤醒 CloudBase PostgreSQL。
 *
 * 刻意控制请求次数：首屏、切分类、搜索或点刷新才读一次；页面挂在后台时不主动唤醒后端。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { base } from "@/lib/api-base";

interface HotItem {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceName: string;
  category: string;
  publishedAt: string;
  summary?: string;
}

interface HotResponse {
  fetchedAt: string | null;
  counts: Record<string, number>;
  total: number;
  hasMore: boolean;
  items: HotItem[];
}

type Cat = "all" | "ai" | "product" | "tech" | "finance" | "world";

const TABS: { id: Cat; zh: string; en: string }[] = [
  { id: "all", zh: "全部", en: "All" },
  { id: "ai", zh: "AI", en: "AI" },
  { id: "product", zh: "产品", en: "Product" },
  { id: "tech", zh: "科技", en: "Tech" },
  { id: "finance", zh: "金融", en: "Finance" },
  { id: "world", zh: "时政", en: "World" },
];

/** 分类色：只做一个小圆点，不搞成彩色标签墙 */
const CAT_DOT: Record<string, string> = {
  ai: "bg-[#d96a24]",
  product: "bg-[#5b8def]",
  tech: "bg-[#8a8f98]",
  finance: "bg-[#3f9e6a]",
  /* 时政用紫：和 AI 的橙、产品的蓝、金融的绿拉开距离 */
  world: "bg-[#7d6cc9]",
};

const PAGE = 40;
const FEED_LIMIT = 80;
const STORE_CAT = "solhub:hot:cat";
/** 输入后等这么久再打接口：中文一个字一个字敲，每个字都发请求既慢又费额度 */
const SEARCH_DEBOUNCE_MS = 250;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把命中的关键词套一层 <mark>。
 * 能不能搜到由后端判定（worker/hot-search.js），这里只负责看得见 ——
 * 所以高亮规则允许比后端宽松，最多多染几个字，不会出现「有结果但一个字都没标」。
 */
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map(escapeRe).join("|")})`, "gi");
  const hits = new Set(words.map((w) => w.toLowerCase()));
  return (
    <>
      {text.split(re).map((part, i) =>
        hits.has(part.toLowerCase()) ? (
          <mark key={i} className="rounded-[3px] bg-accent/20 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function timeAgo(iso: string, en: boolean): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return en ? "just now" : "刚刚";
  const min = Math.floor(diff / 60000);
  if (min < 1) return en ? "just now" : "刚刚";
  if (min < 60) return en ? `${min}m ago` : `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return en ? `${hr}h ago` : `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 3) return en ? `${day}d ago` : `${day} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 本地时间精确到分钟，用于「更新于」 */
function clockOf(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function HotFeed({
  locale = "zh",
  limit,
}: {
  locale?: "zh" | "en";
  /**
   * 首屏只显示这么多条，且不出「加载更多」——首页把它当摘录用，更多内容回 /hot/。
   * 不传就是完整的 40 条 + 分页。
   */
  limit?: number;
}) {
  const en = locale === "en";
  /* 摘录模式下条目标题降一级：页面上已经有 section 的 h2，条目再写 h2 会平级 */
  const TitleTag = limit ? "h3" : "h2";
  const initialShown = limit ?? PAGE;

  const [cat, setCat] = useState<Cat>("all");
  const [data, setData] = useState<HotResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(initialShown);
  const [reloadKey, setReloadKey] = useState(0);
  /* query 是输入框里的字，appliedQuery 是真正发出去的那个（防抖后） */
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  const tabsRef = useRef<HTMLDivElement | null>(null);

  /* 首屏恢复分类偏好，下次进来不用重选 */
  useEffect(() => {
    try {
      const savedCat = localStorage.getItem(STORE_CAT) as Cat | null;
      if (savedCat && TABS.some((t) => t.id === savedCat)) setCat(savedCat);
    } catch {
      /* localStorage 被禁也不影响读内容 */
    }
  }, []);

  const fetchFeed = useCallback(async (targetCat: Cat, targetQuery: string): Promise<HotResponse | null> => {
    /* 搜索时先跨全部分类找，再在结果里看 —— 读者搜「英伟达」不关心自己停在哪个
       分类标签上。分类过滤留在后端，前端不做第二套规则。 */
    const params = new URLSearchParams({ cat: targetQuery ? "all" : targetCat, limit: String(FEED_LIMIT) });
    if (targetQuery) params.set("q", targetQuery);
    const res = await fetch(`${base()}/hot?${params.toString()}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as HotResponse;
  }, []);

  /* 打字不立刻打接口：停在 250ms 才算一个完整的词 */
  useEffect(() => {
    const t = window.setTimeout(() => setAppliedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  /* 首次加载 + 切分类 + 改搜索词 */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setShown(initialShown);
    fetchFeed(cat, appliedQuery)
      .then((json) => {
        if (!alive || !json) return;
        setData(json);
        try {
          localStorage.setItem(STORE_CAT, cat);
        } catch {
          /* ignore */
        }
      })
      .catch((err) => {
        if (!alive) return;
        setError(String((err && err.message) || err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [cat, appliedQuery, reloadKey, fetchFeed, initialShown]);

  const refresh = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const items = data?.items ?? [];
  const visible = items.slice(0, shown);
  const counts = data?.counts ?? { all: 0, ai: 0, product: 0, tech: 0, finance: 0, world: 0 };

  /* 高亮关键词跟着「已发出的搜索词」走，不跟输入框走：否则每敲一个字都在重染色 */
  const words = appliedQuery ? appliedQuery.split(/\s+/).filter(Boolean) : [];

  /* 六个标签在手机上放不下，选中的那个可能是半截露在右边缘 —— 选中后把它滚进来。
     桌面端整行都放得下，scrollIntoView 相当于不动。 */
  useEffect(() => {
    const box = tabsRef.current;
    const el = box?.querySelector('[aria-pressed="true"]') as HTMLElement | null;
    if (!box || !el) return;
    /* 自己算滚动量而不是 scrollIntoView：后者会连带滚动整页，而且在这条
       overflow-x 容器里按「nearest」并不总是生效 */
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.right <= b.right && r.left >= b.left) return;
    const left = box.scrollLeft + (r.left - b.left) - (b.width - r.width) / 2;
    box.scrollTo({ left, behavior: "smooth" });
  }, [cat, appliedQuery]);

  /* 点分类等于「我要逛，不搜了」，两件事一起收掉，不留半截搜索状态 */
  const clearSearch = useCallback(() => {
    setQuery("");
    setAppliedQuery("");
  }, []);

  return (
    <div className="min-w-0">
      {/* 搜索框：只在完整页出现，首页那份是摘录，没有搜索的必要 */}
      {!limit ? (
        <div className="mb-3">
          {/* 宽度约束在外层：清空按钮是 absolute，挂在 input 上的 max-w 管不住它 */}
          <div className="relative w-full sm:max-w-[360px]">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.6-3.6" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  clearSearch();
                  e.currentTarget.blur();
                }
              }}
              enterKeyHint="search"
              aria-label={en ? "Search hot stories" : "搜索热点"}
              placeholder={en ? "Search headlines, sources…" : "搜索标题、来源，用空格分隔多个词"}
              className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-9 text-[13px] text-foreground outline-none transition placeholder:text-[12px] placeholder:text-muted-foreground focus:border-accent/50 focus:ring-2 focus:ring-accent/15"
            />
            {query ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label={en ? "Clear search" : "清空搜索"}
                className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            ) : null}
          </div>
          {/* 0 条时下面有空态卡片兜着，这里再写一遍「找到 0 条」是重复 */}
          {appliedQuery && (loading || items.length > 0) ? (
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              {loading
                ? en
                  ? "Searching…"
                  : "搜索中…"
                : en
                  ? `${items.length} ${items.length === 1 ? "result" : "results"} for “${appliedQuery}” · across all categories`
                  : `找到 ${items.length} 条「${appliedQuery}」 · 跨全部分类`}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 分类 + 通知开关。手机上横向滚动，不换行不挤压 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          ref={tabsRef}
          /* min-w-0 是关键：flex 子项的 min-width 默认是内容宽度，六个标签
             会把容器顶到 445px、整行溢出页面，overflow-x 反而永远没有可滚的距离 */
          className="-mx-1 flex w-full min-w-0 items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-1"
        >
          {TABS.map((t) => {
            /* 搜索时不高亮任何分类：结果是跨分类搜出来的，标一个「全部」会让人以为
               只搜了「全部」这一栏 */
            const active = cat === t.id && !appliedQuery;
            const n = counts[t.id] ?? 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (query || appliedQuery) clearSearch();
                  setCat(t.id);
                }}
                aria-pressed={active}
                className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${
                  active
                    ? "border-transparent bg-accent text-white"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {en ? t.en : t.zh}
                <span className={`ml-1.5 text-[10px] font-normal ${active ? "text-white/70" : "text-muted-foreground/70"}`}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {data?.fetchedAt
              ? en
                ? `Updated ${clockOf(data.fetchedAt)}`
                : `更新于 ${clockOf(data.fetchedAt)}`
              : en
                ? "Loading…"
                : "加载中…"}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label={en ? "Refresh feed" : "刷新热点"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* 骨架屏：只占位，不闪烁 */}
      {loading && !items.length ? (
        <ul className="mt-4 space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="card animate-pulse p-4">
              <div className="h-3 w-24 rounded bg-border" />
              <div className="mt-3 h-4 w-3/4 rounded bg-border" />
              <div className="mt-2 h-3 w-full rounded bg-border/70" />
            </li>
          ))}
        </ul>
      ) : null}

      {error && !items.length ? (
        <div className="card mt-4 p-6 text-center">
          <p className="text-sm font-semibold text-foreground">
            {en ? "Couldn't load the feed" : "热点没能加载出来"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {en ? "The service may be waking up. Try again in a moment." : "抓取服务可能在唤醒，稍等一下再试。"}
          </p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="btn btn-outline mt-4 !h-9 px-4 text-xs">
            {en ? "Retry" : "重试"}
          </button>
        </div>
      ) : null}

      {!loading && !error && !items.length ? (
        <div className="card mt-4 p-8 text-center">
          {appliedQuery ? (
            <>
              <p className="text-sm font-semibold text-foreground">
                {en ? `No matches for “${appliedQuery}”` : `没有和「${appliedQuery}」相关的内容`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {en
                  ? "Try a shorter keyword, or a company / product name."
                  : "换个短一点的词试试，比如公司名、产品名。"}
              </p>
              <button type="button" onClick={clearSearch} className="btn btn-outline mt-4 !h-9 px-4 text-xs">
                {en ? "Clear search" : "清空搜索"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">{en ? "Nothing here yet" : "这个分类还没有内容"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {en ? "First batch is being fetched. Check back in a few minutes." : "第一批还在路上，过几分钟再来看看。"}
              </p>
            </>
          )}
        </div>
      ) : null}

      <ul className="mt-4 space-y-2.5">
        {visible.map((it) => (
          <li key={it.id} className="min-w-0">
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card group block min-w-0 p-4 transition hover:border-accent/40"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CAT_DOT[it.category] || "bg-border"}`} aria-hidden="true" />
                <span className="font-semibold text-foreground/70">{it.sourceName}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={it.publishedAt}>{timeAgo(it.publishedAt, en)}</time>
              </div>
              <TitleTag className="mt-1.5 break-words text-[14px] font-bold leading-6 text-foreground group-hover:text-accent sm:text-[15px]">
                <Highlight text={it.title} words={words} />
              </TitleTag>
              {it.summary ? (
                <p className="mt-1 line-clamp-2 break-words text-[12px] leading-5 text-muted-foreground">
                  <Highlight text={it.summary} words={words} />
                </p>
              ) : null}
            </a>
          </li>
        ))}
      </ul>

      {/* 搜索结果一次就返回了全部命中（后端已过滤再分页），「加载更多」是纯前端切片，
          所以搜索时也保留：83 条命中只露 40 条而不给翻页，才是真的断头路 */}
      {!limit && shown < items.length ? (
        <div className="mt-5 flex justify-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="btn btn-outline !h-9 px-5 text-xs">
            {en ? `Load more (${items.length - shown} left)` : `加载更多（还有 ${items.length - shown} 条）`}
          </button>
        </div>
      ) : null}

      {items.length && !limit ? (
        <p className="mt-6 rounded-[16px] border border-border bg-secondary/30 p-4 text-[11px] leading-5 text-muted-foreground">
          {en
            ? "Headlines and links come from the public RSS feeds of 42 outlets — 15 Chinese and 27 global (TechCrunch, The Verge, Ars Technica, WIRED, MIT Technology Review, WSJ, CNBC, Nature, France 24, Sky News and Lianhe Zaobao for world affairs, plus Hacker News queries for free APIs, open-source alternatives and Show HN). Non-Chinese headlines are machine-translated into Chinese, so details may be imprecise — always check the original. SolHub hosts and republishes none of it."
            : "标题与链接来自 42 家媒体的公开 RSS —— 中文 15 家，全球 27 家（TechCrunch、The Verge、Ars Technica、WIRED、MIT Technology Review、WSJ、CNBC、Nature，时政来自 France 24、Sky News 与联合早报，以及 Hacker News 的免费 API / 开源替代 / 自托管 / Show HN 查询）。外媒的标题与导语由机器翻译成中文，细节可能不够准确，请以原文为准。每条都跳回原站，SolHub 不转载、不镜像正文。"}
        </p>
      ) : null}
    </div>
  );
}
