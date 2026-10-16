import { useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { countText } from "@/lib/tools/text";
import { CopyButton, DownloadButton, ResetButton } from "@/components/tool-ui";

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

export default function MarkdownEditor() {
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
        <CopyButton getText={() => text} label="复制 Markdown" />
        <DownloadButton filename="document.md" getContent={() => text} mime="text/markdown;charset=utf-8" label="下载 .md" />
        <ResetButton onClick={() => setText(SAMPLE)} label="载入示例" />
        <span className="ml-auto text-xs text-muted-foreground">
          {stats.characters.toLocaleString()} 字符 · {stats.words.toLocaleString()} 词
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="label">编辑</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={22}
            spellCheck={false}
            className="input scroll-x w-full resize-y font-mono !text-[13px] leading-6"
            aria-label="Markdown 编辑"
          />
        </div>
        <div>
          <p className="label">预览</p>
          <div
            className="prose-solhub scroll-x min-h-[560px] w-full rounded-[3px] border border-border bg-card p-4"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>

      <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">安全说明</p>
        <p className="mt-1.5">
          预览输出经过 DOMPurify 净化，脚本、内联事件与危险标签会被移除，不可信 HTML
          不会在预览中执行。内容只在浏览器本地处理。
        </p>
      </div>
    </div>
  );
}
