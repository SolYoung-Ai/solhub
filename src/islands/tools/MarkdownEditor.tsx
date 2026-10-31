import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { countText } from "@/lib/tools/text";
import { CopyButton, DownloadButton, ResetButton } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t } from "@/i18n/data";

const SAMPLE = `# 你好，SolHub

这是一个 **Markdown 编辑器**，左侧编辑、右侧实时预览。

## 支持的内容

- 标题、列表、引用、代码块
- [链接](https://solyoung.top)
- 图片 \`![alt](url)\`
- \`行内代码\` 与表格

> 预览输出经过 HTML 净化，不会执行脚本。

\`\`\`js
console.log("Hello, SolHub");
\`\`\`
`;

export default function MarkdownEditor({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [text, setText] = useState(SAMPLE);

  const html = useMemo(() => {
    const raw = marked.parse(text) as string;
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button", "link", "meta"],
      FORBID_ATTR: ["onerror", "onclick", "onload", "style", "srcdoc"],
    });
  }, [text]);

  const stats = useMemo(() => countText(text), [text]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton getText={() => text} label={locale === "en" ? "Copy Markdown" : "复制 Markdown"} />
        <DownloadButton filename="document.md" getContent={() => text} mime="text/markdown;charset=utf-8" label={locale === "en" ? "Download .md" : "下载 .md"} />
        <ResetButton onClick={() => setText(SAMPLE)} label={locale === "en" ? "Load sample" : "载入示例"} />
        <span className="ml-auto text-xs text-muted-foreground">
          {stats.characters.toLocaleString()} {locale === "en" ? "chars" : "字符"} · {stats.words.toLocaleString()} {locale === "en" ? "words" : "词"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="label">{locale === "en" ? "Edit" : "编辑"}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={22}
            spellCheck={false}
            className="input scroll-x w-full resize-y font-mono !text-[13px] leading-6"
            aria-label={locale === "en" ? "Markdown editor" : "Markdown 编辑"}
          />
        </div>
        <div>
          <p className="label">{locale === "en" ? "Preview" : "预览"}</p>
          <div
            className="prose-solhub scroll-x min-h-[560px] w-full rounded-[8px] border border-border bg-card p-4"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>

      <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">{locale === "en" ? "Security note" : "安全说明"}</p>
        <p className="mt-1.5">
          {locale === "en" ? "Preview output is sanitized with DOMPurify: scripts, inline events and dangerous tags are removed, so untrusted HTML never executes. Everything runs locally." : "预览输出经过 DOMPurify 净化，脚本、内联事件与危险标签会被移除，不可信 HTML 不会在预览中执行。内容只在浏览器本地处理。"}
        </p>
      </div>
    </div>
  );
}
