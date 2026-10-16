import { useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Download, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { productCategories } from "@/data/product-categories";
import { submissionConfig } from "@/data/site";
import {
  submitSubmission,
  exportSubmissionJson,
  buildIssueBody,
  type SubmissionMode,
} from "@/lib/submission";
import { isValidHttpUrl } from "@/lib/utils";
import { Message } from "@/components/tool-ui";
import type { Submission } from "@/data/types";

interface FormState {
  name: string;
  websiteUrl: string;
  shortDescription: string;
  description: string;
  category: string;
  tags: string;
  iconUrl: string;
  developerName: string;
  contact: string;
  launchBatch: string;
}

const initial: FormState = {
  name: "",
  websiteUrl: "",
  shortDescription: "",
  description: "",
  category: "ai-tools",
  tags: "",
  iconUrl: "",
  developerName: "",
  contact: "",
  launchBatch: "",
};

type Errors = Partial<Record<keyof FormState, string>>;

export default function SubmitForm() {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [result, setResult] = useState<{ mode: SubmissionMode; message: string; url?: string } | null>(null);
  const [draftJson, setDraftJson] = useState("");

  const set = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setStatus("idle");
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!form.name.trim()) e.name = "请输入产品名称。";
    else if (form.name.trim().length > 60) e.name = "产品名称请控制在 60 字以内。";
    if (!form.websiteUrl.trim()) e.websiteUrl = "请输入产品官网 URL。";
    else if (!isValidHttpUrl(form.websiteUrl.trim())) e.websiteUrl = "URL 需以 http:// 或 https:// 开头。";
    if (!form.shortDescription.trim()) e.shortDescription = "请输入一句话介绍。";
    else if (form.shortDescription.trim().length > 140) e.shortDescription = "一句话介绍请控制在 140 字以内。";
    if (!form.description.trim()) e.description = "请输入详细描述。";
    else if (form.description.trim().length > 1000) e.description = "详细描述请控制在 1000 字以内。";
    const tagCount = form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).length;
    if (tagCount === 0) e.tags = "至少填写一个标签（用逗号分隔）。";
    else if (tagCount > 8) e.tags = "标签最多 8 个。";
    if (form.iconUrl.trim() && !isValidHttpUrl(form.iconUrl.trim())) e.iconUrl = "图标 URL 需以 http:// 或 https:// 开头。";
    if (!form.developerName.trim()) e.developerName = "请输入开发者或团队名称。";
    return e;
  };

  const handlePreview = () => {
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setShowPreview(true);
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setStatus("submitting");
    const submission: Submission = {
      id: `sub-${Date.now().toString(36)}`,
      productFields: {
        name: form.name.trim(),
        websiteUrl: form.websiteUrl.trim(),
        shortDescription: form.shortDescription.trim(),
        description: form.description.trim(),
        category: form.category,
        tags: form.tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
        iconUrl: form.iconUrl.trim() || undefined,
        developerName: form.developerName.trim(),
        contact: form.contact.trim() || undefined,
        launchBatch: form.launchBatch.trim() || undefined,
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

  const modeNote =
    modes.githubRepo
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
            无论通过哪种方式提交，产品都会进入<strong>待核验（Pending）</strong>队列；
            核验通过前不会被标记为 Verified，也不会出现在精选榜单中。
          </p>
        </div>
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
          <Field label="产品名称" required error={errors.name}>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="例如：SolHub"
              className="input"
              aria-required="true"
            />
          </Field>
          <Field label="产品官网 URL" required error={errors.websiteUrl}>
            <input
              type="url"
              value={form.websiteUrl}
              onChange={(e) => set("websiteUrl", e.target.value)}
              placeholder="https://example.com"
              className="input font-mono !text-[13px]"
              aria-required="true"
            />
          </Field>
        </div>

        <Field label="一句话介绍" required error={errors.shortDescription} hint={`${form.shortDescription.length}/140`}>
          <textarea
            value={form.shortDescription}
            onChange={(e) => set("shortDescription", e.target.value)}
            rows={2}
            placeholder="用一句话说明这个产品解决什么问题。"
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <Field label="详细描述" required error={errors.description} hint={`${form.description.length}/1000`}>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={5}
            placeholder="详细介绍产品：它是什么、为谁解决什么问题、有什么特点。"
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="产品分类" required>
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

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="联系方式" hint="可选，便于核验时联系你">
            <input
              type="text"
              value={form.contact}
              onChange={(e) => set("contact", e.target.value)}
              placeholder="邮箱 / 微信 / X 账号"
              className="input"
            />
          </Field>
          <Field label="发布批次" hint="可选">
            <input
              type="text"
              value={form.launchBatch}
              onChange={(e) => set("launchBatch", e.target.value)}
              placeholder="例如：2026-W43 或 本周"
              className="input"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <button
            type="button"
            onClick={handlePreview}
            className="btn btn-outline !h-10 px-5"
          >
            预览提交内容
          </button>
          <button type="submit" disabled={status === "submitting"} className="btn btn-accent !h-10 px-6">
            {status === "submitting" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> 提交中…
              </>
            ) : (
              "提交产品"
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
            <PreviewRow label="名称" value={form.name} />
            <PreviewRow label="官网" value={form.websiteUrl} />
            <PreviewRow label="分类" value={productCategories.find((c) => c.slug === form.category)?.name ?? form.category} />
            <PreviewRow label="标签" value={form.tags} />
            <PreviewRow label="开发者" value={form.developerName} />
            <PreviewRow label="批次" value={form.launchBatch || "未指定"} />
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
            {result.mode === "github-issue" && result.url && (
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn btn-accent !h-8 px-3 text-xs">
                在 GitHub 上完成提交 <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
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
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(buildIssueBody(JSON.parse(draftJson))).catch(() => undefined);
              }}
              className="btn btn-ghost !h-8 px-3 text-xs"
            >
              复制投稿正文
            </button>
          </div>
          {result.mode === "local-draft" && (
            <p className="mt-3 text-xs text-muted-foreground">
              草稿已保存在当前浏览器（localStorage）。注意：它不会出现在 SolHub 公共页面，
              只有你自己能看到。请务必导出 JSON 备份。
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
