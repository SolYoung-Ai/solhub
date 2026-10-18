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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cloudbaseReady = useMemo(() => isCloudBaseConfigured(), []);
  const githubRepo = submissionConfig.githubIssueRepo ?? null;
  const modes = useMemo(() => {
    const remote = Boolean(submissionConfig.remoteEndpoint);
    return { remote, githubRepo: submissionConfig.githubIssueRepo ?? null };
  }, []);

  const WORKER = "https://solhub-auth.solyoungwork.workers.dev";
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authUser, setAuthUser] = useState<string>("");

  useEffect(() => {
    fetch(`${WORKER}/me`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (d.authenticated) { setAuthed(true); setAuthUser(d.user.login); } else setAuthed(false); })
      .catch(() => setAuthed(false));
  }, []);

  const handleAutoPublish = async () => {
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setStatus("submitting");
    try {
      const res = await fetch(`${WORKER}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          shortDescription: form.shortDescription.trim(),
          description: form.description.trim(),
          websiteUrl: form.websiteUrl.trim(),
          category: form.category,
          tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
          iconUrl: form.iconUrl.trim().startsWith("data:") ? "" : form.iconUrl.trim(),
          developerName: form.developerName.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("success");
        setResult({ mode: "cloudbase", message: en ? "网站检测通过，产品已自动收录！等待人工复核。" : "网站检测通过，产品已自动收录！等待人工复核。" });
      } else {
        setStatus("error");
        setResult({ mode: "cloudbase", message: data.error || "提交失败" });
      }
    } catch (err: any) {
      setStatus("error");
      setResult({ mode: "cloudbase", message: "网络错误，请稍后重试" });
    }
  };

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

  const handleSubmit = () => {
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;

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

  const modeNote = en
    ? "Fill the form and click submit — your email client opens with all info pre-filled. Send it and we'll review within 24 hours."
    : "填完表单点击提交，邮箱会自动打开并填好所有信息，发送即完成，我们会在 24 小时内核验。";

  return (
    <div className="space-y-6">
      {/* 提交方式说明 */}
      <div className="flex items-start gap-2.5 rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-semibold text-foreground/80">{en ? "What happens after you submit" : "提交后会发生什么"}</p>
          <p className="mt-1">{modeNote}</p>
          <p className="mt-1">
            {en
              ? "No GitHub account needed. We review within 24 hours and mark Verified."
              : "无需 GitHub 账号，提交后 24 小时内核验并标记 Verified。"}
          </p>
        </div>
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
            hint={isHosted ? (en ? "Optional" : "可选") : undefined}
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
            placeholder={en ? "One sentence on what problem it solves." : "用一句话说明它解决什么问题。"}
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <Field label={en ? "Detailed description" : "详细描述"} required error={errors.description} hint={`${form.description.length}/2000`}>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={5}
            placeholder={en ? "Details: what it is, who it helps, and what makes it special." : "详细介绍：它是什么、为谁解决什么问题、有什么特点。"}
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
          <Field label={en ? "Icon" : "图标"} error={errors.iconUrl} hint={en ? "Optional — upload or paste URL" : "可选 — 上传或粘贴 URL"}>
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

        <Field label={en ? "Contact" : "联系方式"} hint={en ? "Optional" : "可选"}>
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
            {en ? "Preview submission" : "预览提交内容"}
          </button>
          {authed === null ? (
            <button disabled className="btn btn-accent !h-10 px-6">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            </button>
          ) : authed ? (
            <button
              type="button"
              onClick={handleAutoPublish}
              disabled={status === "submitting"}
              className="btn btn-accent !h-10 px-6"
            >
              {status === "submitting" ? (
                <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {en ? "Checking & publishing…" : "检测网站并收录…"}</>
              ) : (
                <>{en ? "Auto-publish" : "一键自动收录"}</>
              )}
            </button>
          ) : (
            <a href={`${WORKER}/auth`} className="btn btn-accent !h-10 px-6">
              {en ? "Login with GitHub to submit" : "登录 GitHub 一键提交"}
            </a>
          )}
          {authed && (
            <button type="submit" className="btn btn-outline !h-10 px-4 text-sm">
              {en ? "Or send email" : "或用邮箱提交"}
            </button>
          )}
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
              <a href={p("/launches/", locale)} className="btn btn-accent !h-8 px-3 text-xs">
                {en ? "View community products" : "查看社区产品"} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
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
