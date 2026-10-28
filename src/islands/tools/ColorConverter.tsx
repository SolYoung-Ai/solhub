import { useState } from "react";
import { parseAny, hslString, rgbString, rgbCss } from "@/lib/tools/color";
import { CopyButton, ClearButton, Message, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t, localizeError } from "@/i18n/data";

type ParsedColor = Extract<ReturnType<typeof parseAny>, { ok: true }>;

export default function ColorConverter({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedColor | null>(null);

  const convert = () => {
    const r = parseAny(input);
    if (!r.ok) {
      setError(localizeError(locale, r.error));
      setParsed(null);
      return;
    }
    setError(null);
    setParsed(r);
  };

  const rows = parsed
    ? [
        { label: "HEX", value: parsed.hex },
        { label: "RGB", value: rgbString(parsed.rgb) },
        { label: "HSL", value: hslString(parsed.hsl) },
        { label: "CSS (rgb)", value: rgbCss(parsed.rgb) },
      ]
    : [];

  return (
    <div className="space-y-4">
      <ToolSection label={locale === "en" ? "Input color" : "输入颜色"} hint={locale === "en" ? "HEX, rgb(r,g,b), hsl(h,s%,l%) or color names" : "支持 HEX、rgb(r,g,b)、hsl(h,s%,l%) 与常见颜色名"}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            placeholder="#E87028 或 rgb(232, 112, 40) 或 orange"
            className="input font-mono !text-[13px]"
            aria-label={locale === "en" ? "Color input" : "颜色输入"}
            onKeyDown={(e) => {
              if (e.key === "Enter") convert();
            }}
          />
          <button type="button" onClick={convert} className="btn btn-accent shrink-0 !h-8 px-3 text-xs">
            {locale === "en" ? "Convert" : "转换"}
          </button>
          <ClearButton
            onClick={() => {
              setInput("");
              setParsed(null);
              setError(null);
            }}
            disabled={!input}
          />
        </div>
      </ToolSection>

      {error && <Message tone="error">{error}</Message>}

      {parsed && (
        <>
          <ToolSection label={t(locale, "tools.color-converter.previewLabel")}>
            <div
              className="h-24 w-full rounded-[3px] border border-border"
              style={{ backgroundColor: parsed.hex }}
              role="img"
              aria-label={`${locale === "en" ? "Color preview" : "颜色预览"} ${parsed.hex}`}
            />
          </ToolSection>

          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="card flex items-center justify-between gap-2 px-3 py-2.5">
                <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                <span className="scroll-x flex-1 truncate text-right font-mono text-[13px] text-foreground">
                  {row.value}
                </span>
                <CopyButton getText={() => row.value} label="" className="!h-7 !px-2" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
