import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  Copy,
  HelpCircle,
  MousePointer2,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { p } from "@/lib/paths";
import { copyText } from "@/lib/utils";
import type { Locale } from "@/i18n";

type Track = "easy" | "dev";
type Step = {
  title: string;
  body: string;
  code?: string;
  note?: string;
  example?: string;
  uploadMock?: boolean;
};

/**
 * Skill 库标题旁的「如何使用 Skill」小标签 + 使用教程弹窗。
 * 默认走「零基础 · 用豆包」路线：全程图形界面，不出现命令行；
 * 原来的命令行内容收进第二个 tab，供开发者按需切换。
 * 弹窗挂到 document.body（Portal），避免被侧栏 / 容器的 overflow 与
 * backdrop-filter 包含块裁掉。支持 /skills/?guide=1 直达。
 */
export default function SkillGuide({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState<Track>("easy");
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

  const easySteps: Step[] = en
    ? [
        {
          title: "A Skill is just an instruction sheet for AI",
          body: "Think “turn a PDF into a table” or “build a page that follows our design rules”. Give it to an AI assistant such as Doubao and it learns one repeatable way of doing that job. It is not an app, nothing is installed on SolHub — it is simply a text file the AI reads.",
          note: "One-line rule: a Skill tells the AI HOW to work. A connector (MCP) tells it WHERE to connect. They are different things.",
        },
        {
          title: "Pick one here and save the file",
          body: "Search this page (try pdf, ppt or frontend), then click “View SKILL.md” on the card. On GitHub, click Raw in the top-right corner so you see only the file itself, copy all its text, paste it into a plain-text editor, save it as SKILL.md, and put that file in its own folder — for example “PDF helper”.",
          note: "The filename must be exactly SKILL.md — not SKILL.md.txt and not skill.md. Keep the name/description block at the top, and don't copy any GitHub buttons or menu text into the file.",
        },
        {
          title: "Open Doubao and choose “Upload Skill”",
          body: "In Doubao’s skills page, find “Upload Skill”, then drag that folder into the dashed area or click “Select folder / Select file”. Once uploaded, it appears in your skill list.",
          uploadMock: true,
          note: "Doubao checks two things: the folder (or ZIP) contains SKILL.md, and that file has a YAML skill name and description. Everything indexed on SolHub already meets both.",
        },
        {
          title: "Just talk to it — no commands",
          body: "Say what you need in plain words and the assistant picks the right Skill. To be explicit, name it. If nothing happens, start a new chat and try again.",
          example: "“Extract the tables from this PDF into a spreadsheet.”",
        },
      ]
    : [
        {
          title: "Skill 就是给 AI 的一份「操作手册」",
          body: "比如「把 PDF 整理成表格」「按设计规范做网页」。把它交给豆包，豆包就学会了一种固定干活方式。它不是软件、不用安装，也不会改动 SolHub 网站——只是 AI 要读的一份说明文件。",
          note: "一句话记住：Skill 管「怎么干」，连接器（MCP）管「连到哪」。这两个不是一回事。",
        },
        {
          title: "在 SolHub 挑一个，把文件存到电脑",
          body: "在本页搜你要的功能（试试 pdf、ppt、前端），点卡片上的「查看 SKILL.md」打开原文。在 GitHub 页面点右上角的 Raw，只看文件本身；把里面的文字全部复制，粘到记事本里保存为 SKILL.md，再单独放进一个文件夹，例如「PDF 助手」。",
          note: "文件名必须正好是 SKILL.md（大小写一样），别存成 SKILL.md.txt 或 skill.md；开头那几行「名称 / 描述」必须保留，也别把网页上的按钮、菜单文字一起复制进去。",
        },
        {
          title: "打开豆包，点「上传技能」",
          body: "在豆包的技能页找到「上传技能」，把刚才那个文件夹拖进虚线框，或点「选择文件夹 / 选择文件」。上传成功后，它会出现在你的技能列表里。",
          uploadMock: true,
          note: "豆包会检查两件事：文件夹（或压缩包）里有 SKILL.md；SKILL.md 开头写了技能名称和描述。SolHub 收录的都满足，直接用就行。",
        },
        {
          title: "像聊天一样说句话，就能用",
          body: "不用记命令。直接说出你要做的事，豆包会自己判断该用哪个 Skill；想更准就点名「用 PDF 技能帮我……」。没反应的话，新开一个对话再试。",
          example: "「帮我把这份 PDF 里的表格整理成 Excel」",
        },
      ];

  const devSteps: Step[] = en
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

  const steps = track === "easy" ? easySteps : devSteps;

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
          <div className="absolute inset-0 glass-scrim" onClick={closeGuide} aria-hidden="true" />
          <div className="animate-dialog-in glass-sheet absolute inset-x-0 top-0 mx-auto flex max-h-[88vh] w-[calc(100%-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-[26px] sm:mt-[7vh]">
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
                    ? "No coding, no terminal. Follow along with Doubao and your AI learns a new trick in 3 minutes."
                    : "不用写代码、不用装软件，跟着点，3 分钟让豆包学会一个新本事。"}
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

            {/* 两条路线：默认零基础，命令行内容收进第二个 tab */}
            <div className="shrink-0 border-b border-border px-5 py-3 sm:px-6">
              <div role="tablist" aria-label={en ? "Choose a guide" : "选择教程路线"} className="inline-flex seg rounded-[14px] p-1">
                {([
                  { key: "easy" as const, zh: "零基础 · 用豆包", en: "Beginner · Doubao" },
                  { key: "dev" as const, zh: "开发者 · 命令行", en: "Developer · CLI" },
                ]).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={track === t.key}
                    onClick={() => setTrack(t.key)}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition-all duration-200",
                      track === t.key
                        ? "seg-thumb text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {t.key === "easy"
                      ? <MousePointer2 className="h-3 w-3" aria-hidden="true" />
                      : <Terminal className="h-3 w-3" aria-hidden="true" />}
                    {en ? t.en : t.zh}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {track === "easy"
                  ? en
                    ? "Mouse only — ideal if this is your first Skill. No commands anywhere below."
                    : "全程用鼠标，适合第一次接触 Skill。下面不会出现任何命令。"
                  : en
                    ? "Terminal required — for Claude Code, Cursor, Codex and similar agents."
                    : "需要终端，适合 Claude Code、Cursor、Codex 等开发工具。"}
              </p>
            </div>

            {/* 步骤 */}
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <ol className="space-y-5">
                {steps.map((s, i) => (
                  <li key={`${track}-${s.title}`} className="flex min-w-0 gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-bold text-accent" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[13px] font-bold text-foreground">{s.title}</h3>
                      <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{s.body}</p>
                      {s.code && <CodeBlock text={s.code} en={en} />}
                      {s.example && (
                        <div className="mt-2">
                          <p className="mb-1 text-[11px] text-muted-foreground">{en ? "You can just say:" : "你可以直接说："}</p>
                          <p className="inline-block max-w-full rounded-[16px] rounded-tl-[2px] border border-border bg-secondary/50 px-3 py-2 text-[12px] leading-5 text-foreground">
                            {s.example}
                          </p>
                        </div>
                      )}
                      {s.uploadMock && <UploadMock en={en} />}
                      {s.note && (
                        <p className="mt-2 rounded-[8px] border border-border bg-secondary/40 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
                          {s.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              {/* 零基础路线专属：把用户最容易走错的入口做成反例 */}
              {track === "easy" && (
                <div className="guide-wrong-border mt-6 rounded-[16px] border bg-secondary/30 px-4 py-3">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                    <X className="guide-wrong-text h-3.5 w-3.5" aria-hidden="true" />
                    {en ? "Don't get lost — 3 common mistakes" : "别走错入口 — 最容易踩的 3 个坑"}
                  </h3>
                  <ol className="mt-2 space-y-2 text-[12px] leading-5 text-muted-foreground">
                    <li>{en
                      ? "1. “New custom connector” (server name, URL, headers) is for MCP connectors that link external data — not for installing a Skill."
                      : "1.「新建自定义连接器」要填服务器名称、URL、Headers，那是接外部数据的 MCP 连接器，不是装 Skill 的地方。"}</li>
                    <li>{en
                      ? "2. Don't upload a whole GitHub repo ZIP: its root has no SKILL.md, so validation fails."
                      : "2. 别把整个 GitHub 仓库的 ZIP 传上去：根目录没有 SKILL.md，会校验失败。"}</li>
                    <li>{en
                      ? "3. Upload one folder containing one SKILL.md. The filename and its first lines must stay exactly as they are."
                      : "3. 只传「一个文件夹 + 里面的一个 SKILL.md」，文件名和开头那几行别改。"}</li>
                  </ol>
                  <ConnectorMock en={en} />
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-2 rounded-[16px] border border-accent/25 bg-accent/[0.06] px-4 py-3">
                <Terminal className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-[12px] leading-5 text-muted-foreground">
                  {track === "easy"
                    ? en
                      ? "Only upload skills from sources you trust — a SKILL.md can contain commands. SolHub verifies submissions, but have a quick look at the source before you use one."
                      : "只上传你信任来源的 Skill：SKILL.md 里可能藏着命令。SolHub 会核验投稿，用之前还是建议自己扫一眼原文。"
                    : en
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

/** 把豆包「上传技能」弹窗的关键文字做成清晰可复用的示意图，深浅主题都可读、随语言切换 */
function UploadMock({ en }: { en: boolean }) {
  return (
    <div className="mt-2 rounded-[16px] border border-border bg-secondary/30 p-3">
      <p className="mb-2 text-[11px] text-muted-foreground">
        {en ? "What you'll see in Doubao (illustration)" : "豆包里的界面长这样（示意）"}
      </p>
      <div className="rounded-[16px] border border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-foreground">{en ? "Upload Skill" : "上传技能"}</span>
          <span className="text-[14px] leading-none text-muted-foreground" aria-hidden="true">×</span>
        </div>
        <div className="mt-2 rounded-[8px] border border-dashed border-border px-3 py-4 text-center text-[12px] leading-5 text-muted-foreground">
          {en ? "Drag files here, or click " : "拖拽文件至此，或点击 "}
          <span className="text-accent">{en ? "Select folder / Select file" : "选择文件夹 / 选择文件"}</span>
        </div>
        <ul className="mt-2 space-y-0.5 text-[11px] leading-4 text-muted-foreground">
          <li>· {en ? "The ZIP or folder must contain a SKILL.md file" : "压缩包或文件夹需包含 SKILL.md 文件"}</li>
          <li>· {en ? "SKILL.md needs a YAML skill name and description" : "SKILL.md 需包含 YAML 格式的技能名称和描述"}</li>
        </ul>
      </div>
    </div>
  );
}

/** 反例：MCP 连接器弹窗，明确告诉用户「不是这里」 */
function ConnectorMock({ en }: { en: boolean }) {
  return (
    <div className="guide-wrong-border mt-3 rounded-[16px] border bg-card px-4 py-3">
      <p className="guide-wrong-text mb-2 flex items-center gap-1.5 text-[11px] font-medium">
        <X className="h-3 w-3" aria-hidden="true" />
        {en ? "Not this dialog" : "不是这个弹窗"}
      </p>
      <div className="opacity-75">
        <p className="text-[13px] font-bold text-foreground">{en ? "New custom connector" : "新建自定义连接器"}</p>
        <p className="text-[11px] text-muted-foreground">
          {en ? "Custom connectors only work on this computer" : "自定义连接器仅支持在本地电脑中使用"}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div className="min-w-0">
            <p className="text-foreground">{en ? "Server name *" : "服务器名称 *"}</p>
            <p className="mt-1 truncate rounded-[6px] border border-border px-2 py-1 text-muted-foreground">
              {en ? "Enter a name" : "请输入"}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-foreground">{en ? "Transport" : "传输类型"}</p>
            <p className="mt-1 truncate rounded-[6px] border border-border px-2 py-1 text-muted-foreground">HTTP</p>
          </div>
          <div className="col-span-2 min-w-0">
            <p className="text-foreground">{en ? "Server URL *" : "服务器 URL *"}</p>
            <p className="mt-1 truncate rounded-[6px] border border-border px-2 py-1 text-muted-foreground">
              https://mcp.example.com/mcp
            </p>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        {en
          ? "This is for MCP connectors (external services and data). To install a Skill, use “Upload Skill” above."
          : "这是接外部服务的 MCP 连接器；装 Skill 要找上面的「上传技能」入口。"}
      </p>
    </div>
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
