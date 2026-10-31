import { useState } from "react";
import { base64Encode, base64Decode } from "@/lib/tools/base64";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t, localizeError } from "@/i18n/data";

export default function Base64Codec({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"encode" | "decode">("encode");

  const run = () => {
    if (!input.trim()) {
      setError(t(locale, "tools.base64-codec.errEmpty"));
      setOutput("");
      return;
    }
    if (mode === "encode") {
      setOutput(base64Encode(input));
      setError(null);
    } else {
      const result = base64Decode(input);
      if (result.ok) {
        setOutput(result.output);
        setError(null);
      } else {
        setError(localizeError(locale, result.error));
        setOutput("");
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="badge border-border-strong bg-secondary text-foreground">
          {mode === "encode" ? "Encode (UTF-8)" : "Decode"}
        </span>
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "encode" ? "decode" : "encode"));
            setInput("");
            setOutput("");
            setError(null);
          }}
          className="btn btn-ghost !h-7 px-2 text-xs"
        >
          {locale === "en" ? "Switch" : "切换操作"}
        </button>
      </div>

      <ToolSection label={mode === "encode" ? (locale === "en" ? "Plain text (Chinese OK)" : "原始文本（支持中文）") : (locale === "en" ? "Base64 content" : "Base64 内容")}>
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          rows={6}
          spellCheck={false}
          placeholder={mode === "encode" ? "例如：你好，SolHub！" : "例如：5L2g5aW977yMU29sSHVi77yB"}
          className="input scroll-x w-full resize-y font-mono !text-[13px] leading-6"
          aria-label={t(locale, "tools.base64-codec.inputLabel")}
        />
      </ToolSection>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} className="btn btn-accent !h-8 px-3 text-xs">
          {mode === "encode" ? t(locale, "tools.base64-codec.encodeBtn") : t(locale, "tools.base64-codec.decodeBtn")}
        </button>
        <ClearButton onClick={() => { setInput(""); setOutput(""); setError(null); }} disabled={!input} />
        <CopyButton getText={() => output} disabled={!output} className="ml-auto" />
      </div>

      {error && <Message tone="error">{error}</Message>}

      {output && (
        <ToolSection label={locale === "en" ? "Result" : "结果"}>
          <ResultBox>{output}</ResultBox>
        </ToolSection>
      )}

      <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">{locale === "en" ? "Notes" : "说明"}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>{locale === "en" ? "Text is UTF-8 encoded first, so Chinese, emoji etc. encode correctly." : "编码前先将文本转为 UTF-8 字节，因此中文、emoji 等都能正确编码。"}</li>
          <li>{locale === "en" ? "Decoding uses strict UTF-8 validation: binary data or bad encoding shows a clear error." : "解码时使用严格 UTF-8 校验：二进制数据或错误编码会给出明确错误提示。"}</li>
          <li>{locale === "en" ? "Everything runs locally in your browser." : "所有处理在浏览器本地完成。"}</li>
        </ul>
      </div>
    </div>
  );
}
