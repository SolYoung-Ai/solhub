import { useMemo, useRef, useState, useEffect } from "react";
import { AppWindow, ArrowRight, Globe, LayoutGrid, Search, ShieldCheck } from "lucide-react";
import type { Product } from "@/data/types";
import { rankProducts } from "@/lib/ranking";
import { productCategories, productCategoryName } from "@/data/product-categories";
import { formatDateIso } from "@/lib/utils";
import { p } from "@/lib/paths";
import { buildSearchIndex, searchIndex } from "@/lib/search";
import { cx, getLocale } from "@/lib/utils";
import { fetchHostedTools, type HostedTool } from "@/lib/hosted";
import { fetchLiveCommunity } from "@/lib/community";
import { fetchClicks, type ClickMap } from "@/lib/clicks";
import type { Locale } from "@/i18n";
import { getDict, translate } from "@/i18n";
import { productCategoryNameLocalized, productShortDescription } from "@/i18n/data";

interface Props {
  products: Product[];
  locale?: Locale;
}

/** 一级筛选：网站 / 工具（工具 = 目录里的在线工具 + 站内托管的 HTML 工具） */
type KindFilter = "all" | "site" | "tool";

function VerificationBadge({ status, isDemo, locale }: { status: Product["verificationStatus"]; isDemo: boolean; locale: Locale }) {
  const cfg = {
    verified: {
      label: locale === "en" ? "Verified" : "Verified",
      cls: "border-success/30 bg-success/10 text-success",
    },
    pending: { label: locale === "en" ? "Pending" : "Pending", cls: "border-warning/30 bg-warning/10 text-warning" },
    unverified: {
      label: locale === "en" ? "Unverified" : "Unverified",
      cls: "border-border-strong bg-secondary/60 text-muted-foreground",
    },
  }[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      {isDemo && (
        <span className="badge border-border-strong bg-secondary text-muted-foreground">{locale === "en" ? "Demo data" : "演示数据"}</span>
      )}
      <span className={cx("badge inline-flex items-center gap-1", cfg.cls)}>
        {status === "verified" && <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
        {cfg.label}
      </span>
    </span>
  );
}

export default function LaunchesExplorer({ products, locale = "zh" }: Props) {
  const dict = getDict(locale);

  /* 社区那部分产品以云端实时数据为准：静态构建里的 community.json 可能是旧的
     （用户删了但仓库没同步成功 → 列表还挂着已删除的产品）。接口失败就退回构建期数据。 */
  const [liveCommunity, setLiveCommunity] = useState<Product[] | null>(null);
  useEffect(() => {
    if (!products.some((p) => p.submittedBy)) return;
    let alive = true;
    fetchLiveCommunity().then((list) => {
      if (alive && list) setLiveCommunity(list);
    });
    return () => {
      alive = false;
    };
  }, [products]);

  /* 点击量：排序第二优先级（核验等级之后），拿不到就退回精选顺序 */
  const [clicks, setClicks] = useState<ClickMap>({});
  useEffect(() => {
    let alive = true;
    fetchClicks().then((map) => {
      if (alive) setClicks(map);
    });
    return () => {
      alive = false;
    };
  }, []);

  const catalog = useMemo(() => {
    if (!liveCommunity) return products;
    /* 目录收录的（无 submittedBy）留在构建期数据里，社区条目整体换成实时的 */
    return [...products.filter((p) => !p.submittedBy), ...liveCommunity];
  }, [products, liveCommunity]);

  const ranked = useMemo(() => rankProducts(catalog, clicks), [catalog, clicks]);
  const categories = useMemo(() => {
    const set = new Set(catalog.map((p) => p.category));
    return Array.from(set);
  }, [catalog]);

  /* 公开托管工具：客户端拉取（接口异常就当作没有，不影响静态列表） */
  const [hosted, setHosted] = useState<HostedTool[]>([]);
  useEffect(() => {
    let alive = true;
    fetchHostedTools().then((list) => {
      if (alive) setHosted(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [kind, setKind] = useState<KindFilter>("all");
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<"ranked" | "newest">("ranked");
  const [query, setQuery] = useState("");
  const urlSynced = useRef(false);

  /* 首页搜索条提交后带 ?q= 跳到这里：挂载后读一次，命中就把关键词填进搜索框。
     用 effect 而不是 useState 初始值 —— SSR 阶段没有 location，写成初始值会导致水合不一致。 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) setQuery(q);
    const k = params.get("kind");
    if (k === "site" || k === "tool") setKind(k);
  }, []);

  /* 关键词 / 形态变化时写回地址栏，方便分享。首次渲染跳过，避免地址栏闪动。 */
  useEffect(() => {
    if (!urlSynced.current) {
      urlSynced.current = true;
      return;
    }
    const url = new URL(window.location.href);
    const q = query.trim();
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    if (kind === "all") url.searchParams.delete("kind");
    else url.searchParams.set("kind", kind);
    window.history.replaceState(null, "", url.toString());
  }, [query, kind]);

  /* 分类 chips：产品分类 + 托管工具实际用到的分类，按 productCategories 顺序排 */
  const categoryChips = useMemo(() => {
    const set = new Set(categories);
    hosted.forEach((t) => set.add(t.category));
    const ordered = productCategories.filter((c) => set.has(c.slug)).map((c) => c.slug);
    const extra = Array.from(set).filter((c) => !ordered.includes(c));
    return [...ordered, ...extra];
  }, [categories, hosted]);

  /* 口径（2026-11-20 用户定）：目录收录的一律算「网站」（外链），
     「工具」只指用户上传、站内沙箱运行的 HTML 工具。 */
  const kindCounts = useMemo(
    () => ({ site: ranked.length, tool: hosted.length, all: ranked.length + hosted.length }),
    [ranked, hosted],
  );

  const filteredProducts = useMemo(() => {
    let list = kind === "tool" ? [] : ranked;
    if (category !== "all") {
      list = list.filter((p) => p.category === category);
    }
    if (query.trim()) {
      /* 复用首页搜索条同一套索引与评分，保证「首页能搜到的，这里也一定搜得到」 */
      const matched = new Set(
        searchIndex(query, buildSearchIndex(catalog, locale), locale).map((e) => e.slug),
      );
      list = list.filter((p) => matched.has(p.slug));
    }
    return list;
  }, [ranked, kind, category, query, locale, catalog]);

  const filteredHosted = useMemo(() => {
    if (kind === "site") return [];
    const q = query.trim().toLowerCase();
    return hosted
      .filter((t) => (category === "all" ? true : t.category === category))
      .filter((t) =>
        !q ? true : `${t.name} ${t.description} ${t.tags.join(" ")}`.toLowerCase().includes(q),
      )
      .slice()
      /* 工具与产品同一套口径：先按点击量，再按收录时间 */
      .sort((a, b) => {
        const ca = Number(clicks[`tool-${a.id}`]) || 0;
        const cb = Number(clicks[`tool-${b.id}`]) || 0;
        if (ca !== cb) return cb - ca;
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
  }, [hosted, kind, category, query, clicks]);

  /* 列表行：产品 + 托管工具合并，按排序规则排列 */
  const rows = useMemo(() => {
    const prodRows = filteredProducts.map((p) => ({ type: "product" as const, p, order: null as number | null }));
    /* 托管工具没有目录排名，序号接在目录产品之后，保证列表编号连续好看 */
    const hostedRows = filteredHosted.map((t, i) => ({
      type: "hosted" as const,
      t,
      order: (ranked.length + i + 1) as number | null,
    }));
    if (sort === "newest") {
      return [...prodRows, ...hostedRows].sort((a, b) => {
        const da = a.type === "product" ? a.p.publishedAt : a.t.createdAt;
        const db = b.type === "product" ? b.p.publishedAt : b.t.createdAt;
        return new Date(db).getTime() - new Date(da).getTime();
      });
    }
    return [...prodRows, ...hostedRows];
  }, [filteredProducts, filteredHosted, sort, ranked]);

  const shown = rows;
  const total = rows.length;
  const rankOf = (p: Product) => ranked.findIndex((r) => r.id === p.id) + 1;

  const kindTabs: { key: KindFilter; label: string; count: number; icon: typeof Globe }[] = [
    { key: "all", label: locale === "en" ? "All" : "全部", count: kindCounts.all, icon: LayoutGrid },
    { key: "site", label: locale === "en" ? "Websites" : "网站", count: kindCounts.site, icon: Globe },
    { key: "tool", label: locale === "en" ? "Tools" : "工具", count: kindCounts.tool, icon: AppWindow },
  ];

  return (
    <div>
      {/* 从首页搜索跳过来时的关键词提示条：让人一眼确认「搜的就是这个词」 */}
      {query.trim() && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-accent/25 bg-accent/[0.06] px-3 py-2 text-[12px] text-muted-foreground">
          <span>
            {locale === "en" ? "Results for " : "搜索结果："}
            <strong className="font-medium text-foreground">“{query.trim()}”</strong>
            {locale === "en" ? ` · ${total} found` : ` · 共 ${total} 个`}
          </span>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-accent underline-offset-2 hover:underline"
          >
            {locale === "en" ? "Clear" : "清除关键词"}
          </button>
        </div>
      )}

      {/* 一级筛选：网站 / 工具 —— 与活动页同一套分段控件（灰底 + 白胶囊） */}
      <div className="seg mb-3 inline-flex flex-wrap items-center gap-1 rounded-[12px] p-1">
        {kindTabs.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setKind(key)}
            aria-pressed={kind === key}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              kind === key ? "seg-thumb text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            <span className={cx("text-[11px] tabular-nums", kind === key ? "text-foreground/55" : "text-muted-foreground/70")}>{count}</span>
          </button>
        ))}
      </div>

      {/* 筛选与排序工具条 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 分类：与活动页同一套橙描边胶囊；「全部分类」独立成一档，不再靠"再点取消" */}
          <button
            type="button"
            onClick={() => setCategory("all")}
            aria-pressed={category === "all"}
            className={cx(
              "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
              category === "all"
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {locale === "en" ? "All categories" : "全部分类"}
          </button>
          {categoryChips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cx(
                "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
                category === c
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {productCategoryNameLocalized(c, productCategoryName(c), locale)}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={locale === "en" ? "Search by name, description or tag…" : "搜索名称、介绍或标签…"}
              className="input !pl-8"
              aria-label={locale === "en" ? "Search products" : "搜索产品"}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{locale === "en" ? "Sort" : "排序"}</span>
            <div className="inline-flex rounded-[6px] border border-border bg-card p-0.5" role="group" aria-label={locale === "en" ? "Sort order" : "排序方式"}>
              {(
                [
                  ["ranked", locale === "en" ? "Curated" : "精选顺序"],
                  ["newest", locale === "en" ? "Newest" : "最新收录"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSort(key)}
                  aria-pressed={sort === key}
                  className={cx(
                    "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors",
                    sort === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="mt-6">
        {shown.length === 0 && (
          <div className="card p-10 text-center">
            <p className="text-sm text-foreground/70">{locale === "en" ? "Nothing matches your criteria." : "没有符合条件的内容。"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{locale === "en" ? "Try adjusting the category, keywords or sort order." : "试试调整分类、关键词或排序方式。"}</p>
          </div>
        )}

        <ul className="divide-y divide-border rounded-[8px] border border-border bg-card">
          {shown.map((row) => {
            /* ---------- 在线工具（站内托管，沙箱运行） ---------- */
            if (row.type === "hosted") {
              const t = row.t;
              return (
                <li key={`hosted-${t.id}`}>
                  <a
                    href={p(`/tools/?id=${t.id}`, locale)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-secondary/40 sm:px-5"
                  >
                    {sort === "ranked" && row.order !== null ? (
                      <span
                        className="font-display w-7 shrink-0 text-center text-base font-bold text-muted-foreground/50"
                        aria-label={`${locale === "en" ? "Rank" : "第"} ${row.order} ${locale === "en" ? "" : "名"}`}
                      >
                        #{row.order}
                      </span>
                    ) : (
                      <span className="w-7 shrink-0" aria-hidden="true" />
                    )}
                    {t.logoUrl ? (
                      <img
                        src={t.logoUrl}
                        alt=""
                        loading="lazy"
                        className="h-10 w-10 shrink-0 rounded-[8px] border border-border object-cover"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border bg-secondary text-foreground/60" aria-hidden="true">
                        <AppWindow className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-display text-[15px] font-bold text-foreground group-hover:text-accent">{t.name}</span>
                        {/* 与目录产品同一套标签：形态（灰）+ 分类（灰）+ 核验状态，不给托管工具搞特殊样式 */}
                        <span className="badge border-border-strong bg-secondary/60 text-muted-foreground">
                          {locale === "en" ? "Tool" : "工具"}
                        </span>
                        <span className="badge border-border-strong bg-secondary/60 text-muted-foreground">
                          {productCategoryNameLocalized(t.category, productCategoryName(t.category), locale)}
                        </span>
                        <span className="badge inline-flex items-center gap-1 border-success/30 bg-success/10 text-success">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          Verified
                        </span>
                      </span>
                      {t.description && (
                        <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{t.description}</span>
                      )}
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground/60">
                          {productCategoryNameLocalized(t.category, productCategoryName(t.category), locale)}
                        </span>
                        {t.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                        <span>{locale === "en" ? `Added ${formatDateIso(t.createdAt)}` : `收录于 ${formatDateIso(t.createdAt)}`}</span>
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
                  </a>
                </li>
              );
            }

            /* ---------- 目录产品（网站 / 外链工具） ---------- */
            const product = row.p;
            const rank = sort === "ranked" ? rankOf(product) : null;
            return (
              <li key={product.id}>
                <a
                  href={p(`/products/${product.slug}/`, locale)}
                  className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-secondary/40 sm:px-5"
                >
                  {rank !== null ? (
                    <span
                      className={cx(
                        "font-display w-7 shrink-0 text-center text-base font-bold",
                        rank === 1 ? "text-accent" : rank === 2 ? "text-foreground/80" : "text-muted-foreground/50",
                      )}
                      aria-label={`${locale === "en" ? "Rank" : "第"} ${rank} ${locale === "en" ? "" : "名"}`}
                    >
                      #{rank}
                    </span>
                  ) : (
                    <span className="w-7 shrink-0" aria-hidden="true" />
                  )}
                  {product.icon ? (
                    <img src={product.icon} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-[8px] border border-border bg-card object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border bg-secondary font-display text-sm font-bold text-foreground/70" aria-hidden="true">
                      {product.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-display text-[15px] font-bold text-foreground group-hover:text-accent">
                        {product.name}
                      </span>
                      <span className="badge border-border-strong bg-secondary/60 text-muted-foreground">
                        {locale === "en" ? "Website" : "网站"}
                      </span>
                      <span className="badge border-border-strong bg-secondary/60 text-muted-foreground">
                        {productCategoryNameLocalized(product.category, productCategoryName(product.category), locale)}
                      </span>
                      <VerificationBadge status={product.verificationStatus} isDemo={product.isDemo} locale={locale} />
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                      {productShortDescription(product.slug, product.shortDescription, locale)}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/60">{productCategoryNameLocalized(product.category, productCategoryName(product.category), locale)}</span>
                      {product.tags.slice(0, 3).map((t) => (
                        <span key={t}>#{t}</span>
                      ))}
                      <span>{locale === "en" ? `Added ${formatDateIso(product.publishedAt)}` : `收录于 ${formatDateIso(product.publishedAt)}`}</span>
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
                </a>
              </li>
            );
          })}

        </ul>
      </div>

      <div className="mt-4 flex flex-col items-center gap-1.5">
        <p className="text-center text-xs text-muted-foreground">
          {/* 筛了某一类时先说当前结果，再给全站总数，避免「共 1 个 · 9 个网站」这种自相矛盾 */}
          {kind === "all"
            ? locale === "en"
              ? `${total} listed · ${kindCounts.site} websites · ${kindCounts.tool} tools · verification reflects actual SolHub checks`
              : `共 ${total} 个 · ${kindCounts.site} 个网站 · ${kindCounts.tool} 个工具 · 核验状态以 SolHub 实际核验为准`
            : locale === "en"
              ? `${total} ${kind === "site" ? "websites" : "tools"} · ${kindCounts.all} in total · verification reflects actual SolHub checks`
              : `共 ${total} 个${kind === "site" ? "网站" : "工具"} · 全站共 ${kindCounts.all} 个 · 核验状态以 SolHub 实际核验为准`}
        </p>
        <a
          href={p("/submit/?type=hosted", locale)}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-2 hover:text-accent hover:underline"
        >
          {locale === "en" ? "Upload your own HTML tool" : "上传自己的 HTML 工具"}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
