import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  Globe2,
  Loader2,
  Mail,
  Package,
  ShieldAlert,
  UploadCloud,
} from "lucide-react";
import { productCategories } from "@/data/product-categories";
import { productCategoryNameLocalized } from "@/i18n/data";
import { submissionConfig } from "@/data/site";
import { p } from "@/lib/paths";
import {
  submitSubmission,
  exportSubmissionJson,
  type SubmissionMode,
} from "@/lib/submission";
import {
  isCloudBaseConfigured,
  submitToCloudbase,
  uploadHostedTool,
  type CloudbaseSubmissionPayload,
} from "@/lib/cloudbase";
import { isValidHttpUrl } from "@/lib/utils";
import { fetchMe, type AuthUser } from "@/lib/auth";
import { Message } from "@/components/tool-ui";
import type { Submission } from "@/data/types";
import type { Locale } from "@/i18n";
import { getDict, translate } from "@/i18n";

type SubmitKind = "product" | "tool";
type ToolType = "external" | "hosted";

interface FormState {
  kind: SubmitKind;
  toolType: ToolType;
  name: string;
  websiteUrl: string;
  shortDescription: string;
  description: string;
  category: string;
  tags: string;
  iconUrl: string;
  developerName: string;
  contact: string;
}

const initial: FormState = {
  kind: "product",
  toolType: "external",
  name: "",
  websiteUrl: "",
  shortDescription: "",
  description: "",
  category: "ai-tools",
  tags: "",
  iconUrl: "",
  developerName: "",
  contact: "",
};

type Errors = Partial<Record<keyof FormState, string>> & { hostedFile?: string };

export default function SubmitForm({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const en = locale === "en";
  const [form, setForm] = useState<FormState>(initial);
  const [hostedFile, setHostedFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [result, setResult] = useState<{ mode: SubmissionMode; message: string; url?: string } | null>(null);
  const [draftJson, setDraftJson] = useState("");
  const [me, setMe] = useState<AuthUser | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cloudbaseReady = useMemo(() => isCloudBaseConfigured(), []);

  useEffect(() => {
    void fetchMe().then(setMe);
  }, []);
  const githubRepo = submissionConfig.githubIssueRepo ?? null;
  const modes = useMemo(() => {
    const remote = Boolean(submissionConfig.remoteEndpoint);
    return { remote, githubRepo: submissionConfig.githubIssueRepo ?? null };
  }, []);

  const set = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setStatus("idle");
  };

  const setKind = (kind: SubmitKind) => {
    setForm((f) => ({ ...f, kind }));
    setErrors({});
    setStatus("idle");
  };
  const setToolType = (toolType: ToolType) => {
    setForm((f) => ({ ...f, toolType }));
    setErrors({});
    setStatus("idle");
  };

  const isHosted = form.kind === "tool" && form.toolType === "hosted";
  const needsUrl = form.kind === "product" || (form.kind === "tool" && form.toolType === "external");

  const validate = (): Errors => {
    const e: Errors = {};
    if (!form.name.trim()) e.name = en ? "Please enter a name." : "请输入名称。";
    else if (form.name.trim().length > 80) e.name = en ? "Name must be under 80 characters." : "名称请控制在 80 字以内。";
    if (needsUrl) {
      if (!form.websiteUrl.trim()) e.websiteUrl = form.kind === "product" ? (en ? "Please enter the product website URL." : "请输入产品官网 URL。") : (en ? "Please enter the tool URL." : "请输入工具访问 URL。");
      else if (!isValidHttpUrl(form.websiteUrl.trim())) e.websiteUrl = en ? "URL must start with http:// or https://." : "URL 需以 http:// 或 https:// 开头。";
    } else if (form.websiteUrl.trim() && !isValidHttpUrl(form.websiteUrl.trim())) {
      e.websiteUrl = en ? "URL must start with http:// or https://." : "URL 需以 http:// 或 https:// 开头。";
    }
    if (!form.shortDescription.trim()) e.shortDescription = en ? "Please enter a one-line description." : "请输入一句话介绍。";
    else if (form.shortDescription.trim().length > 200) e.shortDescription = en ? "One-line description must be under 200 characters." : "一句话介绍请控制在 200 字以内。";
    if (!form.description.trim()) e.description = en ? "Please enter a detailed description." : "请输入详细描述。";
    else if (form.description.trim().length > 2000) e.description = en ? "Detailed description must be under 2000 characters." : "详细描述请控制在 2000 字以内。";
    const tagCount = form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).length;
    if (tagCount === 0) e.tags = en ? "Add at least one tag (comma-separated)." : "至少填写一个标签（用逗号分隔）。";
    else if (tagCount > 8) e.tags = en ? "At most 8 tags." : "标签最多 8 个。";
    if (form.iconUrl.trim() && !isValidHttpUrl(form.iconUrl.trim()) && !form.iconUrl.startsWith("data:")) e.iconUrl = en ? "Icon URL must start with http:// or https://." : "图标 URL 需以 http:// 或 https:// 开头。";
    if (!form.developerName.trim()) e.developerName = en ? "Please enter the developer or team name." : "请输入开发者或团队名称。";
    else if (form.developerName.trim().length > 80) e.developerName = en ? "Developer name must be under 80 characters." : "开发者名称请控制在 80 字以内。";
    if (isHosted) {
      if (isHosted) {
        // HTML file attached via email
      }
    }
    return e;
  };

  const handlePreview = () => {
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setShowPreview(true);
  };

  const buildPayload = (): CloudbaseSubmissionPayload => ({
    kind: form.kind,
    name: form.name.trim(),
    short_description: form.shortDescription.trim(),
    description: form.description.trim(),
    url: form.websiteUrl.trim() || undefined,
    category: form.category,
    tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    icon_url: form.iconUrl.trim() || undefined,
    developer: form.developerName.trim(),
    contact: form.contact.trim() || undefined,
    tool_type: form.kind === "tool" ? form.toolType : undefined,
  });

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;

    const payload = buildPayload();

    /* 已登录：提交到认证服务，自动收录到个人名下（community.json） */
    if (me) {
      setStatus("submitting");
      try {
        const apiBase =
          (import.meta.env.PUBLIC_SOLHUB_API as string | undefined) ||
          "https://solhub-auth.solyoung.top";
        const res = await fetch(`${apiBase.replace(/\/$/, "")}/publish`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            shortDescription: payload.short_description,
            description: payload.description,
            websiteUrl: payload.url,
            category: payload.category,
            tags: payload.tags,
            iconUrl: payload.icon_url,
            developerName: payload.developer,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setResult({ mode: "cloudbase", message: data.error || `提交失败（${res.status}）` });
          return;
        }
        setStatus("success");
        setResult({
          mode: "cloudbase",
          message: en
            ? "Published! Your product is live on the community list (site rebuilds within ~2 minutes). Manage it anytime in My Account."
            : "发布成功！产品已自动收录上线（网站约 2 分钟内刷新展示）。可以在「个人中心」随时编辑或删除。",
        });
        return;
      } catch {
        setStatus("error");
        setResult({ mode: "cloudbase", message: en ? "Network error. Please retry." : "网络错误，请稍后重试。" });
        return;
      }
    }

    /* 未登录：保留原有邮件提交通道 */
    const hasUploadedIcon = form.iconUrl.trim().startsWith("data:");
    const lines = [
      `产品名称：${form.name.trim()}`,
      `一句话介绍：${form.shortDescription.trim()}`,
      `详细描述：${form.description.trim()}`,
      `官网 URL：${form.websiteUrl.trim()}`,
      `分类：${form.category}`,
      `标签：${form.tags.trim()}`,
      form.iconUrl.trim() && !hasUploadedIcon ? `图标 URL：${form.iconUrl.trim()}` : "",
      `开发者/团队：${form.developerName.trim()}`,
      form.contact.trim() ? `联系方式：${form.contact.trim()}` : "",
      hasUploadedIcon ? "\n（请将图标图片文件作为附件添加到本邮件）" : "",
      isHosted ? "\n（请将 HTML 文件作为附件添加到本邮件）" : "",
    ].filter(Boolean);

    const subject = `[SolHub 产品提交] ${form.name.trim()}`;
    const body = lines.join("\n");
    const mailto = `mailto:soyoang@outlook.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.location.href = mailto;
    setStatus("success");
    setResult({
      mode: "cloudbase",
      message: en
        ? `Opening your email client... Send the email to complete your submission. We'll review within 24 hours.`
        : `正在打开邮箱... 发送邮件即完成提交，我们会在 24 小时内核验。`,
    });
  };

  const modeNote = me
    ? (en
      ? "Submitting while logged in: if your link opens correctly, the product is verified automatically and goes live instantly — no manual review. Manage it in My Account."
      : "登录状态提交：官网链接可以正常打开即可通过自动检测，产品立即收录上线，无需人工审核；可在「个人中心」随时编辑或删除。")
    : (en
      ? "Fill the form and click submit — your email client opens with all info pre-filled. Send it and we'll review within 24 hours."
      : "填完表单点击提交，邮箱会自动打开并填好所有信息，发送即完成，我们会在 24 小时内核验。");

  return (
    <div className="space-y-6">
      {/* 登录引导（未登录时） */}
      {!me && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-accent/30 bg-accent/5 p-4">
          <div className="text-[13px] leading-6">
            <p className="font-bold text-foreground">
              {en ? "Tip: log in to publish in one click" : "提示：登录后可以一键收录"}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {en
                ? "Logged-in submissions skip the email step and are managed from My Account."
                : "登录后提交无需走邮件流程，产品直接收录到你的账号名下，随时可编辑或删除。"}
            </p>
          </div>
          <a href={p("/login/?next=" + encodeURIComponent("/submit/"), locale)} className="btn btn-accent shrink-0 !h-9 px-4 text-xs">
            {en ? "Log in / Sign up" : "登录 / 注册"}
          </a>
        </div>
      )}

      {/* 提交后会发生什么 */}
      <div className="flex items-start gap-2.5 rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-semibold text-foreground/80">{en ? "What happens after you submit" : "提交后会发生什么"}</p>
          <p className="mt-1">{modeNote}</p>
          <p className="mt-1">
            {en
              ? "Logged-in submissions are checked automatically (the link must open) and go live immediately. Anything violating laws or infringing others will be removed."
              : "登录提交会自动检测链接可达性，通过即上线；仅违法违规或侵权内容会被下架。"}
          </p>
        </div>
      </div>

      {/* 收录标准 */}
      <div className="rounded-[3px] border border-border bg-card p-4">
        <p className="text-[13px] font-bold text-foreground">
          {en ? "Listing criteria" : "收录标准"}
        </p>
        <ul className="mt-2 grid gap-1.5 text-[13px] leading-6 text-muted-foreground sm:grid-cols-2">
          {(en
            ? [
              "The official site opens and is publicly accessible",
              "Product info is real and complete (name, description, URL)",
              "Original work — no infringing or illegal content",
              "Ready to use, not a placeholder or under-construction page",
            ]
            : [
              "官网可正常访问，无需登录即可浏览",
              "产品信息真实完整（名称、介绍、链接一致）",
              "原创产品，无侵权或违法违规内容",
              "已可正常使用，不是占位页或半成品",
            ]
          ).map((item) => (
            <li key={item} className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* 类型切换 */}
      <div role="tablist" aria-label={en ? "Submission type" : "提交类型"} className="grid gap-2 sm:grid-cols-3">
        <TypeTab
          active={form.kind === "product"}
          onClick={() => setKind("product")}
          icon={<Package className="h-4 w-4" aria-hidden="true" />}
          title={en ? "Submit a product" : "提交产品"}
          desc={en ? "Sites, SaaS, AI tools…" : "网站、SaaS、AI 工具等"}
        />
        <TypeTab
          active={form.kind === "tool" && form.toolType === "external"}
          onClick={() => {
            setKind("tool");
            setToolType("external");
          }}
          icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
          title={en ? "Submit a tool (external)" : "提交工具（外链）"}
          desc={en ? "The tool runs on your own site" : "工具在你自己的网站运行"}
        />
        <TypeTab
          active={form.kind === "tool" && form.toolType === "hosted"}
          onClick={() => {
            setKind("tool");
            setToolType("hosted");
          }}
          icon={<FileCode2 className="h-4 w-4" aria-hidden="true" />}
          title={en ? "Hosted tool" : "托管工具"}
          desc={en ? "Upload HTML, runs in a sandbox here" : "上传 HTML，本站沙箱内运行"}
        />
      </div>

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        noValidate
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={form.kind === "product" ? (en ? "Product name" : "产品名称") : (en ? "Tool name" : "工具名称")}
            required
            error={errors.name}
            hint={en ? "Shown in lists and search" : "将展示在列表与搜索中"}
          >
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={form.kind === "product" ? (en ? "e.g. SolHub" : "例如：SolHub") : (en ? "e.g. Markdown editor" : "例如：Markdown 编辑器")}
              className="input"
              aria-required="true"
            />
          </Field>
          <Field
            label={needsUrl ? (form.kind === "product" ? (en ? "Product website URL" : "产品官网 URL") : (en ? "Tool URL" : "工具访问 URL")) : (en ? "Tool page URL" : "工具主页 URL")}
            required={needsUrl}
            error={errors.websiteUrl}
            hint={isHosted ? (en ? "Optional" : "可选") : (en ? "We will visit it during review" : "核验时会实际访问")}
          >
            <input
              type="url"
              value={form.websiteUrl}
              onChange={(e) => set("websiteUrl", e.target.value)}
              placeholder="https://example.com"
              className="input font-mono !text-[13px]"
              aria-required={needsUrl}
            />
          </Field>
        </div>

        {isHosted && (
          <div className="rounded-[3px] border border-dashed border-border-strong bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
            <p className="font-semibold text-foreground/80">{en ? "Attach your HTML file to the email" : "请将 HTML 文件作为附件添加到邮件"}</p>
            <p className="mt-1">
              {en
                ? "After filling the form and clicking submit, your email client opens. Attach the .html file (≤1MB, self-contained) and send it. We'll host it in a sandboxed iframe."
                : "填完表单点击提交后邮箱会自动打开，请将 .html 文件（≤1MB，自包含）作为附件加入邮件后发送。我们会在沙箱 iframe 中托管运行。"}
            </p>
          </div>
        )}

        <Field label={en ? "One-line description" : "一句话介绍"} required error={errors.shortDescription} hint={`${form.shortDescription.length}/200`}>
          <textarea
            value={form.shortDescription}
            onChange={(e) => set("shortDescription", e.target.value)}
            rows={2}
            placeholder={en
              ? "e.g. A free online JSON formatter that works offline in your browser."
              : "例如：一款免费的在线 JSON 格式化工具，纯浏览器本地运行，无需登录。"}
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <Field
          label={en ? "Detailed description" : "详细描述"}
          required
          error={errors.description}
          hint={`${form.description.length}/2000`}
        >
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={5}
            placeholder={en
              ? "Suggested structure:\n1. What it is — one sentence on the product\n2. Who it's for and what problem it solves\n3. Highlights — what makes it different"
              : "建议按下面的结构写：\n1. 它是什么 —— 一句话说清产品定位\n2. 为谁解决什么问题 —— 目标用户与使用场景\n3. 有什么亮点 —— 与同类产品相比的差异点"}
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={en ? "Category" : "分类"} required>
            <select value={form.category} onChange={(e) => set("category", e.target.value)} className="input" aria-required="true">
              {productCategories.map((c) => (
                <option key={c.slug} value={c.slug}>{productCategoryNameLocalized(c.slug, c.name, locale)}</option>
              ))}
            </select>
          </Field>
          <Field label={en ? "Tags" : "标签"} required error={errors.tags} hint={en ? "comma-separated, max 8" : "用逗号分隔，最多 8 个"}>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="video, ai, free"
              className="input"
              aria-required="true"
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={en ? "Icon" : "图标"}
            error={errors.iconUrl}
            hint={en ? "Square, ≥128×128 PNG/JPG" : "建议正方形 ≥128×128，PNG/JPG"}
          >
            <div className="flex gap-2">
              <input
                type="url"
                value={form.iconUrl}
                onChange={(e) => set("iconUrl", e.target.value)}
                placeholder="https://example.com/icon.png"
                className="input font-mono !text-[13px] flex-1"
              />
              <label className="btn btn-outline shrink-0 cursor-pointer !h-9">
                <UploadCloud className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (reader.result) set("iconUrl", reader.result as string);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            </div>
          </Field>
          <Field label={en ? "Developer / team name" : "开发者 / 团队名称"} required error={errors.developerName}>
            <input
              type="text"
              value={form.developerName}
              onChange={(e) => set("developerName", e.target.value)}
              placeholder={en ? "Your name or team name" : "你的名字或团队名"}
              className="input"
              aria-required="true"
            />
          </Field>
        </div>

        <Field label={en ? "Contact" : "联系方式"} hint={en ? "For review contact only — never shown publicly" : "仅用于核验联系，不会公开显示"}>
          <input
            type="text"
            value={form.contact}
            onChange={(e) => set("contact", e.target.value)}
            placeholder={en ? "Email / WeChat / X handle" : "邮箱 / 微信 / X 账号"}
            className="input"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <button type="button" onClick={handlePreview} className="btn btn-outline !h-10 px-5">
            {en ? "Preview" : "预览"}
          </button>
          <button type="submit" disabled={status === "submitting"} className="btn btn-accent !h-10 px-6">
            {status === "submitting" ? (
              <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {me ? (en ? "Submitting…" : "提交中…") : (en ? "Opening email…" : "打开邮箱…")}</>
            ) : me ? (
              <>{en ? "Submit" : "提交产品"}</>
            ) : (
              <>{en ? "Submit via email" : "发送邮件提交"}</>
            )}
          </button>
        </div>
      </form>

      {/* 预览 */}
      {showPreview && Object.values(errors).every((v) => !v) && (
        <div className="card border-accent/30 p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            {en ? "Submission preview" : "提交预览"}
          </p>
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            <PreviewRow label={form.kind === "product" ? (en ? "Name" : "名称") : (en ? "Tool name" : "工具名")} value={form.name} />
            <PreviewRow label="URL" value={form.websiteUrl || (isHosted ? (en ? "(hosted here)" : "（本站托管）") : "")} />
            <PreviewRow label={en ? "Category" : "分类"} value={productCategoryNameLocalized(form.category, productCategories.find((c) => c.slug === form.category)?.name ?? form.category, locale)} />
            <PreviewRow label={en ? "Tags" : "标签"} value={form.tags} />
            <PreviewRow label={en ? "Developer" : "开发者"} value={form.developerName} />
            {isHosted && <PreviewRow label={en ? "Hosted file" : "托管文件"} value={hostedFile?.name ?? "—"} />}
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{en ? "One-line description" : "一句话介绍"}</dt>
              <dd className="mt-0.5 text-foreground">{form.shortDescription}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{en ? "Detailed description" : "详细描述"}</dt>
              <dd className="mt-0.5 whitespace-pre-line text-foreground">{form.description}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* 结果反馈 */}
      {status === "success" && result && (
        <div className="card border-success/30 bg-success/5 p-5">
          <p className="flex items-center gap-2 text-sm font-bold text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {en ? "Submission processed" : "提交已处理"}
          </p>
          <p className="mt-2 text-[13px] leading-6 text-foreground/75">{result.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.mode === "cloudbase" && (
              <>
                <a href={p("/launches/", locale)} className="btn btn-accent !h-8 px-3 text-xs">
                  {en ? "View community products" : "查看社区产品"} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                {me && (
                  <a href={p("/my-submissions/", locale)} className="btn btn-outline !h-8 px-3 text-xs">
                    {en ? "My account" : "前往个人中心"}
                  </a>
                )}
              </>
            )}
            {result.mode === "github-issue" && result.url && (
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn btn-accent !h-8 px-3 text-xs">
                {en ? "Complete submission on GitHub" : "在 GitHub 上完成提交"} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
            {result.mode !== "cloudbase" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const d = JSON.parse(draftJson);
                    const f = d.productFields || {};
                    const subject = `[SolHub 产品提交] ${f.name || ""}`;
                    const body = [
                      `产品名称：${f.name || ""}`,
                      `详细描述：${f.description || ""}`,
                      `官网 URL：${f.websiteUrl || ""}`,
                      `分类：${f.category || ""}`,
                      `标签：${Array.isArray(f.tags) ? f.tags.join(", ") : (f.tags || "")}`,
                      `开发者/团队：${f.developerName || ""}`,
                      `图标 URL：${f.iconUrl || ""}`,
                      `联系方式：${f.contact || ""}`,
                      ``,
                      `—— 由 SolHub 投稿表单生成`,
                    ].join("\n");
                    window.location.href = `mailto:soyoang@outlook.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                  }}
                  className="btn btn-outline !h-8 px-3 text-xs"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" /> {en ? "Send via email" : "通过邮件发送"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([draftJson], { type: "application/json;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `solhub-submission-${Date.now()}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                  className="btn btn-outline !h-8 px-3 text-xs"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> {en ? "Export JSON" : "导出 JSON"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(draftJson).catch(() => undefined);
                  }}
                  className="btn btn-ghost !h-8 px-3 text-xs"
                >
                  {en ? "Copy JSON" : "复制 JSON"}
                </button>
              </>
            )}
          </div>
          {result.mode === "local-draft" && (
            <p className="mt-3 text-xs text-muted-foreground">
              {en
                ? "The draft is saved only in this browser and will not appear on SolHub's public pages. Please export the JSON as a backup."
                : "草稿只保存在当前浏览器，不会出现在 SolHub 公共页面。请务必导出 JSON 备份。"}
            </p>
          )}
        </div>
      )}

      {status === "error" && result && (
        <Message tone="error">{result.message}</Message>
      )}
    </div>
  );
}

function TypeTab({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-[3px] border p-3.5 text-left transition-colors ${
        active
          ? "border-accent/50 bg-accent/5"
          : "border-border bg-card hover:border-border-strong"
      }`}
    >
      <span className={`flex items-center gap-2 text-sm font-bold ${active ? "text-accent" : "text-foreground"}`}>
        {icon}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </button>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label className="label !mb-0">
          {label}
          {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
        </label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && (
        <p className="mt-1.5 text-xs text-destructive" role="alert">{error}</p>
      )}
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all text-foreground">{value || "—"}</dd>
    </div>
  );
}
