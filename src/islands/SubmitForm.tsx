import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  Globe2,
  Loader2,
  Package,
  ShieldAlert,
  UploadCloud,
} from "lucide-react";
import { productCategories } from "@/data/product-categories";
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

export default function SubmitForm() {
  const [form, setForm] = useState<FormState>(initial);
  const [hostedFile, setHostedFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [result, setResult] = useState<{ mode: SubmissionMode; message: string; url?: string } | null>(null);
  const [draftJson, setDraftJson] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cloudbaseReady = useMemo(() => isCloudBaseConfigured(), []);

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
    if (!form.name.trim()) e.name = "请输入名称。";
    else if (form.name.trim().length > 80) e.name = "名称请控制在 80 字以内。";
    if (needsUrl) {
      if (!form.websiteUrl.trim()) e.websiteUrl = form.kind === "product" ? "请输入产品官网 URL。" : "请输入工具访问 URL。";
      else if (!isValidHttpUrl(form.websiteUrl.trim())) e.websiteUrl = "URL 需以 http:// 或 https:// 开头。";
    } else if (form.websiteUrl.trim() && !isValidHttpUrl(form.websiteUrl.trim())) {
      e.websiteUrl = "URL 需以 http:// 或 https:// 开头。";
    }
    if (!form.shortDescription.trim()) e.shortDescription = "请输入一句话介绍。";
    else if (form.shortDescription.trim().length > 200) e.shortDescription = "一句话介绍请控制在 200 字以内。";
    if (!form.description.trim()) e.description = "请输入详细描述。";
    else if (form.description.trim().length > 2000) e.description = "详细描述请控制在 2000 字以内。";
    const tagCount = form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).length;
    if (tagCount === 0) e.tags = "至少填写一个标签（用逗号分隔）。";
    else if (tagCount > 8) e.tags = "标签最多 8 个。";
    if (form.iconUrl.trim() && !isValidHttpUrl(form.iconUrl.trim())) e.iconUrl = "图标 URL 需以 http:// 或 https:// 开头。";
    if (!form.developerName.trim()) e.developerName = "请输入开发者或团队名称。";
    else if (form.developerName.trim().length > 80) e.developerName = "开发者名称请控制在 80 字以内。";
    if (isHosted) {
      if (!hostedFile) e.hostedFile = "请选择要托管的 HTML 文件。";
      else if (hostedFile.size > 1 * 1024 * 1024) e.hostedFile = "HTML 文件不能超过 1MB。";
      else if (!/^text\/html|\.html$/i.test(hostedFile.type || hostedFile.name)) e.hostedFile = "仅支持 HTML 文件（自包含工具页面）。";
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
    setStatus("submitting");
    setShowPreview(false);

    let hostedKey: string | undefined;
    if (isHosted && hostedFile) {
      const up = await uploadHostedTool(hostedFile, form.name.trim());
      if (!up.ok || !up.key) {
        setStatus("error");
        setResult({ mode: "local-draft", message: up.message ?? "上传托管工具失败。" });
        return;
      }
      hostedKey = up.key;
    }

    const payload = buildPayload();
    if (hostedKey) payload.hosted_key = hostedKey;

    if (cloudbaseReady) {
      const r = await submitToCloudbase(payload);
      if (r.ok) {
        setStatus("success");
        setResult({
          mode: "cloudbase",
          message: `提交成功！「${payload.name}」已自动公开到 SolHub 社区列表。${
            isHosted ? "托管工具已部署，访问者可在本站沙箱内直接使用。" : "访问者现在就能看到它。"
          }`,
        });
        return;
      }
      // CloudBase 失败 → 回退本地草稿（不静默丢失）
      setStatus("error");
      setResult({ mode: "local-draft", message: `CloudBase 提交失败：${r.message}` });
      return;
    }

    // 未配置 CloudBase：沿用原存储适配层（github-issue → local-draft）
    const submission: Submission = {
      id: `sub-${Date.now().toString(36)}`,
      productFields: {
        name: form.name.trim(),
        websiteUrl: form.websiteUrl.trim(),
        shortDescription: form.shortDescription.trim(),
        description: form.description.trim(),
        category: form.category,
        tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        iconUrl: form.iconUrl.trim() || undefined,
        developerName: form.developerName.trim(),
        contact: form.contact.trim() || undefined,
      },
      status: "submitted",
      createdAt: new Date().toISOString(),
      submissionProvider: "local-draft",
    };
    const r = await submitSubmission(submission);
    setResult({ mode: r.mode, message: r.message, url: r.url });
    setDraftJson(exportSubmissionJson(submission));
    setStatus(r.ok ? "success" : "error");
  };

  const modes = useMemo(() => {
    const remote = Boolean(submissionConfig.remoteEndpoint);
    const githubRepo = submissionConfig.githubIssueRepo ?? null;
    return { remote, githubRepo };
  }, []);

  const modeNote = cloudbaseReady
    ? "已接入 CloudBase 实时数据库：提交通过后立即自动公开到 SolHub 社区列表，无需人工审核。托管工具以沙箱 iframe 隔离运行，无法访问主站数据。"
    : modes.githubRepo
      ? "已配置 GitHub 投稿仓库：提交时将生成预填 Issue 链接，由你自己在 GitHub 上完成提交。"
      : modes.remote
        ? "已配置远程提交接口：提交内容将通过该接口发送。"
        : "当前未配置远程接口或投稿仓库：提交内容将保存为本地草稿（仅存在于当前浏览器），并提供 JSON 导出。草稿不会自动公开给其他访问者。";

  return (
    <div className="space-y-6">
      {/* 提交方式说明 */}
      <div className="flex items-start gap-2.5 rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-semibold text-foreground/80">提交后会发生什么</p>
          <p className="mt-1">{modeNote}</p>
          <p className="mt-1">
            提交内容会出现在 SolHub 社区列表（标注「社区提交」），不会伪造 Verified 核验状态；
            榜单精选位仍由人工核验后收录。
          </p>
        </div>
      </div>

      {/* 类型切换 */}
      <div role="tablist" aria-label="提交类型" className="grid gap-2 sm:grid-cols-3">
        <TypeTab
          active={form.kind === "product"}
          onClick={() => setKind("product")}
          icon={<Package className="h-4 w-4" aria-hidden="true" />}
          title="提交产品"
          desc="网站、SaaS、AI 工具等"
        />
        <TypeTab
          active={form.kind === "tool" && form.toolType === "external"}
          onClick={() => {
            setKind("tool");
            setToolType("external");
          }}
          icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
          title="提交工具（外链）"
          desc="工具在你自己的网站运行"
        />
        <TypeTab
          active={form.kind === "tool" && form.toolType === "hosted"}
          onClick={() => {
            setKind("tool");
            setToolType("hosted");
          }}
          icon={<FileCode2 className="h-4 w-4" aria-hidden="true" />}
          title="托管工具"
          desc="上传 HTML，本站沙箱内运行"
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
            label={form.kind === "product" ? "产品名称" : "工具名称"}
            required
            error={errors.name}
          >
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={form.kind === "product" ? "例如：SolHub" : "例如：Markdown 编辑器"}
              className="input"
              aria-required="true"
            />
          </Field>
          <Field
            label={needsUrl ? (form.kind === "product" ? "产品官网 URL" : "工具访问 URL") : "工具主页 URL"}
            required={needsUrl}
            error={errors.websiteUrl}
            hint={isHosted ? "可选" : undefined}
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
          <Field label="工具 HTML 文件" required error={errors.hostedFile} hint="≤ 1MB，仅 HTML">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-outline !h-10 gap-2 px-4"
              >
                <UploadCloud className="h-4 w-4" aria-hidden="true" /> 选择文件
              </button>
              <span className="text-[13px] text-muted-foreground">
                {hostedFile ? hostedFile.name : "未选择文件"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                aria-label="选择 HTML 工具文件"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setHostedFile(f);
                  setErrors((er) => ({ ...er, hostedFile: undefined }));
                  setStatus("idle");
                }}
              />
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              托管工具在沙箱 iframe 中运行：脚本受限、无法访问主站数据或存储。请只上传自包含的
              HTML 工具（样式与逻辑写在同一个文件里，无需外部资源）。
            </p>
          </Field>
        )}

        <Field label="一句话介绍" required error={errors.shortDescription} hint={`${form.shortDescription.length}/200`}>
          <textarea
            value={form.shortDescription}
            onChange={(e) => set("shortDescription", e.target.value)}
            rows={2}
            placeholder="用一句话说明它解决什么问题。"
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <Field label="详细描述" required error={errors.description} hint={`${form.description.length}/2000`}>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={5}
            placeholder="详细介绍：它是什么、为谁解决什么问题、有什么特点。"
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="分类" required>
            <select value={form.category} onChange={(e) => set("category", e.target.value)} className="input" aria-required="true">
              {productCategories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="标签" required error={errors.tags} hint="用逗号分隔，最多 8 个">
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
          <Field label="图标 URL" error={errors.iconUrl} hint="可选">
            <input
              type="url"
              value={form.iconUrl}
              onChange={(e) => set("iconUrl", e.target.value)}
              placeholder="https://example.com/icon.png"
              className="input font-mono !text-[13px]"
            />
          </Field>
          <Field label="开发者 / 团队名称" required error={errors.developerName}>
            <input
              type="text"
              value={form.developerName}
              onChange={(e) => set("developerName", e.target.value)}
              placeholder="你的名字或团队名"
              className="input"
              aria-required="true"
            />
          </Field>
        </div>

        <Field label="联系方式" hint="可选">
          <input
            type="text"
            value={form.contact}
            onChange={(e) => set("contact", e.target.value)}
            placeholder="邮箱 / 微信 / X 账号"
            className="input"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <button type="button" onClick={handlePreview} className="btn btn-outline !h-10 px-5">
            预览提交内容
          </button>
          <button type="submit" disabled={status === "submitting"} className="btn btn-accent !h-10 px-6">
            {status === "submitting" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> 提交中…
              </>
            ) : form.kind === "product" ? (
              "提交产品"
            ) : isHosted ? (
              "上传并公开工具"
            ) : (
              "提交工具"
            )}
          </button>
        </div>
      </form>

      {/* 预览 */}
      {showPreview && Object.values(errors).every((v) => !v) && (
        <div className="card border-accent/30 p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            提交预览
          </p>
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            <PreviewRow label={form.kind === "product" ? "名称" : "工具名"} value={form.name} />
            <PreviewRow label="URL" value={form.websiteUrl || (isHosted ? "（本站托管）" : "")} />
            <PreviewRow label="分类" value={productCategories.find((c) => c.slug === form.category)?.name ?? form.category} />
            <PreviewRow label="标签" value={form.tags} />
            <PreviewRow label="开发者" value={form.developerName} />
            {isHosted && <PreviewRow label="托管文件" value={hostedFile?.name ?? "—"} />}
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">一句话介绍</dt>
              <dd className="mt-0.5 text-foreground">{form.shortDescription}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">详细描述</dt>
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
            提交已处理
          </p>
          <p className="mt-2 text-[13px] leading-6 text-foreground/75">{result.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.mode === "cloudbase" && (
              <a href={p("/launches/")} className="btn btn-accent !h-8 px-3 text-xs">
                查看社区产品 <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
            {result.mode === "github-issue" && result.url && (
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn btn-accent !h-8 px-3 text-xs">
                在 GitHub 上完成提交 <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
            {result.mode !== "cloudbase" && (
              <>
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
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> 导出 JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(draftJson).catch(() => undefined);
                  }}
                  className="btn btn-ghost !h-8 px-3 text-xs"
                >
                  复制 JSON
                </button>
              </>
            )}
          </div>
          {result.mode === "local-draft" && (
            <p className="mt-3 text-xs text-muted-foreground">
              草稿只保存在当前浏览器，不会出现在 SolHub 公共页面。请务必导出 JSON 备份。
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
