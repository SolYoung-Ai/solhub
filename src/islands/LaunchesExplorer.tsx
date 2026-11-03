import { useMemo, useRef, useState, useEffect } from "react";
import { ArrowRight, Filter, Search, ShieldCheck } from "lucide-react";
import type { Product } from "@/data/types";
import { rankProducts } from "@/lib/ranking";
import { productCategoryName } from "@/data/product-categories";
import { formatDateIso } from "@/lib/utils";
import { p } from "@/lib/paths";
import { buildSearchIndex, searchIndex } from "@/lib/search";
import { cx, getLocale } from "@/lib/utils";
import type { Locale } from "@/i18n";
import { getDict, translate } from "@/i18n";
import { productCategoryNameLocalized, productShortDescription } from "@/i18n/data";

interface Props {
  products: Product[];
  locale?: Locale;
}

const PAGE_SIZE = 8;

interface CommunityItem {
  id: number;
  name: string;
  url: string;
  icon?: string;
  description: string;
  createdAt: string;
}

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
  const ranked = useMemo(() => rankProducts(products), [products]);
  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return Array.from(set);
  }, [products]);

  const [community] = useState<CommunityItem[]>([]);

  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<"ranked" | "newest">("ranked");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const urlSynced = useRef(false);

  /* 首页搜索条提交后带 ?q= 跳到这里：挂载后读一次，命中就把关键词填进搜索框。
     用 effect 而不是 useState 初始值 —— SSR 阶段没有 location，写成初始值会导致水合不一致。 */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setQuery(q);
      setVisible(PAGE_SIZE);
    }
  }, []);

  /* 关键词变化时把它写回地址栏，方便分享 / 刷新后还在。
     首次渲染跳过（那一次由上面的读 URL 负责），避免把 ?q= 先删掉再写回导致地址栏闪动。 */
  useEffect(() => {
    if (!urlSynced.current) {
      urlSynced.current = true;
      return;
    }
    const url = new URL(window.location.href);
    const q = query.trim();
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }, [query]);

  const filtered = useMemo(() => {
    let list = ranked;
    if (category !== "all") {
      list = list.filter((p) => p.category === category);
    }
    if (query.trim()) {
      /* 复用首页搜索条同一套索引与评分，保证「首页能搜到的，这里也一定搜得到」 */
      const matched = new Set(
        searchIndex(query, buildSearchIndex(products, locale), locale).map((e) => e.slug),
      );
      list = list.filter((p) => matched.has(p.slug));
    }
    if (sort === "newest") {
      list = [...list].sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );
    }
    return list;
  }, [ranked, category, query, sort, locale]);

  const shown = filtered.slice(0, visible);
  const rankOf = (p: Product) => ranked.findIndex((r) => r.id === p.id) + 1;

  return (
    <div>
      {/* 从首页搜索跳过来时的关键词提示条：让人一眼确认「搜的就是这个词」 */}
      {query.trim() && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-accent/25 bg-accent/[0.06] px-3 py-2 text-[12px] text-muted-foreground">
          <span>
            {locale === "en" ? "Results for " : "搜索结果："}
            <strong className="font-medium text-foreground">“{query.trim()}”</strong>
            {locale === "en" ? ` · ${filtered.length} found` : ` · 共 ${filtered.length} 个`}
          </span>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setVisible(PAGE_SIZE);
            }}
            className="text-accent underline-offset-2 hover:underline"
          >
            {locale === "en" ? "Clear" : "清除关键词"}
          </button>
        </div>
      )}

      {/* 筛选与排序工具条 */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            {locale === "en" ? "Category" : "分类"}
          </span>
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={cx(
              "rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors",
              category === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-foreground/70 hover:border-foreground/40",
            )}
          >
            {locale === "en" ? "All" : "全部"}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cx(
                "rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors",
                category === c
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground/70 hover:border-foreground/40",
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
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(PAGE_SIZE);
              }}
              placeholder={locale === "en" ? "Search by name, description or tag…" : "搜索产品名称、介绍或标签…"}
              className="input !pl-8"
              aria-label={locale === "en" ? "Search products" : "搜索产品"}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{locale === "en" ? "Sort" : "排序"}</span>
            <div className="inline-flex rounded-[6px] border border-border bg-card p-0.5" role="group" aria-label={locale === "en" ? "Sort order" : "排序方式"}>
              {(
                [
                  ["ranked", locale === "en" ? "Ranked" : "榜单顺序"],
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
            <p className="text-sm text-foreground/70">{locale === "en" ? "No products match your criteria." : "没有符合条件的产品。"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{locale === "en" ? "Try adjusting the category, keywords or sort order." : "试试调整分类、关键词或排序方式。"}</p>
          </div>
        )}

        <ul className="divide-y divide-border rounded-[8px] border border-border bg-card">
          {shown.map((product) => {
            const rank = sort === "ranked" ? rankOf(product) : null;
            return (
              <li key={product.id}>
                <a
                  href={p(`/products/${product.slug}/`, locale)}
                  className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-secondary/40 sm:px-5"
                >
                  {rank !== null && (
                    <span
                      className={cx(
                        "font-display w-7 shrink-0 text-center text-base font-bold",
                        rank === 1 ? "text-accent" : rank === 2 ? "text-foreground/80" : "text-muted-foreground/50",
                      )}
                      aria-label={`${locale === "en" ? "Rank" : "第"} ${rank} ${locale === "en" ? "" : "名"}`}
                    >
                      #{rank}
                    </span>
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

          {/* 社区提交的产品（合并在同一列表，连续编号） */}
          {community.map((item, ci) => {
            const communityRank = sort === "ranked" ? filtered.length + ci + 1 : null;
            return (
              <li key={`community-${item.id}`}>
                <a
                  href={p(`/products/c-${item.id}/`, locale)}
                  className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-secondary/40 sm:px-5"
                >
                  {communityRank !== null && (
                    <span
                      className="font-display w-7 shrink-0 text-center text-base font-bold text-muted-foreground/50"
                      aria-label={`${locale === "en" ? "Rank" : "第"} ${communityRank} ${locale === "en" ? "" : "名"}`}
                    >
                      #{communityRank}
                    </span>
                  )}
                  {item.icon ? (
                    <img src={item.icon} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-[8px] border border-border bg-card object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border bg-secondary font-display text-sm font-bold text-foreground/70" aria-hidden="true">
                      {item.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-display text-[15px] font-bold text-foreground group-hover:text-accent">
                        {item.name}
                      </span>
                      <span className="badge border-accent/30 bg-accent/10 text-accent">{locale === "en" ? "Community" : "社区"}</span>
                    </span>
                    {item.description && (
                      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <span className="mt-1.5 text-[11px] text-muted-foreground">
                      {locale === "en" ? `Submitted ${item.createdAt}` : `提交于 ${item.createdAt}`}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
                </a>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 加载更多 */}
      {visible < filtered.length && (
        <div className="mt-6 text-center">
          <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)} className="btn btn-outline">
            {locale === "en" ? `Load more (${filtered.length - visible})` : `加载更多（${filtered.length - visible}）`}
          </button>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {locale === "en"
          ? `${filtered.length} products · verification reflects actual SolHub checks`
          : `共 ${filtered.length} 个产品 · 核验状态以 SolHub 实际核验为准`}
      </p>
    </div>
  );
}
