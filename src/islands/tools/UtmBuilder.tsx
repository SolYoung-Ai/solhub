import { useState } from "react";
import { buildUtmUrl } from "@/lib/tools/utm";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t, localizeError } from "@/i18n/data";

export default function UtmBuilder({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [baseUrl, setBaseUrl] = useState("");
  const [fields, setFields] = useState({
    source: "",
    medium: "",
    campaign: "",
    term: "",
    content: "",
  });
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setField = (key: keyof typeof fields, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  const build = () => {
    const r = buildUtmUrl(baseUrl, fields);
    if (r.ok) {
      setResult(r.url);
      setError(null);
    } else {
      setResult("");
      setError(localizeError(locale, r.error));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <ToolSection label={t(locale, "tools.utm-builder.targetLabel")} hint={locale === "en" ? "Required" : "必填"}>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://example.com/product"
            className="input font-mono !text-[13px]"
            aria-label={t(locale, "tools.utm-builder.targetLabel")}
          />
        </ToolSection>

        <div className="grid gap-4 sm:grid-cols-2">
          <ToolSection label="Source" hint={locale === "en" ? "Required · e.g. google" : "必填 · 流量来源，如 google"}>
            <input type="text" value={fields.source} onChange={(e) => setField("source", e.target.value)} placeholder="google" className="input" aria-label="Source" />
          </ToolSection>
          <ToolSection label="Medium" hint={locale === "en" ? "Required · e.g. cpc" : "必填 · 媒介，如 cpc"}>
            <input type="text" value={fields.medium} onChange={(e) => setField("medium", e.target.value)} placeholder="cpc" className="input" aria-label="Medium" />
          </ToolSection>
          <ToolSection label="Campaign" hint={locale === "en" ? "Required · campaign name" : "必填 · 活动名"}>
            <input type="text" value={fields.campaign} onChange={(e) => setField("campaign", e.target.value)} placeholder="summer-launch" className="input" aria-label="Campaign" />
          </ToolSection>
          <ToolSection label="Term" hint={locale === "en" ? "Optional · keyword" : "可选 · 关键词"}>
            <input type="text" value={fields.term} onChange={(e) => setField("term", e.target.value)} placeholder="best-tool" className="input" aria-label="Term" />
          </ToolSection>
          <ToolSection label="Content" hint={locale === "en" ? "Optional · distinguishes links" : "可选 · 区分同活动内链接"}>
            <input type="text" value={fields.content} onChange={(e) => setField("content", e.target.value)} placeholder="banner-a" className="input" aria-label="Content" />
          </ToolSection>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={build} className="btn btn-accent !h-8 px-3 text-xs">
            {locale === "en" ? "Build link" : "生成链接"}
          </button>
          <ClearButton
            onClick={() => {
              setBaseUrl("");
              setFields({ source: "", medium: "", campaign: "", term: "", content: "" });
              setResult("");
              setError(null);
            }}
            disabled={!baseUrl && !fields.source}
          />
          <CopyButton getText={() => result} disabled={!result} className="ml-auto" />
        </div>

        {error && <Message tone="error">{error}</Message>}
      </div>

      <div className="space-y-4">
        <ToolSection label={locale === "en" ? "Generated link" : "生成的链接"}>
          {result ? (
            <ResultBox>{result}</ResultBox>
          ) : (
            <div className="card p-6 text-center text-sm text-muted-foreground">
              {locale === "en" ? "Fill the fields on the left and click “Build link”." : "填写左侧字段后点击「生成链接」。"}
            </div>
          )}
        </ToolSection>
        <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
          <p className="font-semibold text-foreground/80">{locale === "en" ? "Notes" : "说明"}</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>{locale === "en" ? "Existing query params on the target URL are kept; UTM params are appended." : "目标网址已有的查询参数会完整保留，UTM 参数自动追加。"}</li>
            <li>{locale === "en" ? "The result works with Google Analytics and similar platforms." : "生成的链接便于在 Google Analytics 等平台统计活动来源。"}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
