import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import { fetchMe, type AuthUser } from "@/lib/auth";
import { createEvent, EVENT_CATEGORIES, type EventPayload } from "@/lib/events";

/** 创建活动：用户提交后进审核队列；管理员创建的自动成为官方活动并直接发布。 */
export default function EventForm({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState("");
  const [category, setCategory] = useState("other");
  const [tags, setTags] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [deadline, setDeadline] = useState("");
  const [capacity, setCapacity] = useState("");
  const [mode, setMode] = useState<"open" | "approval">("open");
  const [location, setLocation] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [audience, setAudience] = useState("");
  const [customText, setCustomText] = useState("");
  const [requireEmail, setRequireEmail] = useState(false);
  const [requireProduct, setRequireProduct] = useState(false);

  useEffect(() => {
    void fetchMe().then((u) => {
      setUser(u);
      if (u?.email) setContactEmail(u.email);
      setChecking(false);
    });
  }, []);

  const toIso = (v: string) => (v ? new Date(v).toISOString() : "");

  async function submit(asDraft: boolean) {
    setError("");
    if (title.trim().length < 4) return setError(en ? "Title needs at least 4 characters" : "标题至少 4 个字");
    if (!startAt || !endAt) return setError(en ? "Start and end time are required" : "请填写开始和结束时间");
    if (new Date(startAt) >= new Date(endAt)) return setError(en ? "End must be after start" : "结束时间必须晚于开始时间");
    if (deadline && new Date(deadline) > new Date(endAt)) {
      return setError(en ? "Signup deadline cannot be after the end" : "报名截止不能晚于活动结束");
    }

    const payload: EventPayload = {
      title: title.trim(),
      summary: summary.trim(),
      description: description.trim(),
      cover: cover.trim(),
      category,
      tags: tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6),
      startAt: toIso(startAt),
      endAt: toIso(endAt),
      signupDeadline: toIso(deadline),
      audience: audience.trim(),
      eligibility: { requireEmailVerified: requireEmail, requireProduct, customText: customText.trim() },
      capacity: Number(capacity) || 0,
      registrationMode: mode,
      location: location.trim(),
      contactEmail: contactEmail.trim(),
      submit: !asDraft,
    };

    setBusy(true);
    const res = await createEvent(payload);
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error || "创建失败");
      return;
    }
    window.location.href = p(`/events/detail/?slug=${encodeURIComponent(res.data.slug)}`, locale);
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

  const input =
    "h-9 w-full rounded-[8px] border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60";

  return (
    <div className="container-page max-w-3xl py-8">
      <a
        href={p("/events/", locale)}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {en ? "All events" : "全部活动"}
      </a>

      <h1 className="font-display text-2xl font-extrabold tracking-tight text-foreground">
        {en ? "Create an event" : "发起活动"}
      </h1>
      <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
        {user.isAdmin
          ? en
            ? "As an admin this is published immediately as an official event."
            : "你是管理员：创建后会直接作为官方活动发布。"
          : en
            ? "Submitted events are reviewed before they appear in the list."
            : "提交后需要审核，通过后会出现在活动列表。"}
      </p>

      <div className="mt-6 space-y-5 rounded-[16px] border border-border bg-card p-5 sm:p-6">
        <Field label={en ? "Title" : "活动标题"} required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className={input} placeholder={en ? "e.g. Global creator recruitment" : "例如：全球创作者招募计划"} />
        </Field>

        <Field label={en ? "One-line summary" : "一句话简介"} hint={en ? "Shown on cards" : "列表卡片上显示"}>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={120} className={input} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={en ? "Category" : "分类"}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={en ? "Starts" : "开始时间"} required>
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={input} />
          </Field>
          <Field label={en ? "Ends" : "结束时间"} required>
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={input} />
          </Field>
          <Field label={en ? "Signup deadline" : "报名截止"} hint={en ? "Defaults to end" : "留空则同结束时间"}>
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={input} />
          </Field>
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
            <input type="number" min={0} max={10000} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={input} placeholder="0" />
          </Field>
          <Field label={en ? "Signup mode" : "报名方式"}>
            <select value={mode} onChange={(e) => setMode(e.target.value as "open" | "approval")} className={input}>
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

        <div>
          <p className="mb-2 text-[12px] font-medium text-foreground/80">{en ? "Requirements" : "参加条件"}</p>
          <div className="flex flex-wrap gap-4 text-[12.5px] text-foreground/75">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={requireEmail} onChange={(e) => setRequireEmail(e.target.checked)} />
              {en ? "Verified email" : "需要验证邮箱"}
            </label>
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
          {!user.isAdmin && (
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={busy}
              className="btn btn-outline !h-9 px-4 text-xs disabled:opacity-60"
            >
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
            {user.isAdmin ? (en ? "Publish" : "直接发布") : en ? "Submit for review" : "提交审核"}
          </button>
        </div>
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
  children: React.ReactNode;
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
