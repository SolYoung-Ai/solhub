import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, MapPin, Plus, Search, Users } from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import {
  EVENT_CATEGORIES,
  categoryLabel,
  listEvents,
  rangeText,
  stateLabel,
  type EventCard,
} from "@/lib/events";

/**
 * 活动列表
 *
 * 排序由后端决定：置顶 → 进行中 → 报名中 → 已结束。
 * 这里的筛选（状态/类型/分类）直接打到接口，前端不再二次过滤，
 * 否则分页数字会和列表对不上。
 */
export default function Events({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [items, setItems] = useState<EventCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [type, setType] = useState("all");
  const [state, setState] = useState("all");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void listEvents({ type, state, category, q: debounced, limit: 50 }).then((res) => {
      if (!alive) return;
      if (!res.ok || !res.data) {
        setError(res.error || "加载失败");
        setItems([]);
      } else {
        setItems(res.data.events || []);
        setTotal(res.data.total || 0);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [type, state, category, debounced]);

  const states = useMemo(
    () => [
      { key: "all", label: en ? "All" : "全部" },
      { key: "upcoming", label: en ? "Open" : "报名中" },
      { key: "ongoing", label: en ? "Live" : "进行中" },
      { key: "ended", label: en ? "Ended" : "已结束" },
    ],
    [en],
  );

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg flex gap-1 rounded-[12px] p-1" role="tablist" aria-label={en ? "Event state" : "活动状态"}>
            {states.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={state === s.key}
                onClick={() => setState(s.key)}
                className={
                  state === s.key
                    ? "seg-thumb rounded-[9px] px-3 py-1.5 text-[12.5px] font-medium text-foreground"
                    : "rounded-[9px] px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="relative ml-auto flex h-9 w-full items-center sm:w-56">
            <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={en ? "Search events" : "搜索活动"}
              className="h-9 w-full rounded-[8px] border border-border bg-card pl-8 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[{ key: "all", zh: "全部分类", en: "All types" }, ...EVENT_CATEGORIES.map((c) => ({ key: c.key, zh: c.zh, en: c.en }))].map(
            (c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={
                  category === c.key
                    ? "rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[12px] font-medium text-accent"
                    : "rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {en ? c.en : c.zh}
              </button>
            ),
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {en ? "Loading…" : "加载中…"}
        </div>
      ) : error ? (
        <div className="rounded-[14px] border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[16px] border border-border bg-card px-6 py-16 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-3 text-[14px] font-medium text-foreground">
            {en ? "No events here yet" : "这里还没有活动"}
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {en ? "Be the first to start one." : "不如你来发起第一场。"}
          </p>
          <a href={p("/events/create/", locale)} className="btn btn-outline mt-4 !h-8 px-3 text-xs">
            {en ? "Create event" : "发起活动"}
          </a>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((e) => (
              <EventCardView key={e.id} event={e} locale={locale} />
            ))}
          </div>
          <p className="mt-5 text-center text-[11.5px] text-muted-foreground">
            {en ? `${total} event${total === 1 ? "" : "s"}` : `共 ${total} 场活动`}
          </p>
        </>
      )}
    </div>
  );
}

function EventCardView({ event: e, locale }: { event: EventCard; locale: Locale }) {
  const en = locale === "en";
  const closed = e.state === "ended" || (e.state === "upcoming" && e.signupOpen === false);
  const badge =
    e.state === "ongoing"
      ? "absolute right-3 top-3 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10.5px] font-semibold text-white"
      : closed
        ? "absolute right-3 top-3 rounded-full bg-foreground/55 px-2 py-0.5 text-[10.5px] font-medium text-background"
        : "absolute right-3 top-3 rounded-full bg-accent/90 px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground";
  const badgeText = closed && e.state !== "ended" ? (en ? "Signup closed" : "报名截止") : stateLabel(e.state, en);
  return (
    <a
      href={p(`/events/detail/?slug=${encodeURIComponent(e.slug)}`, locale)}
      className="group flex flex-col overflow-hidden rounded-[16px] border border-border bg-card transition-colors hover:border-foreground/20"
    >
      <div className="relative aspect-[16/8] overflow-hidden bg-secondary">
        {e.cover ? (
          <img
            src={e.cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgba(255,138,61,0.14),rgba(90,140,255,0.16))]">
            <CalendarDays className="h-7 w-7 text-foreground/25" />
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-background/85 px-2 py-0.5 text-[10.5px] font-medium text-foreground backdrop-blur">
          {categoryLabel(e.category, en)}
        </span>
        <span className={badge}>
          {badgeText}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {e.ownerType === "official" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#2F80ED]/10 px-1.5 py-0.5 font-medium text-[#2F80ED]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2F80ED]" />
              {en ? "Official" : "官方"}
            </span>
          ) : (
            <span className="truncate">@{e.ownerHandle}</span>
          )}
          {e.capacity > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
              <Users className="h-3 w-3" />
              {e.used}/{e.capacity}
            </span>
          )}
        </div>

        <h2 className="line-clamp-2 font-display text-[15px] font-bold leading-6 tracking-tight text-foreground">
          {e.title}
        </h2>
        {e.summary && (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">{e.summary}</p>
        )}

        <div className="mt-auto flex items-center gap-1.5 pt-3 text-[11.5px] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{rangeText(e.startAt, e.endAt, en)}</span>
        </div>
        {e.location && (
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{e.location}</span>
          </div>
        )}
      </div>
    </a>
  );
}
