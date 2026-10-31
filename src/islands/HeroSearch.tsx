import { useMemo, useRef, useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { getLocale } from "@/lib/utils";
import { getDict, translate } from "@/i18n";
import { searchIndex, buildSearchIndex, type SearchIndexEntry } from "@/lib/search";
import { p } from "@/lib/paths";
import { products } from "@/data/products";
import { tools } from "@/data/tools";

/** 首页 Hero 搜索条：直接输入出下拉结果 */
export default function HeroSearch() {
  const locale = getLocale();
  const dict = getDict(locale);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const index = useMemo(() => buildSearchIndex(products, tools, locale), [locale]);
  const results = query.trim() ? searchIndex(query, index, locale) : [];

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (r: SearchIndexEntry) => {
    window.location.href = r.kind === "tool" ? p(`/tools/${r.slug}/`, locale) : p(`/products/${r.slug}/`, locale);
  };

  return (
    <div ref={boxRef} className="relative mx-auto w-full max-w-xl">
      <div className="flex items-center gap-3 rounded-[10px] border border-border-strong bg-card px-4 py-3.5 shadow-md transition-all duration-200 focus-within:border-foreground/40 focus-within:shadow-lg">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && results[active]) go(results[active]);
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={locale === "en" ? "Search products & tools, e.g. “json”, “QR”, “SolYoung”…" : "搜索产品或工具，比如 “json”“二维码”“SolYoung”…"}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          aria-label={translate(dict, "nav.search")}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && query.trim() && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-[10px] border border-border bg-card shadow-xl">
          <ul className="max-h-80 overflow-y-auto py-1">
            {results.map((r, i) => (
              <li key={r.slug}>
                <button
                  type="button"
                  onClick={() => go(r)}
                  onMouseEnter={() => setActive(i)}
                  className={
                    "flex w-full items-center gap-2 px-4 py-2.5 text-left text-[14px] " +
                    (i === active ? "bg-secondary" : "")
                  }
                >
                  <span className={"h-2 w-2 shrink-0 rounded-full " + (r.kind === "tool" ? "bg-accent" : "bg-foreground/40")} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{r.name}</span>
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{r.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && query.trim() && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-[10px] border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground shadow-xl">
          {translate(dict, "search.emptyTitle", { q: query.trim() })}
        </div>
      )}
    </div>
  );
}
