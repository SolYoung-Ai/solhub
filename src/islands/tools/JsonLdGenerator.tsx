import { useState } from "react";
import { buildJsonLd, type JsonLdInput, type JsonLdType } from "@/lib/tools/jsonld";
import { CopyButton, DownloadButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";

const TYPE_LABELS: Record<JsonLdType, string> = {
  Organization: "组织（Organization）",
  WebSite: "网站（WebSite）",
  SoftwareApplication: "软件应用（SoftwareApplication）",
};

export default function JsonLdGenerator() {
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
      setError(r.error);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <ToolSection label="Schema 类型">
          <select value={type} onChange={(e) => setType(e.target.value as JsonLdType)} className="input" aria-label="Schema 类型">
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </ToolSection>

        <div className="grid gap-4 sm:grid-cols-2">
          <ToolSection label="名称" hint="必填">
            <input type="text" value={fields.name} onChange={(e) => set("name", e.target.value)} placeholder="SolHub" className="input" aria-label="名称" />
          </ToolSection>
          <ToolSection label="网址" hint="必填">
            <input type="url" value={fields.url} onChange={(e) => set("url", e.target.value)} placeholder="https://example.com" className="input font-mono !text-[13px]" aria-label="网址" />
          </ToolSection>
        </div>

        <ToolSection label="描述">
          <textarea value={fields.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="一句话描述" className="input resize-y" aria-label="描述" />
        </ToolSection>

        {type === "Organization" && (
          <ToolSection label="Logo URL" hint="可选">
            <input type="url" value={fields.logo} onChange={(e) => set("logo", e.target.value)} placeholder="https://example.com/logo.png" className="input font-mono !text-[13px]" aria-label="Logo URL" />
          </ToolSection>
        )}

        {type === "WebSite" && (
          <ToolSection label="搜索动作模板" hint="可选 · 需包含 {search_term_string}">
            <input type="text" value={fields.searchTemplate} onChange={(e) => set("searchTemplate", e.target.value)} placeholder="https://example.com/search?q={search_term_string}" className="input font-mono !text-[13px]" aria-label="搜索模板" />
          </ToolSection>
        )}

        {type === "SoftwareApplication" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <ToolSection label="应用分类" hint="可选">
                <input type="text" value={fields.applicationCategory} onChange={(e) => set("applicationCategory", e.target.value)} placeholder="WebApplication" className="input" aria-label="应用分类" />
              </ToolSection>
              <ToolSection label="运行平台" hint="可选">
                <input type="text" value={fields.operatingSystem} onChange={(e) => set("operatingSystem", e.target.value)} placeholder="Web" className="input" aria-label="运行平台" />
              </ToolSection>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ToolSection label="价格" hint="可选，如 0 / 99">
                <input type="text" value={fields.offersPrice} onChange={(e) => set("offersPrice", e.target.value)} placeholder="0" className="input" aria-label="价格" />
              </ToolSection>
              <ToolSection label="货币" hint="默认 CNY">
                <input type="text" value={fields.offersCurrency} onChange={(e) => set("offersCurrency", e.target.value)} placeholder="CNY" className="input" aria-label="货币" />
              </ToolSection>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={generate} className="btn btn-accent !h-8 px-3 text-xs">
            生成 JSON-LD
          </button>
          <CopyButton getText={() => output} disabled={!output} />
          <DownloadButton filename="schema.jsonld" getContent={() => output} mime="application/json;charset=utf-8" disabled={!output} label="下载 .jsonld" />
        </div>

        {error && <Message tone="error">{error}</Message>}
        {validation.map((v) => (
          <Message key={v} tone="info">{v}</Message>
        ))}
      </div>

      <div className="space-y-4">
        <ToolSection label="输出">
          {output ? (
            <ResultBox className="!max-h-[560px]">{output}</ResultBox>
          ) : (
            <div className="card p-6 text-center text-sm text-muted-foreground">
              选择类型并填写字段后生成 JSON-LD。
            </div>
          )}
        </ToolSection>
        <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
          <p className="font-semibold text-foreground/80">说明</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>结构化数据只能填写页面上真实存在的信息。</li>
            <li>生成结果会做 JSON 语法校验；实际收录效果取决于搜索引擎，不保证排名。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
