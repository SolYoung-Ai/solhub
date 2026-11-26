import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  MapPin,
  Settings2,
  Users,
} from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import {
  cancelRegistration,
  categoryLabel,
  getEvent,
  myProducts,
  rangeText,
  registerEvent,
  regStatusLabel,
  stateLabel,
  type EventDetailData,
  type MyRegistration,
} from "@/lib/events";

/**
 * 活动详情
 *
 * 静态站做不了 /events/<slug>/ 这种运行时路由，所以统一走 /events/detail/?slug=xxx。
 * 报名成功后不重新拉详情（KV 最终一致），直接用返回的 status 更新本地按钮。
 */
/**
 * 极简 Markdown：`## 小标题`、`- 列表`、行内 `**加粗**`，其余按段落。
 * 不引 markdown 库、也不 dangerouslySetInnerHTML —— 活动正文是用户输入，
 * 走 React 元素渲染可以从根上避开 XSS。
 */
function inlineBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function RichText({ text }: { text: string }) {
  const blocks = String(text).split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return null;
        if (lines.length === 1 && lines[0].startsWith("## ")) {
          return (
            <h3 key={i} className="mt-6 font-display text-[14.5px] font-bold text-foreground">
              {lines[0].slice(3)}
            </h3>
          );
        }
        if (lines.every((l) => /^[-•]\s+/.test(l))) {
          return (
            <ul key={i} className="mt-2 list-disc space-y-1.5 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inlineBold(l.replace(/^[-•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="mt-3">
            {inlineBold(lines.join(" "))}
          </p>
        );
      })}
    </>
  );
}

export default function EventDetail({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [slug, setSlug] = useState("");
  const [event, setEvent] = useState<EventDetailData | null>(null);
  const [reg, setReg] = useState<MyRegistration | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [needVerify, setNeedVerify] = useState(false);
  const [products, setProducts] = useState<{ slug: string; name: string }[]>([]);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    setSlug(qs.get("slug") || "");
  }, []);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    void getEvent(slug).then((res) => {
      if (!alive) return;
      if (!res.ok || !res.data) {
        setError(res.error || "加载失败");
      } else {
        setEvent(res.data.event);
        setReg(res.data.myRegistration);
        setCanManage(res.data.canManage);
        document.title = `${res.data.event.title} · SolHub`;
        setAuthed(!!res.data.authenticated);
        /* 报名表单里有「选择产品」时，才去拉自己名下的产品列表 */
        if (res.data.authenticated && (res.data.event.formFields || []).some((f) => f.type === "product")) {
          void myProducts().then((r) => {
            if (alive && r.ok && r.data) setProducts(r.data.products || []);
          });
        }
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  async function onRegister() {
    if (!event) return;
    const fields = event.formFields || [];
    const missing = fields.find((f) => f.required && !String(answers[f.key] || "").trim());
    if (missing) {
      setMessage(en ? `Please fill in “${missing.label}”` : `请填写「${missing.label}」`);
      return;
    }
    setBusy(true);
    setMessage("");
    setNeedVerify(false);
    const res = await registerEvent(event.id, answers);
    setBusy(false);
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = p("/login/", locale);
        return;
      }
      if (res.status === 403 && /邮箱/.test(res.error || "")) {
        setNeedVerify(true);
      }
      setMessage(res.error || (en ? "Signup failed" : "报名失败"));
      return;
    }
    const status = res.data?.status || "approved";
    setReg({ id: "", status, at: new Date().toISOString(), note: "" });
    setMessage(res.data?.message || (en ? "Signed up" : "报名成功"));
  }

  async function onCancel() {
    if (!event) return;
    if (!window.confirm(en ? "Cancel your registration?" : "确定取消报名吗？名额会释放给其他人。")) return;
    setBusy(true);
    const res = await cancelRegistration(event.id);
    setBusy(false);
    if (!res.ok) {
      setMessage(res.error || "取消失败");
      return;
    }
    setReg(null);
    setMessage(res.data?.message || "已取消报名");
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
        <p className="text-[14px] font-medium text-foreground">{error || (en ? "Event not found" : "活动不存在")}</p>
        <a href={p("/events/", locale)} className="btn btn-outline mt-4 !h-8 px-3 text-xs">
          {en ? "Back to events" : "返回活动列表"}
        </a>
      </div>
    );
  }

  const full = event.capacity > 0 && event.approvedCount >= event.capacity;
  const ended = event.state === "ended" || event.state === "offline";
  const canSignup = event.status === "published" && event.signupOpen !== false && !full && !ended;
  const shownState = event.state === "upcoming" && event.signupOpen === false ? "signup_closed" : event.state;
  const stateText =
    shownState === "signup_closed" ? (en ? "Signup closed" : "报名截止") : stateLabel(event.state, en);

  return (
    <div className="container-page py-6 sm:py-8">
      <a
        href={p("/events/", locale)}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {en ? "All events" : "全部活动"}
      </a>

      <div className="overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="relative h-[180px] w-full bg-secondary sm:h-[230px]">
          {event.cover ? (
            <img src={event.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(120deg,rgba(255,138,61,0.16),rgba(90,140,255,0.18))]">
              <CalendarDays className="h-9 w-9 text-foreground/20" />
            </div>
          )}
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-foreground/70">
              {categoryLabel(event.category, en)}
            </span>
            {event.ownerType === "official" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#2F80ED]/10 px-2 py-0.5 font-medium text-[#2F80ED]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2F80ED]" />
                {en ? "Official" : "官方活动"}
              </span>
            ) : (
              <span className="text-muted-foreground">@{event.ownerHandle}</span>
            )}
            <span
              className={
                event.state === "ongoing"
                  ? "rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-600"
                  : ended
                    ? "rounded-full bg-foreground/8 px-2 py-0.5 text-muted-foreground"
                    : "rounded-full bg-accent/12 px-2 py-0.5 font-semibold text-accent"
              }
            >
              {stateText}
            </span>
            {event.featured && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 font-medium text-amber-700">置顶</span>}
          </div>

          <h1 className="mt-3 font-display text-[24px] font-extrabold leading-9 tracking-tight text-foreground sm:text-[28px]">
            {event.title}
          </h1>
          {event.summary && <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">{event.summary}</p>}

          <div className="mt-4 grid gap-2 text-[12.5px] text-foreground/75 sm:grid-cols-2">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              {rangeText(event.startAt, event.endAt, en)}
            </span>
            {event.location && (
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {event.location}
              </span>
            )}
            {event.signupDeadline && (
              <span className="inline-flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                {en ? "Signup by " : "报名截止 "}
                {rangeText(event.signupDeadline, event.signupDeadline, en).split(" – ")[0]}
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              {event.capacity > 0
                ? en
                  ? `${event.approvedCount} / ${event.capacity} joined`
                  : `${event.approvedCount} / ${event.capacity} 人已报名`
                : en
                  ? `${event.approvedCount} joined`
                  : `${event.approvedCount} 人已报名`}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <article className="min-w-0 rounded-[16px] border border-border bg-card p-5 sm:p-6">
          <h2 className="font-display text-[15px] font-bold text-foreground">{en ? "About" : "活动介绍"}</h2>
          {event.description ? (
            <div className="mt-3 break-words text-[13.5px] leading-7 text-foreground/80">
              <RichText text={event.description} />
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">{en ? "No details yet." : "主办方还没填详细介绍。"}</p>
          )}

          {(event.audience || event.eligibility?.customText) && (
            <div className="mt-6 rounded-[12px] border border-border bg-secondary/40 p-4">
              <h3 className="text-[12.5px] font-semibold text-foreground">{en ? "Who it is for" : "适合谁 / 参加条件"}</h3>
              {event.audience && <p className="mt-1.5 text-[12.5px] leading-6 text-foreground/70">{event.audience}</p>}
              {event.eligibility?.customText && (
                <p className="mt-1.5 text-[12.5px] leading-6 text-foreground/70">{event.eligibility.customText}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {event.eligibility?.requireEmailVerified && (
                  <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                    {en ? "Verified email" : "需验证邮箱"}
                  </span>
                )}
                {event.eligibility?.requireProduct && (
                  <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                    {en ? "At least one product" : "需上传过产品"}
                  </span>
                )}
              </div>
            </div>
          )}

          {event.result?.summary && (
            <div className="mt-6 rounded-[12px] border border-emerald-500/25 bg-emerald-500/6 p-4">
              <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {en ? "Results" : "活动结果"}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-6 text-foreground/80">{event.result.summary}</p>
              {event.result.winners.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {event.result.winners.map((w) => (
                    <span key={w.id} className="rounded-full bg-card px-2 py-0.5 text-[11px] text-foreground/70">
                      @{w.handle || w.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </article>

        <aside className="lg:sticky lg:top-4">
          <div className="rounded-[16px] border border-border bg-card p-4">
            <h2 className="text-[13px] font-semibold text-foreground">{en ? "Sign up" : "报名"}</h2>

            {message && (
              <div
                className={
                  reg
                    ? "mt-2 rounded-[8px] bg-emerald-500/10 px-2.5 py-1.5 text-[11.5px] leading-5 text-emerald-700"
                    : "mt-2 rounded-[8px] bg-destructive/10 px-2.5 py-1.5 text-[11.5px] leading-5 text-destructive"
                }
              >
                <p>{message}</p>
                {needVerify && (
                  <a href={p("/account/", locale)} className="mt-1 inline-block font-medium underline">
                    {en ? "Verify your email →" : "去验证邮箱 →"}
                  </a>
                )}
              </div>
            )}

            {reg ? (
              <div className="mt-3">
                <p className="text-[12.5px] text-foreground/75">
                  {en ? "Your status: " : "你的状态："}
                  <span className="font-semibold text-foreground">{regStatusLabel(reg.status, en)}</span>
                </p>
                {reg.status === "pending" && (
                  <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
                    {en ? "The host will review your request." : "主办方确认后会更新状态。"}
                  </p>
                )}
                {event.state !== "ended" && (
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={busy}
                    className="mt-3 h-9 w-full rounded-[8px] border border-border text-[12.5px] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                  >
                    {en ? "Cancel registration" : "取消报名"}
                  </button>
                )}
              </div>
            ) : canSignup ? (
              <div className="mt-3 space-y-2.5">
                {(event.formFields || []).map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 flex items-baseline gap-1 text-[11.5px] font-medium text-foreground/75">
                      {f.label}
                      {f.required && <span className="text-accent">*</span>}
                    </span>
                    {f.type === "textarea" ? (
                      <textarea
                        value={answers[f.key] || ""}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        rows={3}
                        maxLength={2000}
                        placeholder={f.placeholder || ""}
                        className="w-full resize-y rounded-[8px] border border-border bg-background px-2.5 py-2 text-[12.5px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60"
                      />
                    ) : f.type === "product" ? (
                      !authed ? (
                        <p className="rounded-[8px] bg-secondary px-2.5 py-2 text-[11.5px] leading-5 text-muted-foreground">
                          {en ? "Log in to pick one of your submitted products." : "登录后可以从你已提交的产品里选择。"}
                        </p>
                      ) : (
                        <div>
                          <select
                            value={answers[f.key] || ""}
                            onChange={(e) => setAnswers((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            disabled={products.length === 0}
                            className="h-9 w-full rounded-[8px] border border-border bg-background px-2.5 text-[12.5px] text-foreground outline-none focus:border-accent/60 disabled:opacity-60"
                          >
                            <option value="">{en ? "Select one of your products" : "选择你已提交的产品"}</option>
                            {products.map((pr) => (
                              <option key={pr.slug} value={pr.slug}>
                                {pr.name}
                              </option>
                            ))}
                          </select>
                          {products.length === 0 && (
                            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              {en ? "No product submitted yet. " : "你还没有提交产品，"}
                              <a
                                href={p("/submit/", locale)}
                                onClick={(e) => e.stopPropagation()}
                                className="text-accent hover:underline"
                              >
                                {en ? "Submit one first" : "先去提交"}
                              </a>
                            </p>
                          )}
                        </div>
                      )
                    ) : (
                      <input
                        type={f.type === "url" ? "url" : f.type === "email" ? "email" : f.type === "number" ? "number" : f.type === "tel" ? "tel" : "text"}
                        value={answers[f.key] || ""}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        maxLength={2000}
                        placeholder={f.placeholder || ""}
                        className="h-9 w-full rounded-[8px] border border-border bg-background px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60"
                      />
                    )}
                  </label>
                ))}

                <button
                  type="button"
                  onClick={onRegister}
                  disabled={busy}
                  className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] bg-accent text-[13px] font-semibold text-accent-foreground transition-opacity hover:opacity-95 disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {event.registrationMode === "approval"
                    ? en
                      ? "Submit request"
                      : "提交报名申请"
                    : en
                      ? "Sign up"
                      : "立即报名"}
                </button>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {event.registrationMode === "approval"
                    ? en
                      ? "The host reviews every request. Email must be verified."
                      : "主办方会逐条确认；报名前需先完成邮箱验证。"
                    : en
                      ? "You are in immediately. Email must be verified."
                      : "报名即通过，名额先到先得；报名前需先完成邮箱验证。"}
                </p>
              </div>
            ) : (
              <p className="mt-3 rounded-[8px] bg-secondary px-2.5 py-2 text-[12px] text-muted-foreground">
                {ended
                  ? en
                    ? "This event has ended."
                    : "活动已结束。"
                  : full
                    ? en
                      ? "All spots are taken."
                      : "名额已满。"
                    : en
                      ? "Signup is closed."
                      : "报名已截止。"}
              </p>
            )}

            <div className="mt-4 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
              <p>
                {en ? "Hosted by " : "主办方："}
                <span className="text-foreground/75">{event.ownerName || `@${event.ownerHandle}`}</span>
              </p>
              {event.contactEmail && (
                <p className="mt-1 break-all">
                  {en ? "Contact: " : "联系："}
                  <a href={`mailto:${event.contactEmail}`} className="text-accent hover:underline">
                    {event.contactEmail}
                  </a>
                </p>
              )}
              {canManage && (
                <a
                  href={p(`/events/manage/?id=${encodeURIComponent(event.id)}`, locale)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[8px] border border-border px-2.5 py-1.5 text-[12px] text-foreground/80 transition-colors hover:border-foreground/25"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {en ? "Manage event" : "管理这场活动"}
                </a>
              )}
              {canManage && event.pendingCount ? (
                <p className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-accent">
                  <ClipboardList className="h-3.5 w-3.5" />
                  {en ? `${event.pendingCount} pending` : `${event.pendingCount} 条报名待确认`}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
