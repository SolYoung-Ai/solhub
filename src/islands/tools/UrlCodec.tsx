import { useState } from "react";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { urlEncode, urlDecode } from "@/lib/tools/url";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t, localizeError } from "@/i18n/data";

export default function UrlCodec({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"encode" | "decode">("encode");

  const run = () => {
    if (!input.trim()) {
      setError(t(locale, "tools.url-codec.errEmpty"));
      setOutput("");
      return;
    }
    if (mode === "encode") {
      setOutput(urlEncode(input));
      setError(null);
    } else {
      const result = urlDecode(input);
      if (result.ok) {
        setOutput(result.output);
        setError(null);
      } else {
        setError(localizeError(locale, result.error));
        setOutput("");
      }
    }
  };

  const switchMode = () => {
    setMode((m) => (m === "encode" ? "decode" : "encode"));
    setInput("");
    setOutput("");
    setError(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="badge border-border-strong bg-secondary text-foreground">
          {mode === "encode" ? t(locale, "tools.url-codec.encodeBtn") : t(locale, "tools.url-codec.decodeBtn")}
        </span>
        <button type="button" onClick={switchMode} className="btn btn-ghost !h-7 px-2 text-xs">
          {mode === "encode" ? (
            <>
              {locale === "en" ? "Switch to decode" : "切换为解码"} <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </>
          ) : (
            <>
              {locale === "en" ? "Switch to encode" : "切换为编码"} <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            </>
          )}
        </button>
      </div>

      <ToolSection label={mode === "encode" ? (locale === "en" ? "Plain text" : "原始文本") : (locale === "en" ? "Encoded content" : "编码内容")}>
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          rows={6}
          spellCheck={false}
          placeholder={mode === "encode" ? "例如：https://example.com/search?q=中文 与 特殊字符 &%#" : "例如：https%3A%2F%2Fexample.com%2Fsearch%3Fq%3D%E4%B8%AD%E6%96%87"}
          className="input scroll-x w-full resize-y font-mono !text-[13px] leading-6"
          aria-label={t(locale, "tools.url-codec.inputLabel")}
        />
      </ToolSection>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} className="btn btn-accent !h-8 px-3 text-xs">
          {mode === "encode" ? t(locale, "tools.url-codec.encodeBtn") : t(locale, "tools.url-codec.decodeBtn")}
        </button>
        <ClearButton onClick={() => { setInput(""); setOutput(""); setError(null); }} disabled={!input} />
        <CopyButton getText={() => output} disabled={!output} className="ml-auto" />
      </div>

      {error && <Message tone="error">{error}</Message>}

      {output && (
        <ToolSection label={t(locale, "tools.url-codec.outputLabel")}>
          <ResultBox>{output}</ResultBox>
        </ToolSection>
      )}
    </div>
  );
}
