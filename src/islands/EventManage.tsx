import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2, Trophy, X } from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import {
  editEvent,
  eventAction,
  eventRegistrations,
  getEvent,
  publishEventResult,
  regStatusLabel,
  reviewRegistration,
  type EventDetailData,
  type RegistrationRecord,
} from "@/lib/events";

/** 主办方管理页：报名名单（通过/拒绝）+ 发布结果 + 下架/恢复。 */
export default function EventManage({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [id, setId] = useState("");
  const [event, setEvent] = useState<EventDetailData | null>(null);
  const [regs, setRegs] = useState<RegistrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState("");
  const [winners, setWinners] = useState<string[]>([]);
  const [desc, setDesc] = useState("");

  const load = useCallback(async (eventId: string) => {
    setLoading(true);
    setError("");
    const [detail, list] = await Promise.all([getEvent(eventId), eventRegistrations(eventId)]);
    if (!detail.ok || !detail.data) {
      setError(detail.error || "没有权限或活动不存在");
      setLoading(false);
      return;
    }
    setEvent(detail.data.event);
    setDesc(detail.data.event.description || "");
    setSummary(detail.data.event.result?.summary || "");
    setWinners((detail.data.event.result?.winners || []).map((w) => w.id));
    if (list.ok && list.data) setRegs(list.data.registrations || []);
    else setError(list.error || "读取报名名单失败");
    setLoading(false);
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const eventId = qs.get("id") || "";
    setId(eventId);
    if (eventId) void load(eventId);
    else {
      setError(en ? "Missing event id" : "缺少活动 id");
      setLoading(false);
    }
  }, [en, load]);

  async function onReview(regId: string, action: "approve" | "reject") {
    setBusyId(regId);
    setMessage("");
    const res = await reviewRegistration(id, regId, action);
    setBusyId("");
    if (!res.ok) return setMessage(res.error || "操作失败");
    setRegs((prev) => prev.map((r) => (r.id === regId ? { ...r, status: action === "approve" ? "approved" : "rejected" } : r)));
    setMessage(res.data?.message || "已更新");
  }

  async function onPublishResult() {
    if (!summary.trim()) return setMessage(en ? "Write a short result summary" : "请填写结果说明");
    setMessage("");
    const res = await publishEventResult(id, summary.trim(), winners);
    if (!res.ok) return setMessage(res.error || "发布失败");
    setMessage(res.data?.message || "结果已发布");
    setRegs((prev) => prev.map((r) => (winners.includes(r.id) ? { ...r, status: "won" } : r)));
    setEvent((ev) => (ev ? { ...ev, result: res.data?.result || null } : ev));
  }

  async function onAction(action: "offline" | "restore" | "submit") {
    setMessage("");
    const res = await eventAction(id, action);
    if (!res.ok) return setMessage(res.error || "操作失败");
    setMessage(res.data?.message || "已更新");
    void load(id);
  }

  async function onSaveDesc() {
    setMessage("");
    const res = await editEvent(id, { description: desc });
    if (!res.ok) return setMessage(res.error || "保存失败");
    setMessage(res.data?.message || "已保存");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {en ? "Loading…" : "加载中…"}
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-[14px] font-medium text-foreground">{error || (en ? "Not found" : "活动不存在")}</p>
        <a href={p("/events/mine/", locale)} className="btn btn-outline mt-4 !h-8 px-3 text-xs">
          {en ? "My events" : "我的活动"}
        </a>
      </div>
    );
  }

  const pending = regs.filter((r) => r.status === "pending");
  const approved = regs.filter((r) => r.status === "approved" || r.status === "won");

  return (
    <div className="container-page max-w-4xl py-8">
      <a
        href={p("/events/mine/", locale)}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {en ? "My events" : "我的活动"}
      </a>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-tight text-foreground">{event.title}</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {en
              ? `${approved.length} approved · ${pending.length} pending${event.capacity ? ` · ${event.capacity} spots` : ""}`
              : `已通过 ${approved.length} 人 · 待确认 ${pending.length} 人${event.capacity ? ` · 名额 ${event.capacity}` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={p(`/events/detail/?slug=${encodeURIComponent(event.slug)}`, locale)}
            className="btn btn-outline !h-8 px-3 text-xs"
          >
            {en ? "View page" : "查看页面"}
          </a>
          {event.status === "published" ? (
            <button type="button" onClick={() => onAction("offline")} className="btn btn-outline !h-8 px-3 text-xs">
              {en ? "Take down" : "下架"}
            </button>
          ) : event.status === "offline" ? (
            <button type="button" onClick={() => onAction("restore")} className="btn btn-outline !h-8 px-3 text-xs">
              {en ? "Restore" : "恢复"}
            </button>
          ) : event.status === "draft" || event.status === "rejected" ? (
            <button type="button" onClick={() => onAction("submit")} className="btn !h-8 px-3 text-xs">
              {en ? "Submit for review" : "提交审核"}
            </button>
          ) : null}
        </div>
      </div>

      {message && <p className="mt-3 rounded-[8px] bg-secondary px-3 py-2 text-[12px] text-foreground/75">{message}</p>}

      <section className="mt-6 rounded-[16px] border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-[13px] font-semibold text-foreground">
          {en ? "Registrations" : "报名名单"}
        </h2>
        {regs.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">{en ? "No registrations yet." : "还没有人报名。"}</p>
        ) : (
          <ul className="divide-y divide-border">
            {regs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold text-foreground/70">
                  {(r.name || r.handle || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {r.name} <span className="font-normal text-muted-foreground">@{r.handle}</span>
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">{r.email}</p>
                  {r.note && <p className="mt-1 text-[11.5px] leading-5 text-foreground/70">{r.note}</p>}
                </div>
                <span
                  className={
                    r.status === "approved" || r.status === "won"
                      ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                      : r.status === "pending"
                        ? "rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                        : "rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
                  }
                >
                  {regStatusLabel(r.status, en)}
                </span>
                {r.status === "pending" && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onReview(r.id, "approve")}
                      disabled={busyId === r.id}
                      className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-emerald-500/12 px-2 text-[11.5px] font-medium text-emerald-700 disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" />
                      {en ? "Approve" : "通过"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onReview(r.id, "reject")}
                      disabled={busyId === r.id}
                      className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-secondary px-2 text-[11.5px] text-muted-foreground disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                      {en ? "Reject" : "拒绝"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-5 rounded-[16px] border border-border bg-card p-4">
        <h2 className="text-[13px] font-semibold text-foreground">{en ? "Event description" : "活动介绍"}</h2>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={6}
          className="mt-2 w-full resize-y rounded-[8px] border border-border bg-background px-2.5 py-2 text-[13px] leading-6 text-foreground outline-none focus:border-accent/60"
        />
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={onSaveDesc} className="btn btn-outline !h-8 px-3 text-xs">
            {en ? "Save" : "保存"}
          </button>
        </div>
      </section>

      <section className="mt-5 rounded-[16px] border border-border bg-card p-4">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Trophy className="h-4 w-4 text-amber-500" />
          {en ? "Publish results" : "发布结果"}
        </h2>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {event.state === "ended"
            ? en
              ? "Select winners and write a public summary."
              : "勾选入选者，写一段公开的结果说明。"
            : en
              ? "Available after the event ends."
              : "活动结束后才能发布。"}
        </p>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          placeholder={en ? "What happened, what was selected…" : "活动情况、入选名单说明…"}
          className="mt-2 w-full resize-y rounded-[8px] border border-border bg-background px-2.5 py-2 text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {approved.map((r) => (
            <label
              key={r.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-[11.5px] text-foreground/75"
            >
              <input
                type="checkbox"
                checked={winners.includes(r.id)}
                onChange={(e) =>
                  setWinners((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)))
                }
              />
              @{r.handle}
            </label>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onPublishResult}
            disabled={event.state !== "ended"}
            className="btn !h-8 px-3 text-xs disabled:opacity-50"
          >
            {en ? "Publish" : "发布结果"}
          </button>
        </div>
      </section>
    </div>
  );
}
