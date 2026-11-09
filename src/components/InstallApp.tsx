import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MonitorDown, Share, Smartphone, X } from "lucide-react";
import { cx } from "@/lib/utils";
import type { Locale } from "@/i18n";

/**
 * 「装到桌面」按钮 + 安装引导弹窗。
 *
 * 站点是纯静态站，不发布 .exe / .dmg，而是走浏览器自带的 Web App 安装（PWA）：
 * 装完是一个独立窗口的应用，有桌面 / 程序坞图标，断网也能看缓存过的页面，
 * 站内更新后自动是新的 —— 不用用户重新下载安装包。
 *
 * 三种状态：
 * 1) 浏览器给了 beforeinstallprompt → 直接一个「立即安装」按钮，一键完成
 * 2) 已经装过（standalone 模式）→ 只说「已装好」，不再给步骤
 * 3) 其它（Safari / 已装但拿不到事件 / 手机）→ 按平台给出点按步骤
 */

type Platform = "windows" | "macos" | "ios";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent;
  // iPadOS 的 UA 是 Macintosh，靠触点数区分
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Windows/.test(ua)) return "windows";
  return "macos";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export default function InstallApp({
  locale = "zh",
  className,
}: {
  locale?: Locale;
  className?: string;
}) {
  const en = locale === "en";
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [tab, setTab] = useState<Platform>("windows");
  /* 这个组件在桌面侧栏和手机顶栏各渲染一次，两个实例都会跑下面的 effect；
     用按钮自身是否可见来决定谁弹窗，否则 ?install=1 会同时弹出两层 */
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setInstalled(isStandalone());
    setTab(detectPlatform());
    const sync = () => setCanPrompt(Boolean((window as any).__solhubInstallPrompt));
    sync();

    const onInstallable = () => sync();
    const onInstalled = () => {
      setInstalled(true);
      setCanPrompt(false);
    };
    window.addEventListener("solhub:installable", onInstallable);
    window.addEventListener("solhub:installed", onInstalled);

    // 支持 ?install=1 直达（页脚入口、外部链接都能把人送到这里）
    const deepLink = new URLSearchParams(window.location.search).get("install") === "1";
    const visible = Boolean(btnRef.current && btnRef.current.getClientRects().length > 0);
    if (deepLink && visible) setOpen(true);

    return () => {
      window.removeEventListener("solhub:installable", onInstallable);
      window.removeEventListener("solhub:installed", onInstalled);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // 关掉时清参数，否则刷新又弹一次
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("install")) {
        url.searchParams.delete("install");
        window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
      }
    }
  }, []);

  // 打开时锁滚动 + Esc 关闭
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const runInstall = async () => {
    const evt = (window as any).__solhubInstallPrompt as InstallPromptEvent | null;
    if (!evt) return;
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
        setOpen(false);
      }
    } catch {
      /* 用户取消或浏览器拒绝，留在弹窗里看步骤即可 */
    }
    (window as any).__solhubInstallPrompt = null;
    setCanPrompt(false);
  };

  const tabs: { key: Platform; label: string }[] = [
    { key: "windows", label: en ? "Windows" : "Windows" },
    { key: "macos", label: en ? "macOS" : "macOS" },
    { key: "ios", label: en ? "iPhone / iPad" : "iPhone / iPad" },
  ];

  const steps: Record<Platform, string[]> = en
    ? {
        windows: [
          "Open this site in Edge or Chrome (Firefox can't install web apps).",
          "Click the install icon at the right end of the address bar — a small screen with a down arrow. If you don't see it, open the ⋯ menu → Apps → Install this site as an app.",
          "SolHub now sits on your desktop and in the Start menu. Double-click it and it opens in its own window.",
        ],
        macos: [
          "Chrome: ⋮ menu → Cast, save and share → Install page as app…",
          "Safari: menu bar File → Add to Dock.",
          "After that, open it from Launchpad or the Dock — it's a real window, not a browser tab.",
        ],
        ios: [
          "Open SolHub in Safari (links opened inside WeChat or other apps can't be added).",
          "Tap the Share button in the toolbar.",
          "Scroll down and choose “Add to Home Screen”, then tap Add.",
        ],
      }
    : {
        windows: [
          "用 Edge 或 Chrome 打开本站（Firefox 不支持装成应用）。",
          "点地址栏右侧的安装图标（一个小屏幕带下箭头）。找不到就点右上角 ⋯ → 应用 → 将此站点作为应用安装。",
          "桌面和开始菜单会出现 SolHub 图标，双击打开就是独立窗口，不占浏览器标签。",
        ],
        macos: [
          "Chrome：右上角 ⋮ → 投放、保存和分享 → 安装页面为应用…",
          "Safari：菜单栏「文件」→「添加到程序坞」。",
          "之后从启动台或程序坞点图标就能打开，是独立窗口而不是浏览器标签。",
        ],
        ios: [
          "用 Safari 打开本站（微信等应用内打开的链接加不了主屏）。",
          "点底部工具栏的「分享」按钮。",
          "往下滑，选「添加到主屏幕」，再点右上角「添加」。",
        ],
      };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={en ? "Install SolHub on your desktop" : "把 SolHub 装到桌面"}
        title={en ? "Install SolHub on your desktop" : "把 SolHub 装到桌面"}
        className={cx(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-border bg-card text-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground",
          className,
        )}
      >
        <MonitorDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex animate-fade-in items-center justify-center p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
          >
            <div className="absolute inset-0 glass-scrim" onClick={close} aria-hidden="true" />

            <div className="animate-dialog-in glass-sheet relative flex max-h-[88vh] w-full max-w-[440px] flex-col overflow-hidden rounded-[26px]">
              {/* 头部 */}
              <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                    <MonitorDown className="h-3 w-3" aria-hidden="true" />
                    {en ? "Desktop app" : "桌面应用"}
                  </p>
                  <h2
                    id="install-title"
                    className="mt-1 font-display text-[19px] font-extrabold leading-tight tracking-tight text-foreground"
                  >
                    {en ? "Put SolHub on your desktop" : "把 SolHub 装到桌面"}
                  </h2>
                  <p className="mt-1.5 text-[12.5px] leading-5 text-muted-foreground">
                    {en
                      ? "It opens in its own window with a real icon in the Dock or on the desktop — no browser tabs, and pages you've read still open when you're offline."
                      : "装好后是一个独立窗口的应用：桌面或程序坞里有自己的图标，不占浏览器标签，断网也能打开看过的页面。"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label={en ? "Close" : "关闭"}
                  className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
                {/* 状态一：能一键安装 */}
                {canPrompt && !installed && (
                  <div>
                    <button
                      type="button"
                      onClick={() => void runInstall()}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-accent text-[14px] font-semibold text-accent-foreground shadow-xs transition-colors hover:brightness-95 active:translate-y-px"
                    >
                      <MonitorDown className="h-4 w-4" aria-hidden="true" />
                      {en ? "Install now" : "立即安装"}
                    </button>
                    <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
                      {en
                        ? "One tap — the browser does the rest. Nothing to download."
                        : "点一下就装好，浏览器直接完成，不用下载任何文件。"}
                    </p>
                  </div>
                )}

                {/* 状态二：已经装过 */}
                {installed && (
                  <div className="flex items-start gap-2.5 rounded-[16px] border border-success/30 bg-success/10 px-3.5 py-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-foreground">
                        {en ? "Already installed here" : "这台设备上已经装好了"}
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
                        {en
                          ? "Open it from your desktop, Dock or home screen — it runs in its own window."
                          : "从桌面、程序坞或手机主屏点图标打开，就是独立窗口。"}
                      </p>
                    </div>
                  </div>
                )}

                {/* 状态三：分平台步骤 */}
                {!installed && (
                  <div className={cx(canPrompt && "mt-4 border-t border-border pt-4")}>
                    <div className="seg mb-3 grid grid-cols-3 gap-1 rounded-[14px] p-1">
                      {tabs.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setTab(t.key)}
                          aria-pressed={tab === t.key}
                          className={cx(
                            "flex items-center justify-center gap-1 rounded-[10px] py-1.5 text-[12px] font-medium transition-all duration-200",
                            tab === t.key ? "seg-thumb text-foreground" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t.key === "ios" ? (
                            <Smartphone className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <MonitorDown className="h-3 w-3" aria-hidden="true" />
                          )}
                          <span className="truncate">{t.label}</span>
                        </button>
                      ))}
                    </div>

                    <ol className="space-y-2.5">
                      {steps[tab].map((text, i) => (
                        <li key={i} className="flex gap-2.5">
                          <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[11px] font-bold text-accent">
                            {i + 1}
                          </span>
                          <p className="min-w-0 text-[12.5px] leading-5 text-foreground/85">{text}</p>
                        </li>
                      ))}
                    </ol>

                    {tab === "ios" && (
                      <p className="mt-3 flex items-center gap-1.5 rounded-[14px] border border-border bg-secondary/40 px-3 py-2 text-[11.5px] text-muted-foreground">
                        <Share className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {en
                          ? "The Share button is the square with an arrow pointing up, at the bottom (or top) of Safari."
                          : "「分享」按钮是底部那个方框带向上箭头的图标。"}
                      </p>
                    )}
                  </div>
                )}

                <p className="mt-4 border-t border-border pt-3 text-[11px] leading-[1.7] text-muted-foreground">
                  {en
                    ? "This is the browser's built-in web-app install (PWA), not an .exe / .dmg: nothing to download, no “unidentified developer” warning, and it updates itself whenever the site does."
                    : "这是浏览器自带的「安装网页应用」（PWA），不是 .exe / .dmg 安装包：不用下载、不用签名，不会被系统拦成「未知开发者」，站内更新后自动生效。"}
                </p>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
