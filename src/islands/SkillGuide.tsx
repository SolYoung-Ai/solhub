import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  Copy,
  HelpCircle,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { p } from "@/lib/paths";
import { copyText } from "@/lib/utils";
import type { Locale } from "@/i18n";

/**
 * Skill 库标题旁的「如何使用 Skill」小标签 + 使用教程弹窗。
 * 弹窗挂到 document.body（Portal），避免被侧栏 / 容器的 overflow 与
 * backdrop-filter 包含块裁掉。支持 /skills/?guide=1 直达。
 */
export default function SkillGuide({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  /* 关闭时清掉 ?guide=1，避免刷新后又自动弹出来 */
  const closeGuide = () => {
    setOpen(false);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("guide")) {
        url.searchParams.delete("guide");
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      /* history API 受限时只影响地址栏 */
    }
  };

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("guide") === "1") setOpen(true);
    } catch {
      /* 地址栏解析失败时保持关闭 */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeGuide();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const steps: {
    title: string;
    body: string;
    code?: string;
    note?: string;
  }[] = en
    ? [
        {
          title: "What a Skill actually is",
          body: "A Skill is a folder containing SKILL.md (instructions and trigger scenarios) plus optional scripts and reference files. It teaches an AI agent a repeatable workflow — it is not a web app, and nothing gets installed on SolHub.",
          note: "Works across Claude Code, Codex, Cursor, WorkBuddy and other agents that follow the open Agent Skills spec.",
        },
        {
          title: "Pick one and check compatibility",
          body: "Search or filter this page, read the one-line description, then check the “Works with” line and the install command on the card. Click through to skills.sh or GitHub for up-to-date numbers.",
        },
        {
          title: "Install it in your agent",
          body: "Most skills.sh entries install with one command. Run it in your project terminal; Claude Code plugins use the /plugin command instead.",
          code: "npx skills add vercel-labs/skills\n# or, for an official Claude Code plugin:\n/plugin install document-skills@anthropic-agent-skills",
          note: "Prefer manual install? Copy the skill folder into your agent's skills directory (e.g. ~/.claude/skills/ or .agents/skills/) and restart the session.",
        },
        {
          title: "Trigger it with plain language",
          body: "Describe the task and mention the skill; the agent loads the matching SKILL.md and follows its workflow. Some agents also support @skill-name.",
          code: "“Use frontend-design to rebuild this page with proper typography and spacing.”",
        },
        {
          title: "Write or submit your own",
          body: "Create a SKILL.md with name + description frontmatter, add scripts if needed, and test it. Then submit it to SolHub — after review it appears in this directory (never in the product list), and you can manage your submissions in My Account → Skills.",
        },
      ]
    : [
        {
          title: "Skill 到底是什么",
          body: "Skill 是一个含 SKILL.md（指令与触发场景）的文件夹，可附带脚本和参考资料，用来教会 AI Agent 按固定流程完成一类任务。它不是网站产品，也不会安装到 SolHub 上，而是装进你自己的 Agent。",
          note: "遵循开放的 Agent Skills 规范，可在 Claude Code、Codex、Cursor、WorkBuddy 等兼容平台间复用。",
        },
        {
          title: "挑一个，先看兼容性",
          body: "在本页搜索或按分类筛选，读一句话介绍，再看卡片上的「兼容」平台与安装命令；点击卡片可去 skills.sh / GitHub 查看最新安装量与 Star。",
        },
        {
          title: "装到你的 Agent 里",
          body: "skills.sh 上的条目大多一条命令即可安装，在项目终端执行；Claude Code 官方插件则用 /plugin 命令。",
          code: "npx skills add vercel-labs/skills\n# 官方插件则在 Claude Code 里执行：\n/plugin install document-skills@anthropic-agent-skills",
          note: "也可以手动安装：把 skill 文件夹放进对应平台的 skills 目录（如 ~/.claude/skills/ 或 .agents/skills/），然后重启会话。",
        },
        {
          title: "用自然语言触发",
          body: "描述任务时点名这个 Skill，Agent 会自动加载对应的 SKILL.md 并按流程执行；部分平台也支持 @技能名 直接调用。",
          code: "「用 frontend-design 帮我把这个页面重做一遍，注意排版和留白。」",
        },
        {
          title: "自己写一个 / 提交到本站",
          body: "写一个含 name、description frontmatter 的 SKILL.md，按需附脚本，本地跑通后即可提交。核验通过后会加入 Skill 库（不会进入产品列表），并可在「个人中心 → Skill」里管理自己提交的条目。",
        },
      ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={en ? "Open the Skill quick-start guide" : "打开 Skill 使用教程"}
        className="inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
      >
        <HelpCircle className="h-3 w-3" aria-hidden="true" />
        {en ? "How to use Skills" : "如何使用 Skill"}
        <span className="opacity-60">?</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60] animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="skill-guide-title">
          <div className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={closeGuide} aria-hidden="true" />
          <div className="animate-dialog-in absolute inset-x-0 top-0 mx-auto flex max-h-[88vh] w-[calc(100%-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-[14px] border border-border bg-card shadow-2xl sm:mt-[7vh]">
            {/* 头部 */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {en ? "Quick start" : "快速上手"}
                </p>
                <h2 id="skill-guide-title" className="mt-1 font-display text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
                  {en ? "How to use Agent Skills" : "如何使用 Skill"}
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {en
                    ? "From finding a skill to triggering it in your agent — about 3 minutes."
                    : "从找到、安装到触发，3 分钟搞懂 Skill 怎么用。"}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeGuide}
                aria-label={en ? "Close guide" : "关闭教程"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 步骤 */}
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <ol className="space-y-5">
                {steps.map((s, i) => (
                  <li key={s.title} className="flex min-w-0 gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold text-accent" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[13px] font-bold text-foreground">{s.title}</h3>
                      <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{s.body}</p>
                      {s.code && <CodeBlock text={s.code} en={en} />}
                      {s.note && (
                        <p className="mt-2 rounded-[8px] border border-border bg-secondary/40 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
                          {s.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-6 flex flex-wrap items-center gap-2 rounded-[10px] border border-accent/25 bg-accent/[0.06] px-4 py-3">
                <Terminal className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-[12px] leading-5 text-muted-foreground">
                  {en
                    ? "Only install skills from sources you trust — a SKILL.md can contain shell commands. SolHub reviews submissions, but always check the repo yourself before running anything."
                    : "只安装你信任来源的 Skill：SKILL.md 里可能包含 shell 命令。SolHub 会核验投稿，但运行前仍建议自己看一眼仓库。"}
                </p>
              </div>
            </div>

            {/* 底部入口 */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                <a href="https://skills.sh/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  skills.sh <ArrowUpRight className="h-3 w-3" />
                </a>
                <a href="https://github.com/anthropics/skills" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  Agent Skills spec <ArrowUpRight className="h-3 w-3" />
                </a>
                <a href={p("/my-submissions/?tab=skills", locale)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  {en ? "My Skills" : "我的 Skill"}
                </a>
              </div>
              <a href={p("/submit/?type=skill", locale)} className="btn btn-accent !h-8 gap-1.5 px-3 text-xs">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {en ? "Submit a Skill" : "提交 Skill"}
              </a>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CodeBlock({ text, en }: { text: string; en: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="mt-2 flex min-w-0 items-start gap-2 rounded-[8px] border border-border bg-secondary/50 px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground/80">{text}</pre>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={en ? "Copy command" : "复制命令"}
        title={en ? "Copy" : "复制"}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
