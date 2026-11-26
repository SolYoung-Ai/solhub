import { useEffect, useState } from "react";
import { CalendarDays, Loader2, Plus, Settings2 } from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import { myEvents, rangeText, regStatusLabel, stateLabel, type EventCard, type RegistrationStatus } from "@/lib/events";

/** 我的活动：我创办的（含草稿/审核中/已驳回）+ 我报名的。 */
export default function MyEvents({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [tab, setTab] = useState<"created" | "joined">("created");
  const [created, setCreated] = useState<EventCard[]>([]);
  const [joined, setJoined] = useState<{ event: EventCard; reg: { id: string; status: RegistrationStatus; at: string } }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void myEvents().then((res) => {
      if (!alive) return;
      if (!res.ok || !res.data) {
        setError(res.status === 401 ? "unauth" : res.error || "加载失败");
      } else {
        setCreated(res.data.created || []);
        setJoined(res.data.joined || []);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {en ? "Loading…" : "加载中…"}
      </div>
    );
  }

  if (error === "unauth") {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-[14px] font-medium text-foreground">{en ? "Log in to see your events" : "登录后查看你的活动"}</p>
        <a href={p("/login/", locale)} className="btn mt-4 !h-9 px-4 text-xs">
          {en ? "Log in" : "去登录"}
        </a>
      </div>
    );
  }

  return (
    <div className="container-page max-w-3xl py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">{en ? "My events" : "我的活动"}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {en ? "Events you created and events you joined." : "你发起的活动，以及你报名参加的活动。"}
          </p>
        </div>
        <a href={p("/events/create/", locale)} className="btn !h-9 px-4 text-xs">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {en ? "Create" : "发起活动"}
        </a>
      </header>

      <div className="seg mb-4 inline-flex gap-1 rounded-[12px] p-1" role="tablist">
        {[
          { key: "created" as const, label: `${en ? "Created" : "我创办的"} ${created.length}` },
          { key: "joined" as const, label: `${en ? "Joined" : "我报名的"} ${joined.length}` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? "seg-thumb rounded-[9px] px-3 py-1.5 text-[12.5px] font-medium text-foreground"
                : "rounded-[9px] px-3 py-1.5 text-[12.5px] text-muted-foreground"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}

      {tab === "created" ? (
        created.length === 0 ? (
          <Empty en={en} text={en ? "You have not created any event yet." : "你还没有发起过活动。"} />
        ) : (
          <ul className="space-y-2.5">
            {created.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={p(`/events/detail/?slug=${encodeURIComponent(e.slug)}`, locale)}
                      className="truncate text-[13.5px] font-semibold text-foreground hover:text-accent"
                    >
                      {e.title}
                    </a>
                    <span
                      className={
                        e.status === "published"
                          ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700"
                          : e.status === "pending"
                            ? "rounded-full bg-amber-400/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700"
                            : e.status === "rejected"
                              ? "rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-medium text-destructive"
                              : "rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground"
                      }
                    >
                      {stateLabel(e.state || e.status, en)}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {rangeText(e.startAt, e.endAt, en)}
                    {e.regCount > 0 && <span className="ml-1">· {e.regCount} {en ? "signups" : "人报名"}</span>}
                  </p>
                </div>
                <a
                  href={p(`/events/manage/?id=${encodeURIComponent(e.id)}`, locale)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-[11.5px] text-foreground/80 hover:border-foreground/25"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {en ? "Manage" : "管理"}
                </a>
              </li>
            ))}
          </ul>
        )
      ) : joined.length === 0 ? (
        <Empty en={en} text={en ? "You have not joined any event yet." : "你还没有报名任何活动。"} />
      ) : (
        <ul className="space-y-2.5">
          {joined.map((j) => (
            <li key={j.event.id} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
              <div className="min-w-0 flex-1">
                <a
                  href={p(`/events/detail/?slug=${encodeURIComponent(j.event.slug)}`, locale)}
                  className="truncate text-[13.5px] font-semibold text-foreground hover:text-accent"
                >
                  {j.event.title}
                </a>
                <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {rangeText(j.event.startAt, j.event.endAt, en)}
                </p>
              </div>
              <span
                className={
                  j.reg.status === "approved" || j.reg.status === "won"
                    ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                    : j.reg.status === "pending"
                      ? "rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                      : "rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
                }
              >
                {regStatusLabel(j.reg.status, en)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({ en, text }: { en: boolean; text: string }) {
  return (
    <div className="rounded-[16px] border border-border bg-card px-6 py-14 text-center">
      <CalendarDays className="mx-auto h-7 w-7 text-muted-foreground/60" />
      <p className="mt-3 text-[13px] text-muted-foreground">{text}</p>
      <a href={p("/events/", en ? "en" : "zh")} className="btn btn-outline mt-4 !h-8 px-3 text-xs">
        {en ? "Browse events" : "去看看活动"}
      </a>
    </div>
  );
}
