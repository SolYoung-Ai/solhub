import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  Copy,
  HelpCircle,
  Sparkles,
  X,
} from "lucide-react";
import { p } from "@/lib/paths";
import { copyText } from "@/lib/utils";
import type { Locale } from "@/i18n";

/**
 * Skill 库标题旁的「如何使用 Skill」小标签 + 使用教程弹窗。
 * 就三步：复制技能链接 → 一句话发给任意 AI 助手 → 用的时候选中它。
 * 弹窗挂到 document.body（Portal），支持 /skills/?guide=1 直达。
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
        <div className="dialog-safe fixed inset-0 z-[60] flex animate-fade-in items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="skill-guide-title">
          <div className="absolute inset-0 glass-scrim" onClick={closeGuide} aria-hidden="true" />
          <div className="animate-dialog-in glass-sheet relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-[26px]">
            {/* 头部 */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {en ? "Quick start" : "快速上手"}
                </p>
                <h2 id="skill-guide-title" className="mt-1 font-display text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
                  {en ? "How to use a Skill" : "如何使用 Skill"}
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  {en
                    ? "Copy the skill link, send it to your AI assistant — that's it."
                    : "复制技能链接，发给你的 AI 助手，一句话就装好。"}
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
                <li className="flex min-w-0 gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold text-accent" aria-hidden="true">
                    1
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-bold text-foreground">{en ? "Copy the skill link" : "复制技能链接"}</h3>
                    <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                      {en
                        ? "Click “Copy install command” on any card above. Want more? Search the aggregators listed at the bottom of this page (“Sources & verification”) and copy the raw SKILL.md link."
                        : "在上面挑一个 Skill，点卡片上的「复制安装命令」。想找更多，拉到页面底部「数据来源与核验」里搜，复制 SKILL.md 的原始链接。"}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        closeGuide();
                        /* 先让弹窗卸载（body 的 overflow:hidden 会被 effect 清掉），再滚动 */
                        window.setTimeout(() => {
                          document.getElementById("sources")?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }, 60);
                      }}
                      className="mt-2 inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/[0.08] px-3 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-accent/15"
                    >
                      {en ? "Browse sources & search sites" : "去看数据来源与入口"}
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </li>

                <li className="flex min-w-0 gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold text-accent" aria-hidden="true">
                    2
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-bold text-foreground">{en ? "Send it to any AI agent" : "发给任意 AI 助手"}</h3>
                    <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                      {en
                        ? "Paste the link into WorkBuddy, Claude, Doubao, ChatGPT… — whatever you already use — with one sentence:"
                        : "把链接粘进你手上的任意助手——WorkBuddy、Claude、豆包、ChatGPT 都行——配一句话："}
                    </p>
                    <CodeBlock
                      en={en}
                      text={en
                        ? "Install this skill for me: <skill link>"
                        : "帮我安装这个技能：「skill链接」"}
                    />
                  </div>
                </li>

                <li className="flex min-w-0 gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold text-accent" aria-hidden="true">
                    3
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-bold text-foreground">{en ? "Select it when you use it" : "用的时候选上它"}</h3>
                    <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                      {en
                        ? "Start a new chat, pick the skill in the skill list (or @ its name), then just say what you need."
                        : "新开一个对话，在技能列表里选中刚装的技能（或 @技能名），然后正常说要做什么就行。"}
                    </p>
                  </div>
                </li>
              </ol>

              <p className="mt-6 rounded-[16px] border border-accent/25 bg-accent/[0.06] px-4 py-3 text-[12px] leading-5 text-muted-foreground">
                {en
                  ? "Only install skills from sources you trust — a SKILL.md can contain commands. SolHub verifies submissions, but have a quick look at the source before you use one."
                  : "只安装你信任来源的 Skill：SKILL.md 里可能藏着命令。SolHub 会核验投稿，用之前建议自己扫一眼原文。"}
              </p>
            </div>

            {/* 底部入口 */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                <a href="https://skills.sh/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  skills.sh <ArrowUpRight className="h-3 w-3" />
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

/** 可复制的句式，一键拷走直接粘进对话框 */
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
        aria-label={en ? "Copy" : "复制"}
        title={en ? "Copy" : "复制"}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
