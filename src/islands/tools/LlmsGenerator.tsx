import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { buildLlms, type LlmsPage } from "@/lib/tools/llms";
import { CopyButton, DownloadButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";

export default function LlmsGenerator() {
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [intro, setIntro] = useState("");
  const [pages, setPages] = useState<LlmsPage[]>([
    { url: "", title: "", detail: "" },
    { url: "", title: "", detail: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState("");

  const updatePage = (index: number, patch: Partial<LlmsPage>) => {
    setPages((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const generate = () => {
    const r = buildLlms({ siteName, siteUrl, intro, pages });
    if (r.ok) {
      setOutput(r.output);
      setError(null);
    } else {
      setOutput("");
      setError(r.error);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <ToolSection label="网站名称" hint="必填">
            <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="SolHub" className="input" aria-label="网站名称" />
          </ToolSection>
          <ToolSection label="网站网址" hint="必填">
            <input type="url" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://example.com" className="input font-mono !text-[13px]" aria-label="网站网址" />
          </ToolSection>
        </div>

        <ToolSection label="简短介绍" hint="可选，写在文件头部">
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={3}
            placeholder="这是一个帮助独立开发者发现好产品的平台。"
            className="input resize-y !text-[14px] leading-6"
            aria-label="简短介绍"
          />
        </ToolSection>

        <ToolSection label="主要页面" hint="URL、标题必填，说明可选">
          <div className="space-y-2">
            {pages.map((page, index) => (
              <div key={index} className="card grid gap-2 p-3 sm:grid-cols-[1.2fr_1fr_1.2fr_auto]">
                <input
                  type="url"
                  value={page.url}
                  onChange={(e) => updatePage(index, { url: e.target.value })}
                  placeholder="/products/"
                  className="input font-mono !text-[12px]"
                  aria-label={`页面 ${index + 1} 网址`}
                />
                <input
                  type="text"
                  value={page.title}
                  onChange={(e) => updatePage(index, { title: e.target.value })}
                  placeholder="产品榜单"
                  className="input !text-[13px]"
                  aria-label={`页面 ${index + 1} 标题`}
                />
                <input
                  type="text"
                  value={page.detail ?? ""}
                  onChange={(e) => updatePage(index, { detail: e.target.value })}
                  placeholder="发现独立开发者正在创造的产品"
                  className="input !text-[13px]"
                  aria-label={`页面 ${index + 1} 说明`}
                />
                <button
                  type="button"
                  onClick={() => setPages((list) => list.filter((_, i) => i !== index))}
                  className="inline-flex h-8 w-8 items-center justify-center self-center rounded-[2px] text-muted-foreground hover:bg-secondary hover:text-destructive"
                  aria-label={`删除页面 ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setPages((list) => [...list, { url: "", title: "", detail: "" }])} className="btn btn-outline !h-8 px-3 text-xs">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> 添加页面
            </button>
          </div>
        </ToolSection>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={generate} className="btn btn-accent !h-8 px-3 text-xs">
            生成 llms.txt
          </button>
          <CopyButton getText={() => output} disabled={!output} />
          <DownloadButton filename="llms.txt" getContent={() => output} disabled={!output} />
        </div>

        {error && <Message tone="error">{error}</Message>}
      </div>

      <div className="space-y-4">
        <ToolSection label="预览">
          {output ? (
            <ResultBox>{output}</ResultBox>
          ) : (
            <div className="card p-6 text-center text-sm text-muted-foreground">
              填写左侧字段后生成 llms.txt。
            </div>
          )}
        </ToolSection>
        <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
          <p className="font-semibold text-foreground/80">说明</p>
          <p className="mt-1.5">
            llms.txt 是社区提出的格式，用于让 LLM 快速理解网站结构与内容。它并非搜索引擎标准，
            是否被采用取决于各 AI 产品。相对路径会自动基于网站网址补全。
          </p>
        </div>
      </div>
    </div>
  );
}
