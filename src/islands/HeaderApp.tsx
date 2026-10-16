import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Languages,
  Menu,
  Monitor,
  Moon,
  Search,
  Smartphone,
  Sun,
  X,
} from "lucide-react";
import type { SearchIndexEntry } from "@/data/types";
import { searchIndex } from "@/lib/search";
import { cx } from "@/lib/utils";
import { p } from "@/lib/paths";
import { getDict, translate } from "@/i18n";
import type { Locale } from "@/i18n";

interface Props {
  currentRoute: string;
  searchIndex: SearchIndexEntry[];
  locale?: Locale;
}

export default function HeaderApp({ currentRoute, searchIndex, locale = "zh" }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const dict = getDict(locale);

  const NAV: { label: string; path: string; match: (r: string) => boolean }[] = [
    { label: translate(dict, "nav.discover"), path: "/", match: (r) => r === "/" },
    { label: translate(dict, "nav.launches"), path: "/launches/", match: (r) => r.startsWith("/launches/") },
    { label: translate(dict, "nav.tools"), path: "/tools/", match: (r) => r.startsWith("/tools/") },
    { label: translate(dict, "nav.about"), path: "/about/", match: (r) => r.startsWith("/about/") },
  ];

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
      <div className="container-page flex h-14 items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Logo locale={locale} />
        </div>

        {/* 桌面导航 */}
        <nav className="hidden items-center gap-1 md:flex" aria-label={translate(dict, "nav.mainNav")}>
          {NAV.map((item) => (
            <a
              key={item.path}
              href={p(item.path, locale)}
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
            aria-label={translate(dict, "nav.search")}
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{translate(dict, "nav.search")}</span>
            <kbd className="hidden rounded-[2px] border border-border bg-secondary px-1 text-[10px] font-medium text-muted-foreground lg:inline">
              /
            </kbd>
          </button>

          <a href={p("/submit/", locale)} className="btn btn-accent hidden !h-8 px-3 sm:inline-flex">
            {translate(dict, "nav.submit")}
          </a>

          {/* 移动端菜单按钮 */}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] text-foreground hover:bg-secondary md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? translate(dict, "nav.menuClose") : translate(dict, "nav.menuOpen")}
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          {/* 右上角靠边：语言 / 主题 / 视口 三个控件 */}
          <span className="mx-0.5 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          <LangButton locale={locale} currentRoute={currentRoute} />
          <ThemeButton />
          <ViewportButton />
        </div>
      </div>

      {/* 移动端菜单 */}
      {menuOpen && (
        <nav
          className="animate-fade-in border-t border-border bg-background md:hidden"
          aria-label={translate(dict, "nav.mobileNav")}
        >
          <div className="container-page flex flex-col py-2">
            {NAV.map((item) => (
              <a
                key={item.path}
                href={p(item.path, locale)}
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
              href={p("/submit/", locale)}
              onClick={() => setMenuOpen(false)}
              className="btn btn-accent mt-2 w-full"
            >
              {translate(dict, "nav.submit")}
            </a>
          </div>
        </nav>
      )}

      {/* 全局搜索浮层 */}
      {searchOpen && (
        <SearchDialog
          index={searchIndex}
          locale={locale}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </header>
  );
}

/* ---------------- 左上角三个控件 ---------------- */

function IconButton({
  label,
  onClick,
  children,
  ariaPressed,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  ariaPressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={ariaPressed}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] border border-border bg-card text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** 中英翻译按钮：点击跳转到另一语言版本的当前页面 */
function LangButton({ locale, currentRoute }: { locale: Locale; currentRoute: string }) {
  const other: Locale = locale === "zh" ? "en" : "zh";
  const target = p(currentRoute, other);
  const label = other === "en" ? "Switch to English" : "切换到中文";
  return (
    <a
      href={target}
      onClick={() => {
        try {
          localStorage.setItem("solhub:lang", other);
        } catch {
          /* 忽略 */
        }
      }}
      aria-label={label}
      title={label}
      className="inline-flex h-8 items-center gap-1 rounded-[2px] border border-border bg-card px-2 text-xs font-semibold text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <Languages className="h-3.5 w-3.5" aria-hidden="true" />
      {locale === "zh" ? "EN" : "中"}
    </a>
  );
}

/** 深浅色切换按钮 */
function ThemeButton() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      setDark(document.documentElement.classList.contains("dark"));
    } catch {
      /* 忽略 */
    }
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    const root = document.documentElement;
    root.classList.add("theme-transition");
    if (next) root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("solhub:theme", next ? "dark" : "light");
    } catch {
      /* 忽略 */
    }
    // 过渡结束后移除类，避免持续拦截过渡
    window.setTimeout(() => root.classList.remove("theme-transition"), 350);
  };
  const label = dark ? "切换到浅色" : "切换到深色";
  return (
    <IconButton label={label} onClick={toggle} ariaPressed={dark}>
      {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </IconButton>
  );
}

/** 手机 / 电脑视口切换按钮 */
function ViewportButton() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    try {
      setMobile(document.documentElement.classList.contains("viewport-mobile"));
    } catch {
      /* 忽略 */
    }
  }, []);
  const toggle = () => {
    const next = !mobile;
    setMobile(next);
    const root = document.documentElement;
    if (next) root.classList.add("viewport-mobile");
    else root.classList.remove("viewport-mobile");
    try {
      localStorage.setItem("solhub:viewport", next ? "mobile" : "desktop");
    } catch {
      /* 忽略 */
    }
  };
  const label = mobile ? "切换到电脑视图" : "切换到手机视图";
  return (
    <IconButton label={label} onClick={toggle} ariaPressed={mobile}>
      {mobile ? <Monitor className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
    </IconButton>
  );
}

function Logo({ size = 22, locale = "zh" }: { size?: number; locale?: Locale }) {
  return (
    <a
      href={p("/", locale)}
      className="inline-flex items-center gap-2 leading-none"
      aria-label={translate(getDict(locale), "nav.homeAria")}
    >
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

/* ---------------- 搜索浮层 ---------------- */

function SearchDialog({
  index,
  locale,
  onClose,
}: {
  index: SearchIndexEntry[];
  locale: Locale;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchIndexEntry[]>([]);
  const dict = getDict(locale);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setResults(searchIndex(query, index, locale));
    setActive(0);
  }, [query, index, locale]);

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
        window.location.href = resultHref(target, locale);
      }
    }
  };

  const resultHref = (r: SearchIndexEntry, loc: Locale) =>
    r.kind === "tool" ? p(`/tools/${r.slug}/`, loc) : p(`/products/${r.slug}/`, loc);

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
      aria-label={translate(dict, "search.aria")}
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
              placeholder={translate(dict, "search.placeholder")}
              className="h-12 w-full bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              aria-label={translate(dict, "search.aria")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label={translate(dict, "search.clear")}
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
                {translate(dict, "search.hint")}
                <br />
                <span className="text-xs">{translate(dict, "search.hintTips")}</span>
              </p>
            )}

            {query.trim() !== "" && results.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-foreground/70">
                  {translate(dict, "search.emptyTitle", { q: query.trim() })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{translate(dict, "search.emptyHint")}</p>
                <a
                  href={p("/submit/", locale)}
                  onClick={onClose}
                  className="btn btn-outline mt-4 !h-8 px-3 text-xs"
                >
                  {translate(dict, "nav.submit")}
                </a>
              </div>
            )}

            {grouped.tools.length > 0 && (
              <div>
                <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {translate(dict, "search.tools")}
                </p>
                {grouped.tools.map((r, i) => (
                  <SearchRow key={r.slug} entry={r} active={i === active} locale={locale} onMouseEnter={() => setActive(i)} />
                ))}
              </div>
            )}
            {grouped.products.length > 0 && (
              <div>
                <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {translate(dict, "search.products")}
                  {grouped.products.some((x) => x.isDemo) && (
                    <span className="ml-1.5 font-normal normal-case text-muted-foreground/70">
                      {translate(dict, "search.demoNote")}
                    </span>
                  )}
                </p>
                {grouped.products.map((r, i) => (
                  <SearchRow
                    key={r.slug}
                    entry={r}
                    active={i + grouped.tools.length === active}
                    locale={locale}
                    onMouseEnter={() => setActive(i + grouped.tools.length)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>{translate(dict, "search.shortcut")}</span>
            <span className="hidden sm:inline">{translate(dict, "search.localNote")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchRow({
  entry,
  active,
  locale,
  onMouseEnter,
}: {
  entry: SearchIndexEntry;
  active: boolean;
  locale: Locale;
  onMouseEnter: () => void;
}) {
  const dict = getDict(locale);
  return (
    <a
      href={entry.kind === "tool" ? p(`/tools/${entry.slug}/`, locale) : p(`/products/${entry.slug}/`, locale)}
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
              {translate(dict, "common.demo")}
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
