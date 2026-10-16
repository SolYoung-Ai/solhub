import { useState } from "react";
import { Braces } from "lucide-react";
import { formatJson, minifyJson, parseJsonWithError } from "@/lib/tools/json";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t } from "@/i18n/data";

export default function JsonFormatter({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<string>("");

  const run = (mode: "format" | "minify") => {
    if (!input.trim()) {
      setError(t(locale, "tools.json-formatter.errEmpty"));
      setOutput("");
      setMeta("");
      return;
    }
    const result = mode === "format" ? formatJson(input) : minifyJson(input);
    if (!result.ok) {
      setError(
        t(locale, "tools.json-formatter.errParse", {
          line: result.error.line,
          col: result.error.column,
          msg: result.error.message,
        }),
      );
      setOutput("");
      setMeta("");
      return;
    }
    setError(null);
    setOutput(result.output);
    setMeta(
      t(locale, "tools.json-formatter.metaFormatted", {
        out: result.output.length,
        in: input.length,
      }),
    );
  };

  const handleValidate = () => {
    if (!input.trim()) {
      setError(t(locale, "tools.json-formatter.errEmpty"));
      return;
    }
    const result = parseJsonWithError(input);
    if (result.ok) {
      setError(null);
      setOutput("");
      setMeta(t(locale, "tools.json-formatter.metaValidated"));
    } else {
      setError(
        t(locale, "tools.json-formatter.errParse", {
          line: result.error.line,
          col: result.error.column,
          msg: result.error.message,
        }),
      );
      setOutput("");
      setMeta("");
    }
  };

  return (
    <div className="space-y-4">
      <ToolSection label={t(locale, "tools.json-formatter.inputLabel")} hint={t(locale, "tools.json-formatter.inputHint")}>
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          rows={10}
          spellCheck={false}
          placeholder={`{\n  "name": "SolHub",\n  "type": "product"\n}`}
          className="input scroll-x w-full resize-y font-mono !text-[13px] leading-6"
          aria-label={t(locale, "tools.json-formatter.inputAria")}
        />
      </ToolSection>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => run("format")} className="btn btn-accent !h-8 px-3 text-xs">
          <Braces className="h-3.5 w-3.5" aria-hidden="true" /> {t(locale, "tools.json-formatter.formatBtn")}
        </button>
        <button type="button" onClick={() => run("minify")} className="btn btn-outline !h-8 px-3 text-xs">
          {t(locale, "tools.json-formatter.minifyBtn")}
        </button>
        <button type="button" onClick={handleValidate} className="btn btn-outline !h-8 px-3 text-xs">
          {t(locale, "tools.json-formatter.validateBtn")}
        </button>
        <ClearButton onClick={() => { setInput(""); setOutput(""); setError(null); setMeta(""); }} disabled={!input} />
        <CopyButton getText={() => output} disabled={!output} className="ml-auto" />
      </div>

      {error && <Message tone="error">{error}</Message>}
      {meta && <Message tone="success">{meta}</Message>}

      {output && (
        <ToolSection label={t(locale, "tools.json-formatter.outputLabel")}>
          <ResultBox>{output}</ResultBox>
        </ToolSection>
      )}
    </div>
  );
}
