import { useState } from "react";
import { calculateAspect, commonRatios } from "@/lib/tools/aspect";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t, localizeError } from "@/i18n/data";

export default function AspectRatioCalculator({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [ratio, setRatio] = useState("");
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const calc = () => {
    const r = calculateAspect({ width, height, ratio });
    if (r.ok) {
      setError(null);
      const res = r.result;
      setResult(
        [
          res.width !== null ? `${locale === "en" ? "Width" : "宽度"}：${res.width}px` : null,
          res.height !== null ? `${locale === "en" ? "Height" : "高度"}：${res.height}px` : null,
          `${locale === "en" ? "Ratio" : "比例"}：${res.ratio}`,
          `${locale === "en" ? "Orientation" : "方向"}：${res.isLandscape ? (locale === "en" ? "Landscape (W ≥ H)" : "横向（宽 ≥ 高）") : (locale === "en" ? "Portrait (H > W)" : "纵向（高 > 宽）")}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } else {
      setResult("");
      setError(localizeError(locale, r.error));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <ToolSection label={locale === "en" ? "Width (px)" : "宽度 (px)"} hint={locale === "en" ? "blank to derive" : "留空可推算"}>
            <input type="number" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="1920" className="input font-mono" aria-label={t(locale, "tools.aspect-ratio-calculator.widthLabel")} />
          </ToolSection>
          <ToolSection label={locale === "en" ? "Height (px)" : "高度 (px)"} hint={locale === "en" ? "blank to derive" : "留空可推算"}>
            <input type="number" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="1080" className="input font-mono" aria-label={t(locale, "tools.aspect-ratio-calculator.heightLabel")} />
          </ToolSection>
          <ToolSection label={t(locale, "tools.aspect-ratio-calculator.ratioLabel")} hint={locale === "en" ? "e.g. 16:9" : "如 16:9"}>
            <input type="text" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="16:9" className="input font-mono" aria-label={t(locale, "tools.aspect-ratio-calculator.ratioLabel")} />
          </ToolSection>
        </div>

        <ToolSection label={t(locale, "tools.aspect-ratio-calculator.presets")} hint={locale === "en" ? "click to fill" : "点击填入"}>
          <div className="flex flex-wrap gap-1.5">
            {commonRatios.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => {
                  setRatio(r.value);
                  setError(null);
                }}
                className="rounded-[2px] border border-border bg-card px-2 py-1 text-xs text-foreground/80 transition-colors hover:border-accent hover:text-accent"
                title={r.label}
              >
                {r.value}
              </button>
            ))}
          </div>
        </ToolSection>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={calc} className="btn btn-accent !h-8 px-3 text-xs">
            {locale === "en" ? "Calculate" : "计算"}
          </button>
          <ClearButton
            onClick={() => {
              setWidth("");
              setHeight("");
              setRatio("");
              setResult("");
              setError(null);
            }}
            disabled={!width && !height && !ratio}
          />
          <CopyButton getText={() => result} disabled={!result} className="ml-auto" />
        </div>

        {error && <Message tone="error">{error}</Message>}
      </div>

      <div className="space-y-4">
        <ToolSection label={locale === "en" ? "Result" : "结果"}>
          {result ? (
            <ResultBox>{result}</ResultBox>
          ) : (
            <div className="card p-6 text-center text-sm text-muted-foreground">
              {locale === "en" ? (
                <>Enter known width, height or ratio to derive the unknown. <br />e.g. width 1920, ratio 16:9 → height 1080.</>
              ) : (
                <>输入已知的宽、高或比例，计算未知尺寸。
                  <br />
                  例如：宽 1920、比例 16:9 → 高度 1080。</>
              )}
            </div>
          )}
        </ToolSection>
      </div>
    </div>
  );
}
