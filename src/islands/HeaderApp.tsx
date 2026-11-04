import { useEffect, useRef, useState } from "react";
import {
  Compass,
  Languages,
  LogOut,
  Moon,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Users,
  UserCog,
  UserRound,
  X,
} from "lucide-react";
import type { SearchIndexEntry } from "@/data/types";
import { searchIndex } from "@/lib/search";
import { avatarOf, fetchMe, logout, type AuthUser } from "@/lib/auth";
import { cx } from "@/lib/utils";
import { p } from "@/lib/paths";
import { getDict, translate } from "@/i18n";
import type { Locale } from "@/i18n";

interface Props {
  currentRoute: string;
  searchIndex: SearchIndexEntry[];
  locale?: Locale;
}

/**
 * 站点导航：桌面左右布局的左侧栏 + 手机端顶栏/底部标签栏。
 *
 * 三档：
 *   ≥1280px  完整侧栏（图标 + 文字，240px）
 *   1024–1279 折叠为图标栏（76px，仅图标，靠 title 提示）
 *   <1024px  顶栏（Logo/搜索/头像）+ 底部标签栏
 *
 * 设计语言沿用 SolHub：白底 + 暖灰描边 + 橙色激活态（不是 X 的黑白反色），
 * 这样侧栏只改变信息架构，不改变品牌观感。
 */
export default function HeaderApp({ currentRoute, searchIndex, locale = "zh" }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const dict = getDict(locale);
  const en = locale === "en";

  useEffect(() => {
    void fetchMe().then(setUser);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    const close = () => setUserMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [userMenuOpen]);

  const NAV: { label: string; path: string; icon: typeof Compass; match: (r: string) => boolean; bottom?: boolean }[] = [
    { label: translate(dict, "nav.discover"), path: "/", icon: Compass, match: (r) => r === "/" },
    { label: translate(dict, "nav.launches"), path: "/launches/", icon: Package, match: (r) => r.startsWith("/launches/") },
    { label: translate(dict, "nav.world"), path: "/world/", icon: Users, match: (r) => r.startsWith("/world/") },
    { label: translate(dict, "nav.mySubmissions"), path: "/my-submissions/", icon: UserRound, match: (r) => r.startsWith("/my-submissions/") },
  ];

  useEffect(() => {
    const onOpen = () => setSearchOpen(true);
    window.addEventListener("solhub:open-search", onOpen);
    return () => window.removeEventListener("solhub:open-search", onOpen);
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [searchOpen]);

  const displayName = user ? user.displayName || user.login : "";
  const handle = user ? user.handle || user.login : "";

  return (
    <>
      {/* ==================== 桌面：左侧固定栏 ==================== */}
      <aside
        className="app-sidebar sticky top-0 z-40 hidden h-screen shrink-0 flex-col border-r border-border bg-background lg:flex lg:w-[76px] xl:w-[244px]"
        aria-label={en ? "Main navigation" : "主导航"}
      >
        <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain px-3 py-5 xl:px-4">
          {/* Logo：图标栏只留标识，完整栏带字标 */}
          <a
            href={p("/", locale)}
            className="flex shrink-0 items-center justify-center gap-2.5 rounded-[8px] px-1 py-1 xl:justify-start xl:px-2"
            aria-label="SolHub"
          >
            <img src="/solhub-mark.png" alt="" width={30} height={30} className="shrink-0" />
            <span className="hidden font-display text-[19px] font-bold tracking-tight text-foreground xl:block">
              SolHub
            </span>
          </a>

          {/* 主导航 */}
          <nav className="mt-7 flex flex-col gap-1">
            {NAV.map((item) => {
              const on = item.match(currentRoute);
              const Icon = item.icon;
              return (
                <a
                  key={item.path}
                  href={p(item.path, locale)}
                  aria-current={on ? "page" : undefined}
                  title={item.label}
                  className={cx(
                    "group flex items-center justify-center gap-3 rounded-[8px] px-3 py-2.5 text-[14px] font-medium transition-colors xl:justify-start",
                    on
                      ? "bg-accent/10 text-accent"
                      : "text-foreground/65 hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={on ? 2.1 : 1.7} />
                  <span className="hidden xl:block">{item.label}</span>
                </a>
              );
            })}
          </nav>

          {/* 搜索：与导航同构，点击打开全站搜索浮层 */}
          <div className="my-2 h-px bg-border" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title={en ? "Search" : "搜索"}
            className="flex items-center justify-center gap-3 rounded-[8px] px-3 py-2.5 text-[14px] font-medium text-foreground/65 transition-colors hover:bg-secondary hover:text-foreground xl:justify-start"
          >
            <Search className="h-[19px] w-[19px] shrink-0" strokeWidth={1.7} />
            <span className="hidden xl:block">{en ? "Search" : "搜索"}</span>
          </button>

          {/* 主行动：紧跟导航区（对应 X 的「发帖」大按钮位置），
              不压在最底部 —— 底部只留辅助控件和账号，视觉重量更轻 */}
          <div className="mt-4 flex flex-col gap-2">
            {/* 提交产品：主行动，整个侧栏唯一的实心色块 */}
            <a
              href={p("/submit/", locale)}
              title={translate(dict, "nav.submit")}
              className="flex h-10 items-center justify-center gap-2 rounded-[8px] bg-accent text-[13px] font-semibold text-accent-foreground shadow-xs transition-colors hover:brightness-95"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="hidden xl:block">{translate(dict, "nav.submit")}</span>
            </a>
          </div>

          {/* 底部：辅助控件 → 账号 */}
          <div className="mt-auto flex flex-col gap-3 pt-6">
            <div className="flex flex-col items-center gap-1 xl:flex-row xl:gap-1">
              <LangButton locale={locale} currentRoute={currentRoute} />
              <ThemeButton />
            </div>

            {/* 账号 */}
            {user ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setUserMenuOpen((v) => !v); }}
                  aria-expanded={userMenuOpen}
                  aria-label={displayName}
                  title={displayName}
                  className="flex w-full items-center justify-center gap-2.5 rounded-[8px] p-1.5 transition-colors hover:bg-secondary xl:justify-start"
                >
                  <Avatar user={user} size={30} />
                  <span className="hidden min-w-0 text-left xl:block">
                    <span className="block truncate text-[13px] font-medium leading-4 text-foreground">{displayName}</span>
                    <span className="block truncate text-[11px] leading-4 text-muted-foreground">@{handle}</span>
                  </span>
                </button>

                {userMenuOpen && (
                  <div
                    className="fixed bottom-[86px] left-3 z-50 w-[228px] overflow-hidden rounded-[10px] border border-border bg-card py-1 shadow-xl xl:bottom-[92px] xl:left-4 xl:w-[212px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <UserMenuItems user={user} locale={locale} en={en} onNavigate={() => setUserMenuOpen(false)} />
                  </div>
                )}
              </div>
            ) : (
              <a
                href={p("/login/", locale)}
                className="flex h-9 items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium text-foreground/75 transition-colors hover:bg-secondary hover:text-foreground"
              >
                <UserRound className="h-4 w-4 shrink-0" />
                <span className="hidden xl:block">{translate(dict, "nav.login")}</span>
              </a>
            )}
          </div>
        </div>
      </aside>

      {/* ==================== 手机：顶栏 ==================== */}
      <header className="app-topbar sticky top-0 z-40 flex h-[52px] items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md lg:hidden">
        <a href={p("/", locale)} className="flex items-center gap-2" aria-label="SolHub">
          <img src="/solhub-mark.png" alt="" width={24} height={24} />
          <span className="font-display text-[17px] font-bold tracking-tight text-foreground">SolHub</span>
        </a>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={en ? "Search" : "搜索"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {user ? (
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setUserMenuOpen((v) => !v); }}
                aria-label={displayName}
                aria-expanded={userMenuOpen}
                className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border"
              >
                <Avatar user={user} size={32} />
              </button>
              {userMenuOpen && (
                <div
                  className="absolute right-0 top-10 z-50 w-[220px] overflow-hidden rounded-[10px] border border-border bg-card py-1 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <UserMenuItems user={user} locale={locale} en={en} onNavigate={() => setUserMenuOpen(false)} />
                </div>
              )}
            </div>
          ) : (
            <a
              href={p("/login/", locale)}
              className="inline-flex h-8 items-center rounded-[6px] border border-border bg-card px-2.5 text-xs font-medium text-foreground/80"
            >
              {translate(dict, "nav.login")}
            </a>
          )}
        </div>
      </header>

      {/* ==================== 手机：底部标签栏 ==================== */}
      <nav
        className="app-tabbar fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label={en ? "Main navigation" : "主导航"}
      >
        {NAV.filter((item) => item.bottom !== false).map((item) => {
          const on = item.match(currentRoute);
          const Icon = item.icon;
          return (
            <a
              key={item.path}
              href={p(item.path, locale)}
              aria-current={on ? "page" : undefined}
              className={cx(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] leading-none transition-colors",
                on ? "text-accent" : "text-muted-foreground",
              )}
            >
              <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={on ? 2.1 : 1.7} />
              <span className="truncate">{item.label}</span>
            </a>
          );
        })}
      </nav>

      {/* 全站搜索浮层 */}
      {searchOpen && <SearchDialog index={searchIndex} locale={locale} onClose={() => setSearchOpen(false)} />}
    </>
  );
}

/* ---------------- 头像 ---------------- */

function Avatar({ user, size = 32 }: { user: AuthUser; size?: number }) {
  const src = avatarOf(user);
  if (src) {
    return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-display text-[12px] font-bold uppercase text-foreground"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {(user.displayName || user.login).slice(0, 1)}
    </span>
  );
}

/* ---------------- 账号菜单（桌面侧栏 / 手机顶栏共用） ---------------- */

function UserMenuItems({
  user, locale, en, onNavigate,
}: {
  user: AuthUser; locale: Locale; en: boolean; onNavigate: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-3 py-2">
        <p className="truncate text-[13px] font-bold text-foreground">{user.displayName || user.login}</p>
        {user.email && <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>}
      </div>
      <a
        href={p("/my-submissions/", locale)}
        onClick={onNavigate}
        className="flex items-center gap-2 px-3 py-2 text-[13px] text-foreground/80 hover:bg-secondary"
      >
        <UserRound className="h-3.5 w-3.5" /> {en ? "My account" : "个人中心"}
      </a>
      <a
        href={p("/account/", locale)}
        onClick={onNavigate}
        className="flex items-center gap-2 px-3 py-2 text-[13px] text-foreground/80 hover:bg-secondary"
      >
        <UserCog className="h-3.5 w-3.5" /> {translate(getDict(locale), "nav.account")}
      </a>
      {user.isAdmin && (
        <a
          href={p("/guanli/")}
          onClick={onNavigate}
          className="flex items-center gap-2 px-3 py-2 text-[13px] text-foreground/80 hover:bg-secondary"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> {en ? "Admin" : "管理后台"}
        </a>
      )}
      <button
        type="button"
        onClick={() => { onNavigate(); void logout().then(() => window.location.reload()); }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground/80 hover:bg-secondary hover:text-destructive"
      >
        <LogOut className="h-3.5 w-3.5" /> {en ? "Log out" : "退出登录"}
      </button>
    </>
  );
}

/* ---------------- 侧栏底部辅助控件 ---------------- */

function IconButton({
  label, onClick, children, ariaPressed,
}: {
  label: string; onClick: () => void; children: React.ReactNode; ariaPressed?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} title={label}
      aria-pressed={ariaPressed}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-border bg-card text-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground"
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
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-border bg-card text-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground"
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
    else if (e.key === "Enter") { e.preventDefault(); const t = results[active]; if (t) window.location.href = p(`/products/${t.slug}/`, locale); }
  };

  return (
    <div className="fixed inset-0 z-50 animate-fade-in" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      {/* app-search-layer：桌面端把浮层起点让到侧栏右侧，让搜索框在内容区居中，
          而不是相对整个视口居中（否则会明显偏左，像和侧栏抢位置） */}
      <div className="app-search-layer absolute inset-x-0 top-0 mx-auto w-full max-w-2xl px-4 pt-16 sm:pt-24">
        <div className="animate-dialog-in overflow-hidden rounded-[10px] border border-border bg-card shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef} value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown} type="text"
              placeholder={translate(dict, "search.placeholder")}
              /* 16px 防 iOS 聚焦放大；w-0 + min-w-0 + flex-1 让输入框宽度完全由 flex
                 分配，不会因为固有宽度把右侧清空按钮挤出容器 */
              className="h-12 w-0 min-w-0 flex-1 bg-transparent text-[16px] text-foreground placeholder:text-muted-foreground focus:outline-none sm:text-[15px]"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-secondary">
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
                href={p(`/products/${r.slug}/`, locale)}
                onMouseEnter={() => setActive(i)}
                className={cx("mx-1.5 flex items-center justify-between gap-3 rounded-[6px] px-2.5 py-2", active === i ? "bg-secondary" : "hover:bg-secondary/50")}
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
