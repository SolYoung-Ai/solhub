import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import { fetchMe, type AuthUser } from "@/lib/auth";
import { fetchWallet } from "@/lib/wallet";
import {
  createEvent,
  editEvent,
  EVENT_CATEGORIES,
  EVENT_PLANS,
  getEvent,
  type EventField,
  type EventPayload,
} from "@/lib/events";

const DEFAULT_FIELDS: EventField[] = [
  { key: "intro", label: "报名原因", type: "textarea", required: true, placeholder: "用一段话说清你为什么想参加" },
  { key: "contact", label: "联系方式", type: "text", required: true, placeholder: "微信 / Telegram / 手机号" },
  { key: "work", label: "作品或链接", type: "url", required: false, placeholder: "https://" },
];

const FIELD_TYPES: { value: EventField["type"]; label: string }[] = [
  { value: "text", label: "单行文本" },
  { value: "textarea", label: "多行文本" },
  { value: "url", label: "链接" },
  { value: "email", label: "邮箱" },
  { value: "tel", label: "电话" },
  { value: "number", label: "数字" },
  { value: "product", label: "选择产品" },
];

function newFieldKey() {
  return "f" + Math.random().toString(36).slice(2, 7);
}

/**
 * 创建 / 编辑活动。
 * 编辑模式由 ?id= 触发：已发布的活动只锁定时间与名额，其余仍可改。
 */
export default function EventForm({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [eventId, setEventId] = useState("");
  const [locked, setLocked] = useState(false);
  const [published, setPublished] = useState(false);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState("");
  const [category, setCategory] = useState("other");
  const [tags, setTags] = useState("");
  const [days, setDays] = useState(7);
  const [balance, setBalance] = useState<number | null>(null);
  const [capacity, setCapacity] = useState("");
  const [mode, setMode] = useState<"open" | "approval">("open");
  const [location, setLocation] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [audience, setAudience] = useState("");
  const [customText, setCustomText] = useState("");
  const [requireProduct, setRequireProduct] = useState(false);
  const [fields, setFields] = useState<EventField[]>(DEFAULT_FIELDS);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const id = qs.get("id") || "";
    setEventId(id);
    void fetchMe().then(async (u) => {
      setUser(u);
      void fetchWallet().then((r) => {
        if (r.ok && r.data) setBalance(r.data.balance);
      });
      if (!id) {
        if (u?.email) setContactEmail(u.email);
        setChecking(false);
        return;
      }
      const res = await getEvent(id);
      if (res.ok && res.data) {
        const e = res.data.event;
        if (!res.data.canManage) {
          setError(en ? "You can only edit your own events." : "只能编辑自己发起的活动。");
          setChecking(false);
          return;
        }
        setTitle(e.title);
        setSummary(e.summary || "");
        setDescription(e.description || "");
        setCover(e.cover || "");
        setCategory(e.category || "other");
        setTags((e.tags || []).join(", "));
        setDays(e.durationDays || 7);
        setCapacity(e.capacity ? String(e.capacity) : "");
        setMode(e.registrationMode);
        setLocation(e.location || "");
        setContactEmail(e.contactEmail || "");
        setAudience(e.audience || "");
        setCustomText(e.eligibility?.customText || "");
        setRequireProduct(!!e.eligibility?.requireProduct);
        if (Array.isArray(e.formFields) && e.formFields.length) setFields(e.formFields);
        setLocked(e.status === "published");
        setPublished(e.status === "published");
      } else {
        setError(res.error || "加载失败");
      }
      setChecking(false);
    });
  }, [en]);

  async function submit(asDraft: boolean) {
    setError("");
    if (title.trim().length < 4) return setError(en ? "Title needs at least 4 characters" : "标题至少 4 个字");
    const plan = EVENT_PLANS.find((p) => p.days === days);
    if (!plan) return setError(en ? "Choose a duration" : "请选择活动时长");
    if (!eventId && !user?.isAdmin && balance !== null && balance < plan.price) {
      return setError(
        en
          ? `Not enough points: ${plan.price} needed, ${balance} available.`
          : `积分不够：${plan.days} 天的活动需要 ${plan.price} 积分，当前 ${balance}。`,
      );
    }
    const bad = fields.find((f) => !f.label.trim());
    if (bad) return setError(en ? "Every form field needs a label" : "每个报名字段都要有名称");

    const payload: EventPayload = {
      title: title.trim(),
      summary: summary.trim(),
      description: description.trim(),
      cover: cover.trim(),
      category,
      tags: tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6),
      durationDays: days,
      audience: audience.trim(),
      eligibility: { requireEmailVerified: true, requireProduct, customText: customText.trim() },
      capacity: Number(capacity) || 0,
      registrationMode: mode,
      formFields: fields.map((f) => ({ ...f, label: f.label.trim() })),
      location: location.trim(),
      contactEmail: contactEmail.trim(),
      submit: !asDraft,
    };

    setBusy(true);
    const res = eventId ? await editEvent(eventId, payload) : await createEvent(payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || (en ? "Save failed" : "保存失败"));
      return;
    }
    const slug = "slug" in (res.data || {}) ? (res.data as { slug: string }).slug : "";
    window.location.href = p(`/events/detail/?slug=${encodeURIComponent(slug || eventId)}`, locale);
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {en ? "Loading…" : "加载中…"}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-[14px] font-medium text-foreground">{en ? "Log in to create an event" : "登录后才能发起活动"}</p>
        <a href={p("/login/", locale)} className="btn mt-4 !h-9 px-4 text-xs">
          {en ? "Log in" : "去登录"}
        </a>
      </div>
    );
  }

  if (error && eventId && !title) {
    return (
      <div className="container-page py-20 text-center">
        <p className="text-[14px] font-medium text-foreground">{error}</p>
        <a href={p("/events/mine/", locale)} className="btn btn-outline mt-4 !h-8 px-3 text-xs">
          {en ? "My events" : "我的活动"}
        </a>
      </div>
    );
  }

  const input =
    "h-9 w-full rounded-[8px] border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60 disabled:opacity-60";

  return (
    <div className="container-page max-w-3xl py-8">
      <a
        href={p(eventId ? "/events/mine/" : "/events/", locale)}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {eventId ? (en ? "My events" : "我的活动") : en ? "All events" : "全部活动"}
      </a>

      <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">
        {eventId ? (en ? "Edit event" : "编辑活动") : en ? "Create an event" : "发起活动"}
      </h1>
      <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
        {user.isAdmin
          ? en
            ? "As an admin this is published immediately as an official event."
            : "你是管理员：创建后会直接作为官方活动发布。"
          : eventId
            ? en
              ? "Changes to a published event go live right away."
              : "已发布的活动保存后立即生效。"
            : en
              ? "Submitted events are reviewed before they appear in the list."
              : "提交后需要审核，通过后会出现在活动列表。"}
      </p>

      {locked && (
        <p className="mt-3 rounded-[8px] bg-amber-400/12 px-3 py-2 text-[12px] leading-5 text-amber-800">
          {en
            ? "Duration, capacity and signup mode are locked because the event is already published."
            : "活动已发布：时长、名额和报名方式已锁定，其余内容可以继续修改。"}
        </p>
      )}

      <div className="mt-6 space-y-5 rounded-[16px] border border-border bg-card p-5 sm:p-6">
        <Field label={en ? "Title" : "活动标题"} required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className={input} placeholder={en ? "e.g. Global creator recruitment" : "例如：全球创作者招募计划"} />
        </Field>

        <Field label={en ? "One-line summary" : "一句话简介"} hint={en ? "Shown on cards" : "列表卡片上显示"}>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={120} className={input} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={en ? "Category" : "分类"}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={locked} className={input}>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {en ? c.en : c.zh}
                </option>
              ))}
            </select>
          </Field>
          <Field label={en ? "Tags" : "标签"} hint={en ? "Comma separated, max 6" : "逗号分隔，最多 6 个"}>
            <input value={tags} onChange={(e) => setTags(e.target.value)} className={input} placeholder="AI, 创作, 远程" />
          </Field>
        </div>

        {/* 时长即价格：起止日期由系统按审核通过时间生成，用户只选档位 */}
        <div>
          <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[12px] font-medium text-foreground/80">
            {en ? "Duration" : "活动时长"}
            <span className="text-[11px] font-normal text-muted-foreground">
              {en ? "Starts when approved. Signup closes at the end." : "审核通过后开始计时，报名截止与结束时间一致。"}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EVENT_PLANS.map((plan) => {
              const active = days === plan.days;
              return (
                <button
                  key={plan.days}
                  type="button"
                  disabled={locked}
                  onClick={() => setDays(plan.days)}
                  className={
                    active
                      ? "rounded-[10px] border border-accent bg-accent/8 px-3 py-2.5 text-left disabled:opacity-60"
                      : "rounded-[10px] border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-foreground/25 disabled:opacity-60"
                  }
                >
                  <span className="block font-display text-[14px] font-bold text-foreground">
                    {plan.days} {en ? "days" : "天"}
                  </span>
                  <span className={active ? "block text-[11.5px] font-medium text-accent" : "block text-[11.5px] text-muted-foreground"}>
                    {user?.isAdmin ? (en ? "Free (admin)" : "官方免费") : `${plan.price} ${en ? "pts" : "积分"}`}
                  </span>
                </button>
              );
            })}
          </div>
          {!user?.isAdmin && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {en ? "Balance " : "当前余额 "}
              <span className="font-semibold tabular-nums text-foreground">{balance ?? "—"}</span>
              {en ? " pts" : " 积分"}
              {balance !== null && balance < (EVENT_PLANS.find((x) => x.days === days)?.price || 0) && (
                <>
                  <span className="mx-1.5 opacity-40">·</span>
                  <a href={p("/wallet/", locale)} className="text-accent hover:underline">
                    {en ? "Top up in wallet" : "去钱包兑换"}
                  </a>
                </>
              )}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={en ? "Location" : "地点"} hint={en ? "Online / city / address" : "线上 / 城市 / 地址"}>
            <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} className={input} />
          </Field>
          <Field label={en ? "Contact email" : "联系邮箱"}>
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={input} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={en ? "Capacity" : "名额"} hint={en ? "0 = unlimited" : "0 表示不限"}>
            <input type="number" min={0} max={10000} value={capacity} onChange={(e) => setCapacity(e.target.value)} disabled={locked} className={input} placeholder="0" />
          </Field>
          <Field label={en ? "Signup mode" : "报名方式"}>
            <select value={mode} onChange={(e) => setMode(e.target.value as "open" | "approval")} disabled={locked} className={input}>
              <option value="open">{en ? "Instant" : "直接通过"}</option>
              <option value="approval">{en ? "Needs approval" : "需要审核"}</option>
            </select>
          </Field>
        </div>

        <Field label={en ? "Cover image URL" : "封面图地址"} hint={en ? "External image URL" : "外链图片地址，可留空"}>
          <input value={cover} onChange={(e) => setCover(e.target.value)} className={input} placeholder="https://…" />
        </Field>

        <Field label={en ? "Who it is for" : "适合人群"}>
          <input value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={120} className={input} placeholder={en ? "Designers, indie hackers…" : "设计师、独立开发者…"} />
        </Field>

        {/* 报名表单 */}
        <div className="rounded-[12px] border border-border bg-secondary/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12.5px] font-semibold text-foreground">{en ? "Signup form" : "报名表单"}</p>
              <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
                {en
                  ? "Fields shown to every applicant. Mark the ones you need."
                  : "报名者要填的内容，可增删、可设必填。邮箱验证由系统强制要求。"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFields((prev) => [...prev, { key: newFieldKey(), label: "", type: "text", required: false, placeholder: "" }])}
              disabled={fields.length >= 8}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[7px] border border-border bg-card px-2.5 text-[11.5px] text-foreground/80 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {en ? "Add field" : "添加字段"}
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {fields.map((f, i) => (
              <div key={f.key} className="rounded-[10px] border border-border bg-card p-2.5">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  <input
                    value={f.label}
                    onChange={(e) => setFields((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    maxLength={40}
                    placeholder={en ? "Field name, e.g. Contact" : "字段名称，如 联系方式"}
                    className="h-8 min-w-0 flex-1 rounded-[7px] border border-border bg-background px-2 text-[12.5px] outline-none focus:border-accent/60"
                  />
                  <select
                    value={f.type}
                    onChange={(e) => setFields((prev) => prev.map((x, j) => (j === i ? { ...x, type: e.target.value as EventField["type"] } : x)))}
                    className="h-8 shrink-0 rounded-[7px] border border-border bg-background px-1.5 text-[11.5px] text-foreground outline-none"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {en ? t.value : t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={en ? "Remove field" : "删除字段"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2 pl-5">
                  <input
                    value={f.placeholder || ""}
                    onChange={(e) => setFields((prev) => prev.map((x, j) => (j === i ? { ...x, placeholder: e.target.value } : x)))}
                    maxLength={60}
                    placeholder={en ? "Placeholder (optional)" : "输入提示（可选）"}
                    className="h-7 min-w-0 flex-1 rounded-[6px] border border-border bg-background px-2 text-[11.5px] outline-none focus:border-accent/60"
                  />
                  <label className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-foreground/70">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => setFields((prev) => prev.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))}
                    />
                    {en ? "Required" : "必填"}
                  </label>
                </div>
              </div>
            ))}
            {fields.length === 0 && (
              <p className="rounded-[8px] bg-card px-3 py-4 text-center text-[11.5px] text-muted-foreground">
                {en ? "No fields — applicants just click sign up." : "没有字段：报名者点一下就算报名。"}
              </p>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[12px] font-medium text-foreground/80">{en ? "Requirements" : "参加条件"}</p>
          <div className="flex flex-wrap gap-4 text-[12.5px] text-foreground/75">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked disabled />
              {en ? "Verified email (always)" : "邮箱验证（固定要求）"}
            </span>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={requireProduct} onChange={(e) => setRequireProduct(e.target.checked)} />
              {en ? "At least one product" : "需要上传过产品"}
            </label>
          </div>
          <input
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            maxLength={200}
            className={`${input} mt-2`}
            placeholder={en ? "Any extra requirement (optional)" : "补充说明（可选）"}
          />
        </div>

        <Field label={en ? "Details" : "活动介绍"} required>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            maxLength={8000}
            className="w-full resize-y rounded-[8px] border border-border bg-background px-2.5 py-2 text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60"
            placeholder={en ? "What happens, who should join, how it works…" : "活动内容、参与方式、你能得到什么…"}
          />
        </Field>

        {error && <p className="rounded-[8px] bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {!eventId && !user.isAdmin && (
            <button type="button" onClick={() => submit(true)} disabled={busy} className="btn btn-outline !h-9 px-4 text-xs disabled:opacity-60">
              {en ? "Save draft" : "保存草稿"}
            </button>
          )}
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 rounded-[8px] bg-accent px-4 text-xs font-semibold text-accent-foreground disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {eventId
              ? en
                ? "Save changes"
                : "保存修改"
              : user.isAdmin
                ? en
                  ? "Publish"
                  : "直接发布"
                : en
                  ? "Submit for review"
                  : "提交审核"}
          </button>
        </div>
        {published && (
          <p className="text-right text-[11px] text-muted-foreground">
            {en ? "Edits are visible immediately." : "保存后立即对访客生效。"}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1 text-[12px] font-medium text-foreground/80">
        {label}
        {required && <span className="text-accent">*</span>}
        {hint && <span className="ml-auto text-[11px] font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
