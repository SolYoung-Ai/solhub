/**
 * 热点流（/hot/）
 * =================
 *
 * 数据由后端每 15 分钟抓一轮，这里每 60 秒拉一次增量。
 *
 * 三个刻意的设计：
 *   1. 新内容不自动插队。读者正在往下读，列表突然整体下移是最烦的交互之一，
 *      所以新条目先进缓冲区，顶部浮一条「有 N 条新热点」，点了才并进去。
 *   2. 页面不可见时不轮询。后台标签页每分钟打一次接口纯属浪费，切回来时立刻补一次。
 *   3. 通知要用户主动开。浏览器对「自动请求权限」的站点会降级处理（Chrome 直接静默
 *      拒绝），而且没打招呼就弹桌面通知是最招人烦的行为之一。
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

type Cat = "all" | "ai" | "product" | "tech" | "finance";

const TABS: { id: Cat; zh: string; en: string }[] = [
  { id: "all", zh: "全部", en: "All" },
  { id: "ai", zh: "AI", en: "AI" },
  { id: "product", zh: "产品", en: "Product" },
  { id: "tech", zh: "科技", en: "Tech" },
  { id: "finance", zh: "金融", en: "Finance" },
];

/** 分类色：只做一个小圆点，不搞成彩色标签墙 */
const CAT_DOT: Record<string, string> = {
  ai: "bg-[#d96a24]",
  product: "bg-[#5b8def]",
  tech: "bg-[#8a8f98]",
  finance: "bg-[#3f9e6a]",
};

const POLL_MS = 60 * 1000;
const PAGE = 40;
const STORE_CAT = "solhub:hot:cat";
const STORE_NOTIFY = "solhub:hot:notify";

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
  const [pending, setPending] = useState<HotItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(initialShown);
  const [reloadKey, setReloadKey] = useState(0);
  const [notifyOn, setNotifyOn] = useState(false);
  const [notifyHint, setNotifyHint] = useState("");

  /* 轮询回调里要用到最新值，但又不想把它们塞进依赖触发重建 —— 用 ref 兜住 */
  const catRef = useRef<Cat>("all");
  const headRef = useRef("");
  const notifyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    catRef.current = cat;
    headRef.current = data && data.items[0] ? data.items[0].publishedAt : "";
  }, [cat, data]);

  useEffect(() => {
    notifyRef.current = notifyOn;
  }, [notifyOn]);

  /* 首屏恢复偏好：分类与通知开关都记在本地，下次进来不用重选 */
  useEffect(() => {
    mounted.current = true;
    try {
      const savedCat = localStorage.getItem(STORE_CAT) as Cat | null;
      if (savedCat && TABS.some((t) => t.id === savedCat)) setCat(savedCat);
      const savedNotify = localStorage.getItem(STORE_NOTIFY) === "1";
      if (savedNotify && typeof Notification !== "undefined" && Notification.permission === "granted") {
        setNotifyOn(true);
      }
    } catch {
      /* localStorage 被禁也不影响读内容 */
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchFeed = useCallback(async (targetCat: Cat): Promise<HotResponse | null> => {
    const res = await fetch(`${base()}/hot?cat=${targetCat}&limit=200`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as HotResponse;
  }, []);

  /* 首次加载 + 切分类 */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setPending([]);
    setShown(initialShown);
    fetchFeed(cat)
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
  }, [cat, reloadKey, fetchFeed]);

  /** 弹系统通知。优先走 Service Worker（iOS 装到桌面后只认这条路），退化为普通 Notification。 */
  const notify = useCallback(
    async (title: string, body: string) => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg && typeof reg.showNotification === "function") {
          await reg.showNotification(title, {
            body,
            icon: "/icons/app-192.png",
            badge: "/icons/app-192.png",
            tag: "solhub-hot",
            data: { url: "/hot/" },
          });
          return;
        }
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(title, { body, icon: "/icons/app-192.png", tag: "solhub-hot" });
        }
      } catch {
        /* 通知失败不能影响列表渲染 */
      }
    },
    [],
  );

  /* 轮询：页面不可见时跳过，切回前台立刻补一次 */
  useEffect(() => {
    let timer: number | undefined;

    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const json = await fetchFeed(catRef.current);
        if (!json || !mounted.current) return;
        const head = headRef.current;
        const fresh = head
          ? json.items.filter((it) => Date.parse(it.publishedAt) > Date.parse(head))
          : [];
        if (fresh.length) {
          setPending((prev) => {
            /* 缓冲区按 id 去重，避免多次轮询把同一条叠进来 */
            const seen = new Set(prev.map((p) => p.id));
            const next = [...fresh.filter((f) => !seen.has(f.id)), ...prev];
            return next.slice(0, 40);
          });
          if (notifyRef.current) {
            const lead = fresh[0];
            void notify(
              en ? `${fresh.length} new stories` : `${fresh.length} 条新热点`,
              `${lead.sourceName}｜${lead.title}`,
            );
          }
        }
        /* 即使没有新条目也更新计数与抓取时间，页脚的时间戳才不会停住 */
        setData((prev) => (prev ? { ...prev, counts: json.counts, fetchedAt: json.fetchedAt } : json));
      } catch {
        /* 单次轮询失败静默重试，不打断阅读 */
      }
    };

    const start = () => {
      if (timer) window.clearInterval(timer);
      timer = window.setInterval(tick, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };

    start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchFeed, notify, en]);

  /* 应用缓冲区：并进列表并按时间重排 */
  const applyPending = useCallback(() => {
    if (!pending.length) return;
    setData((prev) => {
      if (!prev) return prev;
      const ids = new Set(prev.items.map((it) => it.id));
      const merged = [...pending.filter((p) => !ids.has(p.id)), ...prev.items].sort(
        (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
      );
      return { ...prev, items: merged, total: merged.length };
    });
    setPending([]);
    setShown((n) => n + pending.length);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [pending]);

  const toggleNotify = useCallback(async () => {
    if (notifyOn) {
      setNotifyOn(false);
      try {
        localStorage.setItem(STORE_NOTIFY, "0");
      } catch {
        /* ignore */
      }
      setNotifyHint(en ? "Desktop notifications off" : "已关闭桌面通知");
      return;
    }
    if (typeof Notification === "undefined") {
      setNotifyHint(en ? "This browser can't show notifications" : "这个浏览器不支持桌面通知");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setNotifyHint(
        en
          ? "Permission denied — re-enable it in browser settings"
          : "权限被拒绝，需要在浏览器设置里重新允许",
      );
      return;
    }
    setNotifyOn(true);
    try {
      localStorage.setItem(STORE_NOTIFY, "1");
    } catch {
      /* ignore */
    }
    setNotifyHint(en ? "On — you'll be pinged when new stories land" : "已开启 —— 有新热点会弹通知");
    void notify(en ? "Notifications on" : "通知已开启", en ? "New stories will appear here." : "有新的 AI / 产品 / 科技 / 金融热点时会提醒你。");
  }, [notifyOn, notify, en]);

  const items = data?.items ?? [];
  const visible = items.slice(0, shown);
  const counts = data?.counts ?? { all: 0, ai: 0, product: 0, tech: 0, finance: 0 };

  return (
    <div className="min-w-0">
      {/* 分类 + 通知开关。手机上横向滚动，不换行不挤压 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => {
            const active = cat === t.id;
            const n = counts[t.id] ?? 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setCat(t.id)}
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
                ? `Updated ${clockOf(data.fetchedAt)} · every 15 min`
                : `更新于 ${clockOf(data.fetchedAt)} · 每 15 分钟抓取`
              : en
                ? "Loading…"
                : "加载中…"}
          </span>
          <button
            type="button"
            onClick={toggleNotify}
            aria-pressed={notifyOn}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
              notifyOn
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {notifyOn ? (en ? "Notifying" : "通知已开") : en ? "Notify me" : "开启通知"}
          </button>
        </div>
      </div>

      {notifyHint ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{notifyHint}</p>
      ) : null}

      {/* 新条目提示条：不打断阅读，读者点了才并进去 */}
      {pending.length ? (
        <div className="hot-new-banner mt-3 flex justify-center">
          <button
            type="button"
            onClick={applyPending}
            className="glass-sheet inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-accent shadow-lg"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            {en ? `${pending.length} new — show` : `${pending.length} 条新热点，点击查看`}
          </button>
        </div>
      ) : null}

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
          <p className="text-sm font-semibold text-foreground">{en ? "Nothing here yet" : "这个分类还没有内容"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {en ? "First batch is being fetched. Check back in a few minutes." : "第一批还在路上，过几分钟再来看看。"}
          </p>
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
                {it.title}
              </TitleTag>
              {it.summary ? (
                <p className="mt-1 line-clamp-2 break-words text-[12px] leading-5 text-muted-foreground">
                  {it.summary}
                </p>
              ) : null}
            </a>
          </li>
        ))}
      </ul>

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
            ? "Headlines and links come from public RSS feeds of IT之家, 量子位, 极客公园, 爱范儿, 雷锋网, 钛媒体, 开源中国, Solidot, 少数派 and 华尔街见闻. Only titles, links and short excerpts are shown — every item opens the original article. SolHub doesn't host or republish their content."
            : "标题与链接来自 IT之家、量子位、极客公园、爱范儿、雷锋网、钛媒体、开源中国、Solidot、少数派、华尔街见闻的公开 RSS。这里只展示标题、链接与一小段导语，每条都跳回原文；SolHub 不转载、不镜像这些媒体的正文。"}
        </p>
      ) : null}
    </div>
  );
}
