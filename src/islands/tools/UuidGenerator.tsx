import { useState } from "react";
import { generateUuids } from "@/lib/tools/uuid";
import { CopyButton, ClearButton, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t } from "@/i18n/data";

export default function UuidGenerator({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>(() => generateUuids(5));

  const regenerate = () => {
    setUuids(generateUuids(count));
  };

  return (
    <div className="space-y-4">
      <ToolSection label={t(locale, "tools.uuid-generator.countLabel")} hint={t(locale, "tools.uuid-generator.countHint")}>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            className="input !w-28"
            aria-label={t(locale, "tools.uuid-generator.countLabel")}
          />
          <button type="button" onClick={regenerate} className="btn btn-accent !h-8 px-3 text-xs">
            {t(locale, "tools.uuid-generator.generateBtn")}
          </button>
          <ClearButton onClick={() => setUuids([])} disabled={uuids.length === 0} />
          <CopyButton
            getText={() => uuids.join("\n")}
            disabled={uuids.length === 0}
            className="ml-auto"
          />
        </div>
      </ToolSection>

      {uuids.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted-foreground">
          {locale === "en" ? "No UUIDs yet. Set a count and click “Generate”." : "还没有生成的 UUID。设置数量后点击「生成」。"}
        </div>
      ) : (
        <ToolSection label={locale === "en" ? "Result" : "结果"} hint={`${uuids.length} · UUID v4`}>
          <ResultBox>{uuids.join("\n")}</ResultBox>
        </ToolSection>
      )}

      <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">{locale === "en" ? "Notes" : "说明"}</p>
        <p className="mt-1.5">
          {locale === "en" ? (
            <>Generated with the browser's <code className="rounded-[6px] bg-secondary px-1 font-mono text-xs">crypto.randomUUID()</code> (Web Crypto API) — no network, no history.</>
          ) : (
            <>使用浏览器 <code className="rounded-[6px] bg-secondary px-1 font-mono text-xs">crypto.randomUUID()</code>{" "}
              （Web Crypto API）生成，无需联网，不记录任何历史。</>
          )}
        </p>
      </div>
    </div>
  );
}
