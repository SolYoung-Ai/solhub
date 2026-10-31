import { useState } from "react";
import { buildJsonLd, type JsonLdInput, type JsonLdType } from "@/lib/tools/jsonld";
import { CopyButton, DownloadButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t, localizeError } from "@/i18n/data";

export default function JsonLdGenerator({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [type, setType] = useState<JsonLdType>("Organization");
  const [fields, setFields] = useState({
    name: "",
    url: "",
    description: "",
    logo: "",
    searchTemplate: "",
    applicationCategory: "",
    operatingSystem: "",
    offersPrice: "",
    offersCurrency: "CNY",
  });
  const [output, setOutput] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof fields, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  const generate = () => {
    const input: JsonLdInput = {
      type,
      name: fields.name,
      url: fields.url,
      description: fields.description,
      ...(fields.logo ? { logo: fields.logo } : {}),
      ...(fields.searchTemplate ? { searchTemplate: fields.searchTemplate } : {}),
      ...(fields.applicationCategory ? { applicationCategory: fields.applicationCategory } : {}),
      ...(fields.operatingSystem ? { operatingSystem: fields.operatingSystem } : {}),
      ...(fields.offersPrice ? { offersPrice: fields.offersPrice, offersCurrency: fields.offersCurrency } : {}),
    };
    const r = buildJsonLd(input);
    if (r.ok) {
      setOutput(r.output);
      setValidation(r.validation);
      setError(null);
    } else {
      setOutput("");
      setValidation([]);
      setError(localizeError(locale, r.error));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <ToolSection label={locale === "en" ? "Schema type" : "Schema 类型"}>
          <select value={type} onChange={(e) => setType(e.target.value as JsonLdType)} className="input" aria-label={locale === "en" ? "Schema type" : "Schema 类型"}>
            {(["Organization", "WebSite", "SoftwareApplication"] as JsonLdType[]).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </ToolSection>

        <div className="grid gap-4 sm:grid-cols-2">
          <ToolSection label={locale === "en" ? "Name" : "名称"} hint={locale === "en" ? "Required" : "必填"}>
            <input type="text" value={fields.name} onChange={(e) => set("name", e.target.value)} placeholder="SolHub" className="input" aria-label={locale === "en" ? "Name" : "名称"} />
          </ToolSection>
          <ToolSection label={locale === "en" ? "URL" : "网址"} hint={locale === "en" ? "Required" : "必填"}>
            <input type="url" value={fields.url} onChange={(e) => set("url", e.target.value)} placeholder="https://example.com" className="input font-mono !text-[13px]" aria-label={locale === "en" ? "URL" : "网址"} />
          </ToolSection>
        </div>

        <ToolSection label={locale === "en" ? "Description" : "描述"}>
          <textarea value={fields.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder={locale === "en" ? "One-line description" : "一句话描述"} className="input resize-y" aria-label={locale === "en" ? "Description" : "描述"} />
        </ToolSection>

        {type === "Organization" && (
          <ToolSection label="Logo URL" hint={locale === "en" ? "Optional" : "可选"}>
            <input type="url" value={fields.logo} onChange={(e) => set("logo", e.target.value)} placeholder="https://example.com/logo.png" className="input font-mono !text-[13px]" aria-label="Logo URL" />
          </ToolSection>
        )}

        {type === "WebSite" && (
          <ToolSection label={locale === "en" ? "Search action template" : "搜索动作模板"} hint={locale === "en" ? "Optional · must contain {search_term_string}" : "可选 · 需包含 {search_term_string}"}>
            <input type="text" value={fields.searchTemplate} onChange={(e) => set("searchTemplate", e.target.value)} placeholder="https://example.com/search?q={search_term_string}" className="input font-mono !text-[13px]" aria-label={locale === "en" ? "Search template" : "搜索模板"} />
          </ToolSection>
        )}

        {type === "SoftwareApplication" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <ToolSection label={locale === "en" ? "Application category" : "应用分类"} hint={locale === "en" ? "Optional" : "可选"}>
                <input type="text" value={fields.applicationCategory} onChange={(e) => set("applicationCategory", e.target.value)} placeholder="WebApplication" className="input" aria-label={locale === "en" ? "Application category" : "应用分类"} />
              </ToolSection>
              <ToolSection label={locale === "en" ? "Operating system" : "运行平台"} hint={locale === "en" ? "Optional" : "可选"}>
                <input type="text" value={fields.operatingSystem} onChange={(e) => set("operatingSystem", e.target.value)} placeholder="Web" className="input" aria-label={locale === "en" ? "Operating system" : "运行平台"} />
              </ToolSection>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ToolSection label={locale === "en" ? "Price" : "价格"} hint={locale === "en" ? "Optional, e.g. 0 / 99" : "可选，如 0 / 99"}>
                <input type="text" value={fields.offersPrice} onChange={(e) => set("offersPrice", e.target.value)} placeholder="0" className="input" aria-label={locale === "en" ? "Price" : "价格"} />
              </ToolSection>
              <ToolSection label={locale === "en" ? "Currency" : "货币"} hint={locale === "en" ? "default CNY" : "默认 CNY"}>
                <input type="text" value={fields.offersCurrency} onChange={(e) => set("offersCurrency", e.target.value)} placeholder="CNY" className="input" aria-label={locale === "en" ? "Currency" : "货币"} />
              </ToolSection>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={generate} className="btn btn-accent !h-8 px-3 text-xs">
            {locale === "en" ? "Generate JSON-LD" : "生成 JSON-LD"}
          </button>
          <CopyButton getText={() => output} disabled={!output} />
          <DownloadButton filename="schema.jsonld" getContent={() => output} mime="application/json;charset=utf-8" disabled={!output} label={locale === "en" ? "Download .jsonld" : "下载 .jsonld"} />
        </div>

        {error && <Message tone="error">{error}</Message>}
        {validation.map((v) => (
          <Message key={v} tone="info">{locale === "en" ? v : v}</Message>
        ))}
      </div>

      <div className="space-y-4">
        <ToolSection label={locale === "en" ? "Output" : "输出"}>
          {output ? (
            <ResultBox className="!max-h-[560px]">{output}</ResultBox>
          ) : (
            <div className="card p-6 text-center text-sm text-muted-foreground">
              {locale === "en" ? "Pick a type and fill the fields to generate JSON-LD." : "选择类型并填写字段后生成 JSON-LD。"}
            </div>
          )}
        </ToolSection>
        <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
          <p className="font-semibold text-foreground/80">{locale === "en" ? "Notes" : "说明"}</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>{locale === "en" ? "Structured data should only include information that truly exists on the page." : "结构化数据只能填写页面上真实存在的信息。"}</li>
            <li>{locale === "en" ? "Output is JSON-validated; actual indexing depends on the search engine — no ranking guarantee." : "生成结果会做 JSON 语法校验；实际收录效果取决于搜索引擎，不保证排名。"}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
