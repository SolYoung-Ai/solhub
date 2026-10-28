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
import { fetchMe, type AuthUser } from "@/lib/auth";
import { cx } from "@/lib/utils";
import { p } from "@/lib/paths";
import { getDict, translate } from "@/i18n";
import type { Locale } from "@/i18n";
import AuthDialog from "@/islands/AuthDialog";

interface Props {
  currentRoute: string;
  searchIndex: SearchIndexEntry[];
  locale?: Locale;
}

export default function HeaderApp({ currentRoute, searchIndex, locale = "zh" }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const dict = getDict(locale);

  useEffect(() => {
    void fetchMe().then(setUser);
  }, []);

  const NAV: { label: string; path: string; match: (r: string) => boolean }[] = [
    { label: translate(dict, "nav.discover"), path: "/", match: (r) => r === "/" },
    { label: translate(dict, "nav.launches"), path: "/launches/", match: (r) => r.startsWith("/launches/") },
    { label: translate(dict, "nav.mySubmissions"), path: "/my-submissions/", match: (r) => r.startsWith("/my-submissions/") },
    { label: translate(dict, "nav.about"), path: "/about/", match: (r) => r.startsWith("/about/") },
  ];

  useEffect(() => {
    const onOpen = () => setSearchOpen(true);
    window.addEventListener("solhub:open-search", onOpen);
    return () => window.removeEventListener("solhub:open-search", onOpen);
  }, []);

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

  useEffect(() => {
    if (searchOpen || menuOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [searchOpen, menuOpen]);

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="container-page flex h-14 items-center justify-between gap-2">
        {/* 左侧：三条杠 + Logo */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] text-foreground hover:bg-secondary md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
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

        {/* 右侧功能按钮 */}
        <div className="flex items-center gap-1.5">
          {/* 搜索 - 所有屏幕都显示 */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] border border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            aria-label="搜索"
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {/* 登录 / 头像 - 所有屏幕都显示 */}
          {user ? (
            <a
              href={p("/my-submissions/", locale)}
              title={user.displayName || user.login}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border hover:border-foreground/40"
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-display text-[13px] font-bold uppercase text-foreground">
                  {(user.displayName || user.login).slice(0, 1)}
                </span>
              )}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="inline-flex h-8 items-center gap-1 rounded-[2px] border border-border bg-card px-2.5 text-xs font-medium text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {translate(dict, "nav.login")}
            </button>
          )}

          {/* 提交产品 - 桌面显示 */}
          <a href={p("/submit/", locale)} className="btn btn-accent hidden !h-8 px-2.5 sm:inline-flex !text-xs">
            {translate(dict, "nav.submit")}
          </a>

          <span className="mx-0.5 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          {/* 语言/主题 - 桌面显示 */}
          <div className="hidden sm:flex items-center gap-1">
            <LangButton locale={locale} currentRoute={currentRoute} />
            <ThemeButton />
          </div>
        </div>
      </div>

      {/* 全局搜索浮层 */}
      {searchOpen && (
        <SearchDialog index={searchIndex} locale={locale} onClose={() => setSearchOpen(false)} />
      )}

      {/* 登录 / 注册弹窗 */}
      {authOpen && <AuthDialog locale={locale} onClose={() => setAuthOpen(false)} />}
      </header>

      {/* 移动端侧边菜单 */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-[90] md:hidden bg-black/30"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed left-0 top-0 bottom-0 z-[100] md:hidden w-[280px] overflow-y-auto overscroll-contain shadow-2xl bg-[#f4f0e7] dark:bg-[#17140f] border-r border-border">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <span className="font-display text-lg font-bold text-foreground">SolHub</span>
              <button onClick={() => setMenuOpen(false)} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="px-3 py-2">
              {NAV.map((item) => (
                <a
                  key={item.path}
                  href={p(item.path, locale)}
                  onClick={() => setMenuOpen(false)}
                  className={cx(
                    "flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-colors",
                    item.match(currentRoute) ? "text-accent bg-accent/10" : "text-foreground/80 hover:bg-secondary/60",
                  )}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mx-5 my-3 border-t border-border/50" />
            <div className="px-3 py-2">
              <a
                href={p("/submit/", locale)}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium text-foreground/80 hover:bg-secondary/60"
              >
                {translate(dict, "nav.submit")}
              </a>
              {user ? (
                <a
                  href={p("/my-submissions/", locale)}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium text-accent"
                >
                  {user.displayName || user.login}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setAuthOpen(true); }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[15px] font-medium text-foreground/80 hover:bg-secondary/60"
                >
                  {translate(dict, "nav.login")}
                </button>
              )}
              <div className="flex items-center gap-4 px-3 py-3">
                <LangButton locale={locale} currentRoute={currentRoute} />
                <ThemeButton />
              </div>
            </div>
            <div className="mx-5 my-3 border-t border-border/50" />
            <div className="mx-5 mb-6 rounded-xl border border-dashed border-accent/30 bg-accent/5 p-4">
              <p className="text-sm font-semibold text-foreground">Feedback?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Bug, idea or suggestion — we read every one.</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- 登录按钮（已移除） ---------------- */

/* ---------------- 右上角控件 ---------------- */

function IconButton({
  label, onClick, children, ariaPressed,
}: {
  label: string; onClick: () => void; children: React.ReactNode; ariaPressed?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} title={label}
      aria-pressed={ariaPressed}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] border border-border bg-card text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {children}
    </button>
  );
}

function LangButton({ locale, currentRoute }: { locale: Locale; currentRoute: string }) {
  const other: Locale = locale === "zh" ? "en" : "zh";
  const target = p(currentRoute, other);
  return (
    <a
      href={target}
      onClick={() => { try { localStorage.setItem("solhub:lang", other); } catch {} }}
      aria-label={other === "en" ? "Switch to English" : "切换到中文"}
      title={other === "en" ? "Switch to English" : "切换到中文"}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] border border-border bg-card text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      <Languages className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

function ThemeButton() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try { setDark(document.documentElement.classList.contains("dark")); } catch {}
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    const root = document.documentElement;
    root.classList.add("theme-transition");
    if (next) root.classList.add("dark"); else root.classList.remove("dark");
    try { localStorage.setItem("solhub:theme", next ? "dark" : "light"); } catch {}
    window.setTimeout(() => root.classList.remove("theme-transition"), 350);
  };
  return (
    <IconButton label={dark ? "切换到浅色" : "切换到深色"} onClick={toggle} ariaPressed={dark}>
      {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </IconButton>
  );
}

function ViewportButton() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    try { setMobile(document.documentElement.classList.contains("viewport-mobile")); } catch {}
  }, []);
  const toggle = () => {
    const next = !mobile;
    setMobile(next);
    const root = document.documentElement;
    if (next) root.classList.add("viewport-mobile"); else root.classList.remove("viewport-mobile");
    try { localStorage.setItem("solhub:viewport", next ? "mobile" : "desktop"); } catch {}
  };
  return (
    <IconButton label={mobile ? "切换到电脑视图" : "切换到手机视图"} onClick={toggle} ariaPressed={mobile}>
      {mobile ? <Monitor className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
    </IconButton>
  );
}

/* ---------------- Logo ---------------- */

function Logo({ locale = "zh" }: { locale?: Locale }) {
  return (
    <a href={p("/", locale)} className="inline-flex items-center leading-none" aria-label="SolHub">
      <img
        src="/solhub-mark.png"
        alt=""
        width={56}
        height={56}
        className="shrink-0"
      />
      <span className="font-display text-[20px] font-bold tracking-tight text-foreground">SolHub</span>
    </a>
  );
}

/* ---------------- 搜索浮层 ---------------- */

function SearchDialog({
  index, locale, onClose,
}: {
  index: SearchIndexEntry[]; locale: Locale; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchIndexEntry[]>([]);
  const dict = getDict(locale);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    setResults(searchIndex(query, index, locale));
    setActive(0);
  }, [query, index, locale]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const t = results[active]; if (t) window.location.href = t.kind === "tool" ? p(`/tools/${t.slug}/`, locale) : p(`/products/${t.slug}/`, locale); }
  };

  return (
    <div className="fixed inset-0 z-50 animate-fade-in" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-x-0 top-0 mx-auto w-full max-w-2xl px-4 pt-16 sm:pt-24">
        <div className="animate-dialog-in overflow-hidden rounded-[4px] border border-border bg-card shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef} value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown} type="text"
              placeholder={translate(dict, "search.placeholder")}
              className="h-12 w-full bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-secondary">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto py-2">
            {query.trim() === "" && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{translate(dict, "search.hint")}</p>
            )}
            {results.map((r, i) => (
              <a
                key={r.slug}
                href={r.kind === "tool" ? p(`/tools/${r.slug}/`, locale) : p(`/products/${r.slug}/`, locale)}
                onMouseEnter={() => setActive(i)}
                className={cx("mx-1.5 flex items-center justify-between gap-3 rounded-[2px] px-2.5 py-2", active === i ? "bg-secondary" : "hover:bg-secondary/50")}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{r.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{r.categoryName}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
