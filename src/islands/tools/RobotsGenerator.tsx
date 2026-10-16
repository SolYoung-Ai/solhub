import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { buildRobots, robotsDefaultRule, robotsExplanations, type RobotsRule } from "@/lib/tools/robots";
import { CopyButton, DownloadButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";

export default function RobotsGenerator() {
  const [rules, setRules] = useState<RobotsRule[]>([{ ...robotsDefaultRule }]);
  const [sitemap, setSitemap] = useState("");
  const [error, setError] = useState<string | null>(null);

  const output = buildRobots(rules.map((r) => ({ ...r, sitemapUrl: sitemap || undefined })));

  const updateRule = (index: number, patch: Partial<RobotsRule>) => {
    setRules((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setError(null);
  };

  const addRule = () => {
    setRules((list) => [...list, { userAgent: "*", allow: [], disallow: [], crawlDelay: undefined }]);
  };

  const removeRule = (index: number) => {
    setRules((list) => list.filter((_, i) => i !== index));
  };

  const resetDefault = () => {
    setRules([{ ...robotsDefaultRule }]);
    setSitemap("");
    setError(null);
  };

  const handleBuild = () => {
    const hasRule = rules.some((r) => r.allow.length > 0 || r.disallow.length > 0);
    if (!hasRule) {
      setError("至少需要一条 Allow 或 Disallow 规则。");
      return;
    }
    setError(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        {rules.map((rule, index) => (
          <div key={index} className="card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">规则 {index + 1}</p>
              {rules.length > 1 && (
                <button type="button" onClick={() => removeRule(index)} className="inline-flex h-6 items-center gap-1 text-xs text-muted-foreground hover:text-destructive" aria-label={`删除规则 ${index + 1}`}>
                  <Trash2 className="h-3 w-3" /> 删除
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`ua-${index}`}>User-agent</label>
                <input
                  id={`ua-${index}`}
                  type="text"
                  value={rule.userAgent}
                  onChange={(e) => updateRule(index, { userAgent: e.target.value })}
                  className="input font-mono !text-[13px]"
                  placeholder="*"
                />
              </div>
              <div>
                <label className="label" htmlFor={`delay-${index}`}>Crawl-delay（秒，可选）</label>
                <input
                  id={`delay-${index}`}
                  type="text"
                  value={rule.crawlDelay ?? ""}
                  onChange={(e) => updateRule(index, { crawlDelay: e.target.value })}
                  className="input font-mono !text-[13px]"
                  placeholder="1"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`allow-${index}`}>Allow（每行一条）</label>
                <textarea
                  id={`allow-${index}`}
                  value={rule.allow.join("\n")}
                  onChange={(e) => updateRule(index, { allow: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                  rows={3}
                  className="input scroll-x font-mono !text-[13px]"
                  placeholder={"/"}
                />
              </div>
              <div>
                <label className="label" htmlFor={`disallow-${index}`}>Disallow（每行一条）</label>
                <textarea
                  id={`disallow-${index}`}
                  value={rule.disallow.join("\n")}
                  onChange={(e) => updateRule(index, { disallow: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                  rows={3}
                  className="input scroll-x font-mono !text-[13px]"
                  placeholder={"/admin/"}
                />
              </div>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={addRule} className="btn btn-outline !h-8 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> 添加规则
          </button>
          <button type="button" onClick={resetDefault} className="btn btn-ghost !h-8 px-3 text-xs">
            恢复默认模板
          </button>
        </div>

        <ToolSection label="Sitemap URL" hint="可选，声明站点地图位置">
          <input
            type="url"
            value={sitemap}
            onChange={(e) => setSitemap(e.target.value)}
            placeholder="https://example.com/sitemap.xml"
            className="input font-mono !text-[13px]"
            aria-label="Sitemap URL"
          />
        </ToolSection>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleBuild} className="btn btn-accent !h-8 px-3 text-xs">
            生成 robots.txt
          </button>
          <CopyButton getText={() => output} />
          <DownloadButton filename="robots.txt" getContent={() => output} />
        </div>

        {error && <Message tone="error">{error}</Message>}
      </div>

      <div className="space-y-4">
        <ToolSection label="预览">
          <ResultBox>{output || "# 在左侧配置规则后生成 robots.txt"}</ResultBox>
        </ToolSection>
        <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
          <p className="font-semibold text-foreground/80">用途与限制</p>
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
            {robotsExplanations.map((e) => (
              <li key={e.title}>
                <strong className="text-foreground/70">{e.title}</strong>：{e.detail}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
