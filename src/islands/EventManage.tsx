import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  MailCheck,
  Pencil,
  Trophy,
  X,
} from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import {
  eventAction,
  eventRegistrations,
  getEvent,
  publishEventResult,
  regStatusLabel,
  reviewRegistration,
  type EventDetailData,
  type RegistrationRecord,
  type RegistrationStatus,
} from "@/lib/events";

const FILTERS: { key: "all" | RegistrationStatus; zh: string; en: string }[] = [
  { key: "all", zh: "全部", en: "All" },
  { key: "pending", zh: "待确认", en: "Pending" },
  { key: "approved", zh: "已通过", en: "Approved" },
  { key: "rejected", zh: "未通过", en: "Rejected" },
  { key: "won", zh: "已入选", en: "Selected" },
];

function fmtTime(iso: string, en: boolean) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return en
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 主办方管理页：报名名单（含资料、筛选、通过/拒绝）+ 编辑介绍 + 发布结果。 */
export default function EventManage({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [id, setId] = useState("");
  const [event, setEvent] = useState<EventDetailData | null>(null);
  const [regs, setRegs] = useState<RegistrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"all" | RegistrationStatus>("all");
  const [openId, setOpenId] = useState("");
  const [summary, setSummary] = useState("");
  const [winners, setWinners] = useState<string[]>([]);

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

  const counts = useMemo(() => {
    const c = { all: regs.length, pending: 0, approved: 0, rejected: 0, won: 0 };
    regs.forEach((r) => {
      if (r.status in c) c[r.status as keyof typeof c] += 1;
    });
    return c;
  }, [regs]);

  const shown = filter === "all" ? regs : regs.filter((r) => r.status === filter);

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

  const fields = event.formFields || [];

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
              ? `${counts.approved} approved · ${counts.pending} pending${event.capacity ? ` · ${event.capacity} spots` : ""}`
              : `已通过 ${counts.approved} 人 · 待确认 ${counts.pending} 人${event.capacity ? ` · 名额 ${event.capacity}` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={p(`/events/edit/?id=${encodeURIComponent(event.id)}`, locale)}
            className="btn btn-outline !h-8 px-3 text-xs"
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {en ? "Edit" : "编辑"}
          </a>
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
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-foreground">{en ? "Registrations" : "报名名单"}</h2>
          <div className="seg ml-auto flex gap-1 rounded-[10px] p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={
                  filter === f.key
                    ? "seg-thumb rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium text-foreground"
                    : "rounded-[7px] px-2.5 py-1 text-[11.5px] text-muted-foreground"
                }
              >
                {en ? f.en : f.zh}
                <span className="ml-1 tabular-nums opacity-60">{counts[f.key as keyof typeof counts] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-muted-foreground">
            {en ? "No registrations in this filter." : "这个筛选下还没有报名。"}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((r) => {
              const open = openId === r.id;
              return (
                <li key={r.id} className="px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <RegAvatar name={r.name || r.handle} src={r.avatar} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-foreground">{r.name || r.handle}</span>
                        <span className="text-[11.5px] text-muted-foreground">@{r.handle}</span>
                        {r.emailVerified && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            <MailCheck className="h-2.5 w-2.5" />
                            {en ? "Verified" : "邮箱已验证"}
                          </span>
                        )}
                        <span
                          className={
                            r.status === "approved" || r.status === "won"
                              ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700"
                              : r.status === "pending"
                                ? "rounded-full bg-amber-400/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700"
                                : "rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground"
                          }
                        >
                          {regStatusLabel(r.status, en)}
                        </span>
                      </div>

                      <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                        {r.email}
                        <span className="mx-1.5 opacity-40">·</span>
                        {en ? "Applied " : "报名于 "}
                        {fmtTime(r.at, en)}
                      </p>

                      {/* 创作者信息：作品与个人链接 */}
                      {(r.products?.length || r.website) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {(r.products || []).map((pr) => (
                            <a
                              key={pr.slug}
                              href={p(`/products/${pr.slug}/`, locale)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-foreground/70 hover:text-accent"
                            >
                              {pr.name}
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          ))}
                          {r.website && (
                            <a
                              href={r.website}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-foreground/70 hover:text-accent"
                            >
                              {en ? "Profile" : "个人主页"}
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      )}

                      {/* 展开：全部报名答案 */}
                      {open && (
                        <div className="mt-2.5 space-y-2 rounded-[10px] bg-secondary/50 p-3">
                          {fields.length > 0 ? (
                            fields.map((f) => {
                              const v = r.answers?.[f.key] || "";
                              if (!v) return null;
                              return (
                                <div key={f.key}>
                                  <p className="text-[11px] font-medium text-muted-foreground">{f.label}</p>
                                  {f.type === "product" && r.answerMeta?.[f.key] ? (
                                    <a
                                      href={p(`/products/${r.answerMeta[f.key].slug}/`, locale)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[12px] text-accent hover:underline"
                                    >
                                      {r.answerMeta[f.key].name}
                                    </a>
                                  ) : f.type === "url" ? (
                                    <a href={v} target="_blank" rel="noreferrer" className="break-all text-[12px] text-accent hover:underline">
                                      {v}
                                    </a>
                                  ) : (
                                    <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/80">{v}</p>
                                  )}
                                </div>
                              );
                            })
                          ) : r.note ? (
                            <div>
                              <p className="text-[11px] font-medium text-muted-foreground">{en ? "Note" : "报名说明"}</p>
                              <p className="whitespace-pre-wrap text-[12px] leading-5 text-foreground/80">{r.note}</p>
                            </div>
                          ) : (
                            <p className="text-[11.5px] text-muted-foreground">{en ? "No extra information." : "没有填写额外信息。"}</p>
                          )}
                          {r.bio && (
                            <div>
                              <p className="text-[11px] font-medium text-muted-foreground">{en ? "Bio" : "个人简介"}</p>
                              <p className="whitespace-pre-wrap text-[12px] leading-5 text-foreground/80">{r.bio}</p>
                            </div>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setOpenId(open ? "" : r.id)}
                        className="mt-1.5 text-[11.5px] text-accent hover:underline"
                      >
                        {open ? (en ? "Hide details" : "收起详情") : en ? "View details" : "查看详情"}
                      </button>
                    </div>

                    {r.status === "pending" && (
                      <div className="flex shrink-0 flex-col gap-1.5">
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
          {regs
            .filter((r) => r.status === "approved" || r.status === "won")
            .map((r) => (
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

function RegAvatar({ name, src }: { name: string; src?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
      />
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold text-foreground/70">
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
