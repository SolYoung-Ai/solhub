import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Tool } from "@/data/types";
import { categories, categoryName } from "@/data/categories";
import { getIcon } from "@/lib/icons";
import { p } from "@/lib/paths";
import { cx, getLocale } from "@/lib/utils";
import { getDict, translate } from "@/i18n";
import type { Locale } from "@/i18n";
import { toolDescription } from "@/i18n/data";

interface Props {
  tools: Tool[];
  initialCategory: string;
  locale?: Locale;
}

export default function ToolsExplorer({ tools, initialCategory, locale = "zh" }: Props) {
  const dict = getDict(locale);
  const [category, setCategory] = useState(initialCategory);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let list = tools;
    if (category !== "all") {
      list = list.filter((t) => t.category === category);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          toolDescription(t.slug, t.description, locale).toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          t.keywords.some((k) => k.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [tools, category, query, locale]);

  return (
    <div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={cx(
              "rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors",
              category === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-foreground/70 hover:border-foreground/40",
            )}
          >
            {locale === "en" ? "All tools" : "全部工具"}
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => setCategory(c.slug)}
              className={cx(
                "rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors",
                category === c.slug
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground/70 hover:border-foreground/40",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={locale === "en" ? "Search tools by name, description or keyword…" : "搜索工具名称、说明或关键词…"}
            className="input !pl-8"
            aria-label={locale === "en" ? "Search tools" : "搜索工具"}
          />
        </div>
      </div>

      <div className="mt-6">
        {filtered.length === 0 && (
          <div className="card p-10 text-center">
            <p className="text-sm text-foreground/70">{locale === "en" ? "No tools match your search." : "没有找到符合条件的工具。"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{locale === "en" ? "Try different keywords or another category." : "试试其他关键词或分类。"}</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tool) => {
            const Icon = getIcon(tool.icon);
            return (
              <a
                key={tool.id}
                href={p(`/tools/${tool.slug}/`, locale)}
                className="card group flex h-full flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-border bg-secondary text-foreground/80 transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="badge border-success/30 bg-success/10 text-success">{translate(dict, "common.free")}</span>
                </div>
                <h3 className="font-display mt-3 text-[15px] font-bold text-foreground group-hover:text-accent">
                  {tool.name}
                </h3>
                <p className="mt-1 line-clamp-2 flex-1 text-[13px] leading-5 text-muted-foreground">
                  {toolDescription(tool.slug, tool.description, locale)}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-[11px] text-muted-foreground">{categoryName(tool.category)}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground/70 transition-all duration-150 group-hover:gap-2 group-hover:text-accent">
                    {locale === "en" ? "Open tool" : "打开工具"}
                    <span aria-hidden="true">→</span>
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {locale === "en"
          ? `${filtered.length} tools · all free, running locally in your browser`
          : `共 ${filtered.length} 个工具 · 全部免费，在浏览器本地运行`}
      </p>
    </div>
  );
}
