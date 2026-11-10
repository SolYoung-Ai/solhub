import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Compass,
  Languages,
  LogOut,
  Megaphone,
  Moon,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  UserCog,
  UserRound,
  X,
} from "lucide-react";
import type { SearchIndexEntry } from "@/data/types";
import InstallApp from "@/components/InstallApp";
import { searchIndex } from "@/lib/search";
import { useCatalogSearchEntries } from "@/lib/skills-catalog";
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
 * 桌面三档：
 *   ≥1280px  完整侧栏（图标 + 文字，244px），头顶右侧有「收起」按钮；
 *            收起后变 76px 图标栏，按钮翻成「展开」（状态记在 localStorage）
 *   1024–1279 默认就是图标栏（76px，仅图标，靠 title 提示）
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

  /* 每个导航项一个彩色图标块：颜色只用来区分栏目，文字与背景仍是 SolHub 的
     暖白 / 暖灰 / 品牌橙体系，所以整体观感不变，只是多了一层识别度。 */
  const NAV: {
    label: string;
    path: string;
    icon: typeof Compass;
    color: string;
    match: (r: string) => boolean;
    bottom?: boolean;
  }[] = [
    { label: translate(dict, "nav.discover"), path: "/", icon: Compass, color: "#3b82f6", match: (r) => r === "/" },
    { label: translate(dict, "nav.launches"), path: "/launches/", icon: Package, color: "#e87028", match: (r) => r.startsWith("/launches/") },
    { label: translate(dict, "nav.skills"), path: "/skills/", icon: Sparkles, color: "#ec4899", match: (r) => r.startsWith("/skills/") },
    /* 赞助位是现金入口，紧跟 Skill：这里卖的是注意力，不是产品目录的第二份 */
    { label: translate(dict, "nav.sponsors"), path: "/sponsors/", icon: Megaphone, color: "#d99a2b", match: (r) => r.startsWith("/sponsors/") },
    { label: translate(dict, "nav.world"), path: "/world/", icon: Users, color: "#14b8a6", match: (r) => r.startsWith("/world/") },
    { label: translate(dict, "nav.mySubmissions"), path: "/my-submissions/", icon: UserRound, color: "#8b5cf6", match: (r) => r.startsWith("/my-submissions/") },
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

  /* 侧栏收起 / 展开：只把状态写到 <html data-nav>，宽度与文字显隐交给 CSS。
     这样不必为布局加 React 状态 —— 静态站每次跳页都是整页刷新，
     若靠状态驱动，首帧会先按默认宽度渲染再跳到用户选的那档，明显闪一下。 */
  const toggleNav = () => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const next = root.getAttribute("data-nav") === "rail" ? "full" : "rail";
    root.setAttribute("data-nav", next);
    try {
      localStorage.setItem("solhub:nav", next);
    } catch {
      /* 隐私模式 / 存储被禁：本次会话内仍然生效 */
    }
  };
  const navToggleLabel = en ? "Collapse / expand navigation" : "收起 / 展开导航栏";

  return (
    <>
      {/* ==================== 桌面：左侧固定栏 ==================== */}
      <aside
        className="app-sidebar sticky top-3 z-40 ml-3 hidden h-[calc(100vh-1.5rem)] shrink-0 flex-col overflow-hidden rounded-[18px] border lg:flex lg:w-[76px] xl:w-[244px]"
        aria-label={en ? "Main navigation" : "主导航"}
      >
        <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain px-3 py-5 xl:px-4">
          {/* 头部：Logo 与右侧的「收起导航」按钮同一行（与 logo 持平）；
              收起后 76px 放不下并排，CSS 会把 .side-head 改成竖排，
              按钮落到 logo 正下方再翻成「展开」 */}
          <div className="side-head flex shrink-0 items-center justify-between gap-1">
            <a
              href={p("/", locale)}
              className="flex items-center justify-center gap-2.5 rounded-[8px] px-1 py-1 xl:justify-start xl:px-2"
              aria-label="SolHub"
            >
              <img src="/solhub-mark.png" alt="" width={30} height={30} className="shrink-0" />
              <span className="side-label hidden font-display text-[19px] font-bold tracking-tight text-foreground xl:block">
                SolHub
              </span>
            </a>

            <button
              type="button"
              onClick={toggleNav}
              title={navToggleLabel}
              aria-label={navToggleLabel}
              className="nav-toggle hidden h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground xl:inline-flex"
            >
              <ChevronsLeft className="ico-collapse h-4 w-4" strokeWidth={2} />
              <ChevronsRight className="ico-expand h-4 w-4" strokeWidth={2} />
            </button>
          </div>

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
                    "side-row group flex items-center justify-center gap-2.5 rounded-[8px] border px-2 py-[7px] text-[14px] transition-colors xl:justify-start",
                    on
                      ? "border-border bg-secondary text-foreground"
                      : "border-transparent text-foreground/60 hover:bg-secondary/70 hover:text-foreground",
                  )}
                >
                  <span
                    className={cx(
                      "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] transition-opacity",
                      on ? "opacity-100 shadow-xs" : "opacity-80 group-hover:opacity-100",
                    )}
                    style={{ backgroundColor: item.color }}
                    aria-hidden="true"
                  >
                    <Icon className="h-[15px] w-[15px] text-white" strokeWidth={2} />
                  </span>
                  <span className={cx("side-label hidden min-w-0 truncate xl:block", on && "font-semibold")}>{item.label}</span>
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
            className="side-row group flex items-center justify-center gap-2.5 rounded-[8px] border border-transparent px-2 py-[7px] text-[14px] text-foreground/60 transition-colors hover:bg-secondary/70 hover:text-foreground xl:justify-start"
          >
            <span
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[#a8a29e] opacity-80 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            >
              <Search className="h-[15px] w-[15px] text-white" strokeWidth={2} />
            </span>
            <span className="side-label hidden min-w-0 truncate xl:block">{en ? "Search" : "搜索"}</span>
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
              <span className="side-label hidden xl:block">{translate(dict, "nav.submit")}</span>
            </a>
          </div>

          {/* 底部：辅助控件 → 账号 */}
          <div className="mt-auto flex flex-col gap-3 pt-6">
            <div className="side-tools flex flex-col items-center gap-1 xl:flex-row xl:gap-1">
              <LangButton locale={locale} currentRoute={currentRoute} />
              <ThemeButton en={en} />
              {/* 装到桌面：与主题 / 语言同一排 32px 方块 */}
              <InstallApp locale={locale} />
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
                  className="side-row flex w-full items-center justify-center gap-2.5 rounded-[8px] p-1.5 transition-colors hover:bg-secondary xl:justify-start"
                >
                  <Avatar user={user} size={30} />
                  <span className="side-label hidden min-w-0 text-left xl:block">
                    <span className="block truncate text-[13px] font-medium leading-4 text-foreground">{displayName}</span>
                    <span className="block truncate text-[11px] leading-4 text-muted-foreground">@{handle}</span>
                  </span>
                </button>

                {userMenuOpen && (
                  <div
                    className="fixed bottom-[86px] left-3 z-50 w-[228px] glass-sheet overflow-hidden rounded-[20px] py-1 xl:bottom-[92px] xl:left-4 xl:w-[212px]"
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
                <span className="side-label hidden xl:block">{translate(dict, "nav.login")}</span>
              </a>
            )}
          </div>
        </div>
      </aside>

      {/* ==================== 手机：顶栏 ==================== */}
      <header className="app-topbar sticky top-0 z-40 flex h-[52px] items-center gap-2 px-3 lg:hidden">
        <a href={p("/", locale)} className="flex items-center gap-2" aria-label="SolHub">
          <img src="/solhub-mark.png" alt="" width={24} height={24} />
          <span className="font-display text-[17px] font-bold tracking-tight text-foreground">SolHub</span>
        </a>

        <div className="topbar-tools ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={en ? "Search" : "搜索"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {/* 深浅主题 / 语言切换原先只放在桌面侧栏底部，手机端完全没有入口。
              这里与搜索按钮共用同一套 32px 描边方块，320px 窄屏也放得下。 */}
          <ThemeButton en={en} />
          {/* 320px 实测：五个按钮共 198px，右侧仍留 6px，不会溢出 */}
          <InstallApp locale={locale} />
          <LangButton locale={locale} currentRoute={currentRoute} />

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
                  className="absolute right-0 top-10 z-50 w-[220px] glass-sheet overflow-hidden rounded-[20px] py-1"
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
        className="app-tabbar fixed z-40 flex lg:hidden"
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
                on ? "font-semibold" : "text-muted-foreground",
              )}
              style={on ? { color: item.color } : undefined}
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
      {/* 招商页不是访客功能，放在账号菜单里：站长偶尔用，不占访客导航 */}
      <a
        href={p("/sponsors/join/", locale)}
        onClick={onNavigate}
        className="flex items-center gap-2 px-3 py-2 text-[13px] text-foreground/80 hover:bg-secondary"
      >
        <Megaphone className="h-3.5 w-3.5" /> {en ? "Sponsorship" : "赞助合作"}
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

function ThemeButton({ en = false }: { en?: boolean }) {
  const toggle = () => {
    const root = document.documentElement;
    /* 直接读 DOM 而不是 React state：桌面侧栏与手机顶栏是同一个按钮的两个实例，
       各自持 state 会不同步（切了手机那个，窗口拉宽后桌面那个还显示旧图标）。 */
    const next = !root.classList.contains("dark");
    root.classList.add("theme-transition");
    if (next) root.classList.add("dark"); else root.classList.remove("dark");
    try { localStorage.setItem("solhub:theme", next ? "dark" : "light"); } catch {}
    /* 手机地址栏/状态栏跟着切，否则深色页面顶上会挂一条白条 */
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute("content", next ? "#0a0908" : "#efeef1");
    window.setTimeout(() => root.classList.remove("theme-transition"), 350);
  };
  /* 两个图标同时渲染，由 html.dark 的 CSS 决定显隐：
     首帧（含 island SSR / hydrate 之前）就是正确图标，不会闪一下月亮。 */
  return (
    <IconButton label={en ? "Toggle dark / light theme" : "切换深浅主题"} onClick={toggle}>
      <Sun className="theme-icon-sun h-3.5 w-3.5" aria-hidden="true" />
      <Moon className="theme-icon-moon h-3.5 w-3.5" aria-hidden="true" />
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
  const en = locale === "en";
  const hasQuery = query.trim().length > 0;
  /* 1000 条真实 SKILL.md 索引按需追加（全站只下载一次），页面 HTML 不内联大数据 */
  const catalogEntries = useCatalogSearchEntries(locale);
  const fullIndex = useMemo(() => [...index, ...catalogEntries], [index, catalogEntries]);
  /* 全局索引含产品 + 精选 Skill + 全网 Skill，Skill 条目 href 已经自带 ?q= 预填 */
  const skillHref = p(`/skills/?q=${encodeURIComponent(query.trim())}`, locale);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    setResults(searchIndex(query, fullIndex, locale).slice(0, 24));
    setActive(0);
  }, [query, fullIndex, locale]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const t = results[active];
      if (t) window.location.href = p(t.href, locale);
      else if (hasQuery) window.location.href = skillHref;
    }
  };

  return (
    <div className="fixed inset-0 z-50 animate-fade-in" role="dialog" aria-modal="true">
      <div className="absolute inset-0 glass-scrim" onClick={onClose} aria-hidden="true" />
      {/* app-search-layer：桌面端把浮层起点让到侧栏右侧，让搜索框在内容区居中，
          而不是相对整个视口居中（否则会明显偏左，像和侧栏抢位置） */}
      <div className="app-search-layer absolute inset-x-0 top-0 mx-auto w-full max-w-2xl px-4 pt-16 sm:pt-24">
        <div className="animate-dialog-in glass-sheet overflow-hidden rounded-[24px]">
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
            {!hasQuery && (
              <div className="px-4 py-7 text-center">
                <p className="text-sm text-muted-foreground">{translate(dict, "search.hint")}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground/70">{translate(dict, "search.hintTips")}</p>
              </div>
            )}
            {hasQuery && results.length === 0 && (
              <div className="px-4 py-7 text-center">
                <p className="text-sm text-muted-foreground">{translate(dict, "search.emptyTitle", { q: query.trim() })}</p>
                <a href={skillHref} className="mt-2 inline-block text-[12px] text-accent hover:underline">
                  {en ? "Search the Skill library instead →" : "去 Skill 库里搜搜看 →"}
                </a>
              </div>
            )}
            {results.map((r, i) => (
              <a
                key={r.slug}
                href={p(r.href, locale)}
                onMouseEnter={() => setActive(i)}
                className={cx("mx-1.5 flex items-center justify-between gap-3 rounded-[6px] px-2.5 py-2", active === i ? "bg-secondary" : "hover:bg-secondary/50")}
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                    {r.kind === "skill" && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#ec4899]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#db2777]">
                        <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                        Skill
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{r.categoryName}</span>
              </a>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>{translate(dict, "search.shortcut")}</span>
            <span className="flex items-center gap-2">
              <span className="hidden sm:inline">{translate(dict, "search.localNote")}</span>
              {hasQuery && (
                <a href={skillHref} className="text-accent hover:underline">
                  {en ? "Search all Skills →" : "在 Skill 库中搜索 →"}
                </a>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
