import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FileCode2,
  Loader2,
  Package,
  ShieldAlert,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { productCategories } from "@/data/product-categories";
import { skillCategories, skillCategoryName } from "@/data/skills";
import { productCategoryNameLocalized } from "@/i18n/data";
import { p } from "@/lib/paths";
import { base } from "@/lib/api-base";
import { isValidHttpUrl } from "@/lib/utils";
import { request } from "@/lib/net";
import { fetchMe, type AuthUser } from "@/lib/auth";
import { ownerKey, saveMySkill } from "@/lib/my-skills";
import { Message } from "@/components/tool-ui";
import type { Locale } from "@/i18n";

/**
 * 提交表单的三种互不冲突的类型：
 *   product  —— 网站 / SaaS / AI 工具，登录后走 /publish 自动收录到产品目录
 *   skill    —— Agent Skills（SKILL.md 技能包），走邮件人工核验，收录到 /skills/
 *   hosted   —— 自包含 HTML 工具，邮件附附件后托管到沙箱
 *
 * 旧版还有「提交工具（外链）」，它和「提交产品」填同样的字段、写同一份
 * community.json，本质上是重复入口，所以改成了语义与数据链路都独立的 Skill。
 * Skill 绝对不能走 /publish：那会把技能包当成产品写进产品目录。
 */
type SubmitKind = "product" | "skill" | "hosted";

const SKILL_PLATFORMS = [
  "通用（Agent Skills 标准）",
  "Claude Code",
  "Claude.ai / API",
  "Codex",
  "Cursor",
  "Gemini CLI",
  "WorkBuddy",
  "OpenCode",
  "飞书",
  "其他",
];

interface FormState {
  kind: SubmitKind;
  name: string;
  websiteUrl: string;
  installCommand: string;
  platform: string;
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
  name: "",
  websiteUrl: "",
  installCommand: "",
  platform: SKILL_PLATFORMS[0],
  shortDescription: "",
  description: "",
  category: "ai-tools",
  tags: "",
  iconUrl: "",
  developerName: "",
  contact: "",
};

const defaultCategory = (kind: SubmitKind) => (kind === "skill" ? "engineering" : "ai-tools");

type Errors = Partial<Record<keyof FormState, string>>;

interface SubmitResult {
  kind: SubmitKind;
  message: string;
  via: "publish" | "email";
}

export default function SubmitForm({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [showPreview, setShowPreview] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchMe().then(setMe);
    /* 静态站读不到 query，只能在 island 挂载后从地址栏取，
       让 /skills/ 的「提交 Skill」按钮直接落到 Skill 选项卡。 */
    try {
      const type = new URLSearchParams(window.location.search).get("type");
      if (type === "skill" || type === "hosted" || type === "product") {
        setForm((f) => ({ ...f, kind: type, category: defaultCategory(type) }));
      }
    } catch {
      /* 地址栏解析失败时保持默认选项卡 */
    }
  }, []);

  const isSkill = form.kind === "skill";
  const isHosted = form.kind === "hosted";
  const needsUrl = form.kind === "product" || isSkill;

  const categoryLabel = useMemo(() => {
    if (isSkill) return skillCategoryName(form.category, locale);
    const c = productCategories.find((x) => x.slug === form.category);
    return productCategoryNameLocalized(form.category, c?.name ?? form.category, locale);
  }, [form.category, isSkill, locale]);

  const set = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setStatus("idle");
  };

  const setKind = (kind: SubmitKind) => {
    setForm((f) => ({ ...f, kind, category: defaultCategory(kind) }));
    setErrors({});
    setStatus("idle");
    setShowPreview(false);
    setResult(null);
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!form.name.trim()) e.name = en ? "Please enter a name." : "请输入名称。";
    else if (form.name.trim().length > 80) e.name = en ? "Name must be under 80 characters." : "名称请控制在 80 字以内。";

    if (needsUrl) {
      if (!form.websiteUrl.trim()) {
        e.websiteUrl = isSkill
          ? en ? "Please enter the skill repo or homepage URL." : "请输入 Skill 仓库 / 主页 URL。"
          : en ? "Please enter the product website URL." : "请输入产品官网 URL。";
      } else if (!isValidHttpUrl(form.websiteUrl.trim())) {
        e.websiteUrl = en ? "URL must start with http:// or https://." : "URL 需以 http:// 或 https:// 开头。";
      }
    } else if (form.websiteUrl.trim() && !isValidHttpUrl(form.websiteUrl.trim())) {
      e.websiteUrl = en ? "URL must start with http:// or https://." : "URL 需以 http:// 或 https:// 开头。";
    }

    if (isSkill && form.installCommand.trim().length > 200) {
      e.installCommand = en ? "Install command must be under 200 characters." : "安装命令请控制在 200 字以内。";
    }
    if (!form.shortDescription.trim()) e.shortDescription = en ? "Please enter a one-line description." : "请输入一句话介绍。";
    else if (form.shortDescription.trim().length > 200) e.shortDescription = en ? "One-line description must be under 200 characters." : "一句话介绍请控制在 200 字以内。";
    if (!form.description.trim()) e.description = en ? "Please enter a detailed description." : "请输入详细描述。";
    else if (form.description.trim().length > 2000) e.description = en ? "Detailed description must be under 2000 characters." : "详细描述请控制在 2000 字以内。";

    const tagCount = form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).length;
    if (tagCount === 0) e.tags = en ? "Add at least one tag (comma-separated)." : "至少填写一个标签（用逗号分隔）。";
    else if (tagCount > 8) e.tags = en ? "At most 8 tags." : "标签最多 8 个。";
    if (form.iconUrl.trim() && !isValidHttpUrl(form.iconUrl.trim()) && !form.iconUrl.startsWith("data:")) {
      e.iconUrl = en ? "Icon URL must start with http:// or https://." : "图标 URL 需以 http:// 或 https:// 开头。";
    }
    if (!form.developerName.trim()) e.developerName = en ? "Please enter the author or team name." : "请输入作者 / 团队名称。";
    else if (form.developerName.trim().length > 80) e.developerName = en ? "Name must be under 80 characters." : "名称请控制在 80 字以内。";
    return e;
  };

  const handlePreview = () => {
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setShowPreview(true);
  };

  /** Skill / 托管工具走邮件核验；只有产品能一键自动收录。 */
  const buildEmail = () => {
    const kindLabel = isSkill ? "Skill" : isHosted ? (en ? "Hosted Tool" : "托管工具") : (en ? "Product" : "产品");
    const subject = `[SolHub ${kindLabel} ${en ? "Submission" : "提交"}] ${form.name.trim()}`;
    const hasUploadedIcon = form.iconUrl.trim().startsWith("data:");
    const lines = [
      `${en ? "Submission type" : "提交类型"}：${kindLabel}`,
      `${isSkill ? (en ? "Skill name" : "Skill 名称") : isHosted ? (en ? "Tool name" : "工具名称") : (en ? "Product name" : "产品名称")}：${form.name.trim()}`,
      `${isSkill ? (en ? "Repo / homepage URL" : "Skill 仓库 / 主页 URL") : isHosted ? (en ? "Tool homepage URL" : "工具主页 URL") : (en ? "Website URL" : "官网 URL")}：${form.websiteUrl.trim()}`,
      isSkill && form.installCommand.trim() ? `${en ? "Install command" : "安装命令"}：${form.installCommand.trim()}` : "",
      isSkill ? `${en ? "Compatible agents" : "兼容平台"}：${form.platform}` : "",
      `${en ? "One-line description" : "一句话介绍"}：${form.shortDescription.trim()}`,
      `${isSkill ? (en ? "Trigger scenarios & details" : "触发场景与详细说明") : (en ? "Detailed description" : "详细描述")}：${form.description.trim()}`,
      `${en ? "Category" : "分类"}：${categoryLabel}`,
      `${en ? "Tags" : "标签"}：${form.tags.trim()}`,
      form.iconUrl.trim() && !hasUploadedIcon ? `${en ? "Icon URL" : "图标 URL"}：${form.iconUrl.trim()}` : "",
      `${isSkill ? (en ? "Author / team" : "作者 / 团队") : (en ? "Developer / team" : "开发者 / 团队")}：${form.developerName.trim()}`,
      form.contact.trim() ? `${en ? "Contact" : "联系方式"}：${form.contact.trim()}` : "",
      me ? `${en ? "Submitted by" : "提交账号"}：${me.displayName || me.login}` : "",
      hasUploadedIcon ? `\n${en ? "(Please attach the icon image to this email)" : "（请将图标图片文件作为附件添加到本邮件）"}` : "",
      isHosted ? `\n${en ? "(Please attach the self-contained .html file to this email)" : "（请将自包含 .html 文件作为附件添加到本邮件）"}` : "",
    ].filter(Boolean);
    const mailto = `mailto:soyoang@outlook.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
    return mailto;
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;

    /* 产品 + 已登录：自动收录到产品目录（链接可达性由后端检测） */
    if (form.kind === "product" && me) {
      setStatus("submitting");
      try {
        const res = await request(`${base()}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            shortDescription: form.shortDescription.trim(),
            description: form.description.trim(),
            websiteUrl: form.websiteUrl.trim(),
            category: form.category,
            tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
            iconUrl: form.iconUrl.trim() || undefined,
            developerName: form.developerName.trim(),
          }),
        }, { retries: 0 });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setResult({ kind: "product", via: "publish", message: data.error || `提交失败（${res.status}）` });
          return;
        }
        setStatus("success");
        setResult({
          kind: "product",
          via: "publish",
          message: data.verifiedGranted
            ? (en
              ? "Published! Your product is live, and your verified badge has been lit automatically — check it on your profile."
              : "发布成功！产品已收录上线，你的认证徽章也已自动点亮——去个人主页看看吧。")
            : (en
              ? "Published! Your product is live on the community list (site rebuilds within ~2 minutes). Manage it anytime in My Account."
              : "发布成功！产品已自动收录上线（网站约 2 分钟内刷新展示）。可以在「个人中心」随时编辑或删除。"),
        });
        return;
      } catch {
        setStatus("error");
        setResult({ kind: "product", via: "publish", message: en ? "Network error. Please retry." : "网络错误，请稍后重试。" });
        return;
      }
    }

    /* Skill 提交：邮件人工核验之外，本地留一份记录，让用户能在「个人中心 → Skill」
       里查看、修改、删除或标记收录状态（Skill 不走 /publish，没有服务端记录）。 */
    if (isSkill) {
      saveMySkill(
        {
          name: form.name.trim(),
          repoUrl: form.websiteUrl.trim(),
          installCommand: form.installCommand.trim(),
          platform: form.platform,
          shortDescription: form.shortDescription.trim(),
          description: form.description.trim(),
          category: form.category,
          tags: form.tags.trim(),
          author: form.developerName.trim(),
          contact: form.contact.trim(),
        },
        ownerKey(me),
      );
    }

    /* Skill / 托管工具 / 未登录产品：邮件提交，人工核验后收录 */
    window.location.href = buildEmail();
    setStatus("success");
    setResult({
      kind: form.kind,
      via: "email",
      message: isSkill
        ? en
          ? "Your email client is opening with all Skill details pre-filled. Send it and we'll review the repo, SKILL.md and installability — approved skills are added to the Skill directory within 24 hours. You can edit or delete this submission in My Account → Skills."
          : "正在打开邮箱，Skill 信息已自动填好。发送后我们会核验仓库、SKILL.md 与可安装性，通过后 24 小时内收录到 Skill 库（不会进入产品列表）。这份提交已保存到「个人中心 → Skill」，可随时编辑或删除。"
        : isHosted
          ? en
            ? "Your email client is opening. Attach the self-contained .html file and send it — we'll host it in a sandboxed iframe."
            : "正在打开邮箱，请把自包含 .html 文件作为附件加入邮件后发送，我们会在沙箱 iframe 中托管运行。"
          : en
            ? "Your email client is opening with all details pre-filled. Send it and we'll review within 24 hours."
            : "正在打开邮箱，发送邮件即完成提交，我们会在 24 小时内核验。",
    });
  };

  const modeNote = isSkill
    ? en
      ? "Skills are reviewed before listing: we check that the repo is public, SKILL.md is complete, the install command works and the license allows redistribution. Approved skills appear in the Skill directory — never in the product list."
      : "Skill 提交为人工核验收录：会核验仓库是否公开、SKILL.md 是否完整、安装命令是否可用、开源协议是否允许分发。通过后会加入 Skill 库，不会写进产品列表。"
    : form.kind === "product" && me
      ? en
        ? "Logged-in product submissions are checked automatically (the link must open) and go live immediately. Verify your email and your badge lights up automatically."
        : "登录状态提交：官网链接可以正常打开即可通过自动检测，产品立即收录上线，无需人工审核；已验证邮箱的账号提交产品后，认证徽章自动点亮。"
      : en
        ? "Fill the form and click submit — your email client opens with all info pre-filled. Send it and we'll review within 24 hours."
        : "填完表单点击提交，邮箱会自动打开并填好所有信息，发送即完成，我们会在 24 小时内核验。";

  return (
    <div className="space-y-6">
      {/* 登录引导（仅产品提交需要提示，Skill 走邮件通道） */}
      {!me && form.kind === "product" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-accent/30 bg-accent/5 p-4">
          <div className="text-[13px] leading-6">
            <p className="font-bold text-foreground">
              {en ? "Tip: log in to publish a product in one click" : "提示：登录后产品可以一键收录"}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {en
                ? "Logged-in product submissions skip the email step and are managed from My Account. Skill submissions are reviewed by email."
                : "登录后提交产品无需走邮件流程，直接收录到你的账号名下；Skill 提交仍走邮件核验。"}
            </p>
          </div>
          <a href={p("/login/?next=" + encodeURIComponent("/submit/"), locale)} className="btn btn-accent shrink-0 !h-9 px-4 text-xs">
            {en ? "Log in / Sign up" : "登录 / 注册"}
          </a>
        </div>
      )}

      {/* 提交后会发生什么 */}
      <div className="flex items-start gap-2.5 rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-semibold text-foreground/80">{en ? "What happens after you submit" : "提交后会发生什么"}</p>
          <p className="mt-1">{modeNote}</p>
          <p className="mt-1">
            {en
              ? "Anything violating laws, infringing others, or containing malicious instructions will be removed."
              : "违法违规、侵权或夹带恶意指令的内容会被下架。"}
          </p>
        </div>
      </div>

      {/* 收录标准：Skill 与产品口径不同 */}
      <div className="rounded-[8px] border border-border bg-card p-4">
        <p className="text-[13px] font-bold text-foreground">
          {isSkill ? (en ? "Skill listing criteria" : "Skill 收录标准") : en ? "Listing criteria" : "收录标准"}
        </p>
        <ul className="mt-2 grid gap-1.5 text-[13px] leading-6 text-muted-foreground sm:grid-cols-2">
          {(isSkill
            ? en
              ? [
                "Public repo or skills.sh page, accessible without login",
                "A complete SKILL.md with name, description and trigger scenarios",
                "Installable and runnable — not an empty placeholder",
                "Original or properly licensed, no malicious instructions",
              ]
              : [
                "仓库或 skills.sh 页面公开可访问，无需登录",
                "含完整 SKILL.md：名称、描述与触发场景清晰",
                "可安装、可实际运行，不是空壳或占位",
                "原创或遵循开源协议，不含恶意指令",
              ]
            : en
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
              ]).map((item) => (
            <li key={item} className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* 类型切换：产品 / Skill / 托管工具 */}
      <div role="tablist" aria-label={en ? "Submission type" : "提交类型"} className="grid gap-2 sm:grid-cols-3">
        <TypeTab
          active={form.kind === "product"}
          onClick={() => setKind("product")}
          icon={<Package className="h-4 w-4" aria-hidden="true" />}
          title={en ? "Submit a product" : "提交产品"}
          desc={en ? "Sites, SaaS, AI tools…" : "网站、SaaS、AI 工具等"}
        />
        <TypeTab
          active={isSkill}
          onClick={() => setKind("skill")}
          icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
          title={en ? "Submit a Skill" : "提交 Skill"}
          desc={en ? "Agent Skills, Claude Code skill packs" : "Agent Skills / Claude Code 技能包"}
        />
        <TypeTab
          active={isHosted}
          onClick={() => setKind("hosted")}
          icon={<FileCode2 className="h-4 w-4" aria-hidden="true" />}
          title={en ? "Hosted tool" : "托管工具"}
          desc={en ? "Upload HTML, runs in a sandbox here" : "上传 HTML，本站沙箱内运行"}
        />
      </div>

      {/* Skill 说明条 */}
      {isSkill && (
        <div className="flex items-start gap-2.5 rounded-[8px] border border-accent/25 bg-accent/5 p-4 text-[13px] leading-6 text-muted-foreground">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="font-semibold text-foreground/80">
              {en ? "What counts as a Skill" : "什么是 Skill"}
            </p>
            <p className="mt-1">
              {en
                ? "A Skill is a folder with a SKILL.md plus optional scripts and references that teaches an AI agent a repeatable task. Skills follow the open Agent Skills spec and work across Claude Code, Codex, Cursor and other compatible agents."
                : "Skill 是一个含 SKILL.md 的文件夹（可附带脚本与参考资料），用于教会 AI Agent 按固定流程完成某类任务。遵循开放的 Agent Skills 规范，可在 Claude Code、Codex、Cursor 等兼容平台间复用。"}
            </p>
            <a href={p("/skills/", locale)} className="mt-1 inline-flex items-center gap-1 font-medium text-accent hover:underline">
              {en ? "Browse the Skill directory" : "查看 Skill 库"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      )}

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
            label={isSkill ? (en ? "Skill name" : "Skill 名称") : form.kind === "product" ? (en ? "Product name" : "产品名称") : (en ? "Tool name" : "工具名称")}
            required
            error={errors.name}
            hint={en ? "Shown in lists and search" : "将展示在列表与搜索中"}
          >
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={isSkill ? (en ? "e.g. pdf, frontend-design, find-skills" : "例如：pdf、frontend-design、find-skills") : form.kind === "product" ? (en ? "e.g. SolHub" : "例如：SolHub") : (en ? "e.g. Markdown editor" : "例如：Markdown 编辑器")}
              className="input"
              aria-required="true"
            />
          </Field>
          <Field
            label={isSkill ? (en ? "Skill repo / homepage URL" : "Skill 仓库 / 主页 URL") : needsUrl ? (en ? "Product website URL" : "产品官网 URL") : (en ? "Tool homepage URL" : "工具主页 URL")}
            required={needsUrl}
            error={errors.websiteUrl}
            hint={isHosted ? (en ? "Optional" : "可选") : isSkill ? (en ? "GitHub repo or skills.sh page" : "GitHub 仓库或 skills.sh 页面") : (en ? "We will visit it during review" : "核验时会实际访问")}
          >
            <input
              type="url"
              value={form.websiteUrl}
              onChange={(e) => set("websiteUrl", e.target.value)}
              placeholder={isSkill ? "https://github.com/owner/repo" : "https://example.com"}
              className="input font-mono sm:!text-[13px]"
              aria-required={needsUrl}
            />
          </Field>
        </div>

        {isSkill && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={en ? "Install command" : "安装命令"}
              error={errors.installCommand}
              hint={en ? "One line, ready to copy" : "一行命令，方便直接安装"}
            >
              <input
                type="text"
                value={form.installCommand}
                onChange={(e) => set("installCommand", e.target.value)}
                placeholder="npx skills add owner/repo"
                className="input font-mono !text-[13px]"
              />
            </Field>
            <Field label={en ? "Compatible agents" : "兼容平台"} required>
              <select value={form.platform} onChange={(e) => set("platform", e.target.value)} className="input select" aria-required="true">
                {SKILL_PLATFORMS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>
        )}

        {isHosted && (
          <div className="rounded-[8px] border border-dashed border-border-strong bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
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
            placeholder={isSkill
              ? en ? "e.g. Teaches an agent to turn a codebase into an interactive architecture diagram." : "例如：让 Agent 把代码库变成可交互的架构图。"
              : en ? "e.g. A free online JSON formatter that works offline in your browser." : "例如：一款免费的在线 JSON 格式化工具，纯浏览器本地运行，无需登录。"}
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <Field
          label={isSkill ? (en ? "Trigger scenarios & details" : "触发场景 / 详细描述") : (en ? "Detailed description" : "详细描述")}
          required
          error={errors.description}
          hint={`${form.description.length}/2000`}
        >
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={5}
            placeholder={isSkill
              ? en
                ? "Suggested structure:\n1. What task it teaches, and when the agent should trigger it\n2. What's inside — SKILL.md, scripts, references, bundled assets\n3. Which agents / tools it supports, and an example prompt"
                : "建议按下面的结构写：\n1. 它教 Agent 完成什么任务、什么场景会触发\n2. 包含什么 —— SKILL.md、脚本、参考资料与附带资源\n3. 兼容哪些 Agent / 工具，附一条示例指令"
              : en
                ? "Suggested structure:\n1. What it is — one sentence on the product\n2. Who it's for and what problem it solves\n3. Highlights — what makes it different"
                : "建议按下面的结构写：\n1. 它是什么 —— 一句话说清产品定位\n2. 为谁解决什么问题 —— 目标用户与使用场景\n3. 有什么亮点 —— 与同类产品相比的差异点"}
            className="input resize-y"
            aria-required="true"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={en ? "Category" : "分类"} required>
            <select value={form.category} onChange={(e) => set("category", e.target.value)} className="input select" aria-required="true">
              {isSkill
                ? skillCategories.map((c) => (
                  <option key={c.slug} value={c.slug}>{en ? c.nameEn : c.name}</option>
                ))
                : productCategories.map((c) => (
                  <option key={c.slug} value={c.slug}>{productCategoryNameLocalized(c.slug, c.name, locale)}</option>
                ))}
            </select>
          </Field>
          <Field label={en ? "Tags" : "标签"} required error={errors.tags} hint={en ? "comma-separated, max 8" : "用逗号分隔，最多 8 个"}>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder={isSkill ? "agent-skills, pdf, official" : "video, ai, free"}
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
                  ref={fileInputRef}
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
          <Field label={isSkill ? (en ? "Author / team" : "作者 / 团队名称") : (en ? "Developer / team name" : "开发者 / 团队名称")} required error={errors.developerName}>
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
              <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {en ? "Submitting…" : "提交中…"}</>
            ) : form.kind === "product" && me ? (
              <>{en ? "Submit" : "提交产品"}</>
            ) : isSkill ? (
              <>{en ? "Submit Skill via email" : "提交 Skill"}</>
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
            <PreviewRow label={isSkill ? (en ? "Skill name" : "Skill 名称") : (en ? "Name" : "名称")} value={form.name} />
            <PreviewRow label={isSkill ? (en ? "Repo URL" : "仓库 URL") : "URL"} value={form.websiteUrl || (isHosted ? (en ? "(hosted here)" : "（本站托管）") : "")} />
            {isSkill && <PreviewRow label={en ? "Install command" : "安装命令"} value={form.installCommand || "—"} />}
            {isSkill && <PreviewRow label={en ? "Compatible agents" : "兼容平台"} value={form.platform} />}
            <PreviewRow label={en ? "Category" : "分类"} value={categoryLabel} />
            <PreviewRow label={en ? "Tags" : "标签"} value={form.tags} />
            <PreviewRow label={isSkill ? (en ? "Author" : "作者") : (en ? "Developer" : "开发者")} value={form.developerName} />
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{en ? "One-line description" : "一句话介绍"}</dt>
              <dd className="mt-0.5 text-foreground">{form.shortDescription}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">{isSkill ? (en ? "Trigger scenarios & details" : "触发场景 / 详细描述") : (en ? "Detailed description" : "详细描述")}</dt>
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
            {result.kind === "skill" ? (
              <a href={p("/skills/", locale)} className="btn btn-accent !h-8 px-3 text-xs">
                {en ? "Browse Skill directory" : "查看 Skill 库"} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <a href={p("/launches/", locale)} className="btn btn-accent !h-8 px-3 text-xs">
                {en ? "View community products" : "查看社区产品"} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
            {result.via === "publish" && me && (
              <a href={p("/my-submissions/", locale)} className="btn btn-outline !h-8 px-3 text-xs">
                {en ? "My account" : "前往个人中心"}
              </a>
            )}
          </div>
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
      className={`flex flex-col items-start gap-1 rounded-[8px] border p-3.5 text-left transition-colors ${
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
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label className="label !mb-0">
          {label}
          {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
        </label>
        {hint && <span className="shrink-0 text-[11px] text-muted-foreground">{hint}</span>}
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
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all text-foreground">{value || "—"}</dd>
    </div>
  );
}
