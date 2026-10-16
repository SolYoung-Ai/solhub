import { useEffect, useRef, useState } from "react";
import { ArrowRight, Menu, Search, X } from "lucide-react";
import type { SearchIndexEntry } from "@/data/types";
import { searchIndex } from "@/lib/search";
import { cx } from "@/lib/utils";
import { p } from "@/lib/paths";

interface Props {
  currentRoute: string;
  searchIndex: SearchIndexEntry[];
}

const NAV: { label: string; path: string; match: (r: string) => boolean }[] = [
  { label: "Discover", path: "/", match: (r) => r === "/" },
  { label: "Launches", path: "/launches/", match: (r) => r.startsWith("/launches/") },
  { label: "Tools", path: "/tools/", match: (r) => r.startsWith("/tools/") },
  { label: "About", path: "/about/", match: (r) => r.startsWith("/about/") },
];

function Logo({ size = 22 }: { size?: number }) {
  return (
    <a href={p("/")} className="inline-flex items-center gap-2 leading-none" aria-label="SolHub 首页">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="shrink-0 text-foreground">
        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
        <line x1="16" y1="16" x2="9.4" y2="9.4" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="16" y1="16" x2="22.6" y2="22.6" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <line x1="16" y1="16" x2="23.9" y2="11.7" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        <circle cx="16" cy="16" r="4.4" fill="var(--color-accent)" />
        <circle cx="9.4" cy="9.4" r="2" fill="currentColor" />
        <circle cx="22.6" cy="22.6" r="2" fill="currentColor" />
        <circle cx="23.9" cy="11.7" r="1.6" fill="var(--color-accent)" />
      </svg>
      <span className="font-display text-[17px] font-bold tracking-tight text-foreground">SolHub</span>
    </a>
  );
}

export default function HeaderApp({ currentRoute, searchIndex }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // 全局搜索打开事件：首页 Hero 搜索条等位置触发
  useEffect(() => {
    const onOpen = () => setSearchOpen(true);
    window.addEventListener("solhub:open-search", onOpen);
    return () => window.removeEventListener("solhub:open-search", onOpen);
  }, []);

  // Esc 关闭浮层 / 菜单
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 打开搜索时锁定滚动
  useEffect(() => {
    if (searchOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [searchOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="container-page flex h-14 items-center justify-between gap-4">
        <Logo />

        {/* 桌面导航 */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="主导航">
          {NAV.map((item) => (
            <a
              key={item.path}
              href={p(item.path)}
              aria-current={item.match(currentRoute) ? "page" : undefined}
              className={cx(
                "rounded-[2px] px-3 py-1.5 text-sm font-medium transition-colors",
                item.match(currentRoute)
                  ? "bg-secondary text-foreground"
                  : "text-foreground/70 hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="inline-flex h-8 items-center gap-2 rounded-[2px] border border-border-strong bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            aria-label="搜索产品或工具"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">搜索</span>
            <kbd className="hidden rounded-[2px] border border-border bg-secondary px-1 text-[10px] font-medium text-muted-foreground lg:inline">
              /
            </kbd>
          </button>

          <a href={p("/submit/")} className="btn btn-accent hidden !h-8 px-3 sm:inline-flex">
            Submit a Product
          </a>

          {/* 移动端菜单按钮 */}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] text-foreground hover:bg-secondary md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 移动端菜单 */}
      {menuOpen && (
        <nav
          className="animate-fade-in border-t border-border bg-background md:hidden"
          aria-label="移动端导航"
        >
          <div className="container-page flex flex-col py-2">
            {NAV.map((item) => (
              <a
                key={item.path}
                href={p(item.path)}
                onClick={() => setMenuOpen(false)}
                aria-current={item.match(currentRoute) ? "page" : undefined}
                className={cx(
                  "flex items-center justify-between rounded-[2px] px-3 py-3 text-[15px] font-medium",
                  item.match(currentRoute)
                    ? "bg-secondary text-foreground"
                    : "text-foreground/80 hover:bg-secondary/60",
                )}
              >
                {item.label}
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </a>
            ))}
            <a
              href={p("/submit/")}
              onClick={() => setMenuOpen(false)}
              className="btn btn-accent mt-2 w-full"
            >
              Submit a Product
            </a>
          </div>
        </nav>
      )}

      {/* 全局搜索浮层 */}
      {searchOpen && (
        <SearchDialog
          index={searchIndex}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </header>
  );
}

/* ---------------- 搜索浮层 ---------------- */

function SearchDialog({ index, onClose }: { index: SearchIndexEntry[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchIndexEntry[]>([]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setResults(searchIndex(query, index));
    setActive(0);
  }, [query, index]);

  const onKeyDown = (e: import("react").KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[active];
      if (target) {
        window.location.href = resultHref(target);
      }
    }
  };

  const resultHref = (r: SearchIndexEntry) =>
    r.kind === "tool" ? p(`/tools/${r.slug}/`) : p(`/products/${r.slug}/`);

  const grouped = results.reduce<{ products: SearchIndexEntry[]; tools: SearchIndexEntry[] }>(
    (acc, r) => {
      if (r.kind === "tool") acc.tools.push(r);
      else acc.products.push(r);
      return acc;
    },
    { products: [], tools: [] },
  );

  return (
    <div
      className="fixed inset-0 z-50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="全局搜索"
    >
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 top-0 mx-auto w-full max-w-2xl px-4 pt-16 sm:pt-24">
        <div className="animate-dialog-in overflow-hidden rounded-[4px] border border-border bg-card shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              type="text"
              placeholder="搜索产品或工具…"
              className="h-12 w-full bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              aria-label="搜索产品或工具"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="清除搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <kbd className="hidden shrink-0 rounded-[2px] border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              ESC
            </kbd>
          </div>

          <div className="max-h-[60vh] overflow-y-auto scroll-x py-2">
            {query.trim() === "" && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                输入关键词，搜索产品与工具。
                <br />
                <span className="text-xs">提示：试试 “json”“二维码”“视频” 或 “SolYoung”</span>
              </p>
            )}

            {query.trim() !== "" && results.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-foreground/70">没有找到与「{query.trim()}」相关的内容。</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  可以换个关键词，或者去提交一个产品。
                </p>
                <a
                  href={p("/submit/")}
                  onClick={onClose}
                  className="btn btn-outline mt-4 !h-8 px-3 text-xs"
                >
                  Submit a Product
                </a>
              </div>
            )}

            {grouped.tools.length > 0 && (
              <div>
                <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tools
                </p>
                {grouped.tools.map((r, i) => (
                  <SearchRow key={r.slug} entry={r} active={i === active} onMouseEnter={() => setActive(i)} />
                ))}
              </div>
            )}
            {grouped.products.length > 0 && (
              <div>
                <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Products
                  {grouped.products.some((x) => x.isDemo) && (
                    <span className="ml-1.5 font-normal normal-case text-muted-foreground/70">（含演示数据）</span>
                  )}
                </p>
                {grouped.products.map((r, i) => (
                  <SearchRow
                    key={r.slug}
                    entry={r}
                    active={i + grouped.tools.length === active}
                    onMouseEnter={() => setActive(i + grouped.tools.length)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
            <span className="hidden sm:inline">所有数据在本地匹配，不发送搜索内容</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchRow({
  entry,
  active,
  onMouseEnter,
}: {
  entry: SearchIndexEntry;
  active: boolean;
  onMouseEnter: () => void;
}) {
  return (
    <a
      href={entry.kind === "tool" ? p(`/tools/${entry.slug}/`) : p(`/products/${entry.slug}/`)}
      onMouseEnter={onMouseEnter}
      className={cx(
        "mx-1.5 flex items-center justify-between gap-3 rounded-[2px] px-2.5 py-2",
        active ? "bg-secondary" : "hover:bg-secondary/50",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">
          {entry.name}
          {entry.kind === "product" && entry.isDemo && (
            <span className="ml-1.5 rounded-[2px] border border-border bg-secondary px-1 text-[10px] text-muted-foreground">
              演示
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {entry.categoryName}
      </span>
    </a>
  );
}
