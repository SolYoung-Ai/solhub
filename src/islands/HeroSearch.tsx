import { useMemo, useRef, useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { getLocale } from "@/lib/utils";
import { getDict, translate } from "@/i18n";
import { searchIndex, buildSearchIndex, type SearchIndexEntry } from "@/lib/search";
import { p } from "@/lib/paths";
import { products } from "@/data/products";

/** 首页 Hero 搜索条：直接输入出下拉结果 */
export default function HeroSearch() {
  const locale = getLocale();
  const dict = getDict(locale);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /* 用户是否用方向键在下拉里挪动过：挪过 → Enter 进选中项；没挪过 → Enter 去榜单页看全部结果 */
  const [keyNav, setKeyNav] = useState(false);
  /* 窄屏放不下完整占位文案（会被硬截断成 “SolY”），单独给一版短的。
     用 effect 而非初始值，避免 SSR 与首帧水合不一致。 */
  const [narrow, setNarrow] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useMemo(() => buildSearchIndex(products, locale), [locale]);
  const results = query.trim() ? searchIndex(query, index, locale) : [];

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (r: SearchIndexEntry) => {
    window.location.href = p(`/products/${r.slug}/`, locale);
  };

  /* 提交搜索：统一去榜单页，带上关键词看完整列表（而不是替用户直接跳进某个产品）。
     榜单页的 LaunchesExplorer 会读 ?q= 把关键词填进搜索框并过滤。 */
  const submit = () => {
    const q = query.trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }
    window.location.href = `${p("/launches/", locale)}?q=${encodeURIComponent(q)}`;
  };

  return (
    <div ref={boxRef} className="relative mx-auto w-full max-w-xl">
      <div className="flex items-center gap-3 rounded-[10px] border border-border-strong bg-card px-4 py-3.5 shadow-md transition-all duration-200 focus-within:border-foreground/40 focus-within:shadow-lg">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); setKeyNav(false); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setKeyNav(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setKeyNav(true); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              /* 用方向键选过 → 进那一个；只是敲了词直接回车 → 去榜单页看全部结果 */
              if (keyNav && results[active]) go(results[active]);
              else submit();
            }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={
            locale === "en"
              ? narrow ? "Search products & tools…" : "Search products & tools, e.g. “json”, “QR”, “SolYoung”…"
              : narrow ? "搜索产品或工具…" : "搜索产品或工具，比如 “json”“二维码”“SolYoung”…"
          }
          /* 移动端 16px：iOS Safari 对小于 16px 的输入框会在聚焦时自动放大页面 */
          className="flex-1 bg-transparent text-[16px] text-foreground placeholder:text-muted-foreground focus:outline-none sm:text-sm"
          aria-label={translate(dict, "nav.search")}
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          className="shrink-0 rounded-[7px] bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90"
          aria-label={locale === "en" ? "Search all products" : "在榜单中搜索"}
        >
          <span className="hidden sm:inline">{locale === "en" ? "Search" : "搜索"}</span>
          <Search className="h-3.5 w-3.5 sm:hidden" aria-hidden="true" />
        </button>
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
                  <span className="h-2 w-2 shrink-0 rounded-full bg-foreground/40" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{r.name}</span>
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{r.kind}</span>
                </button>
              </li>
            ))}
            {/* 不想逐条挑？直接去榜单页看完整结果 */}
            <li className="border-t border-border">
              <button
                type="button"
                onClick={submit}
                className="flex w-full items-center justify-between px-4 py-2 text-[12px] text-accent hover:bg-secondary"
              >
                <span>{locale === "en" ? "See all results in rankings" : "在榜单中查看全部结果"}</span>
                <span aria-hidden="true">→</span>
              </button>
            </li>
          </ul>
        </div>
      )}
      {open && query.trim() && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-[10px] border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground shadow-xl">
          <p>{translate(dict, "search.emptyTitle", { q: query.trim() })}</p>
          <button type="button" onClick={submit} className="mt-1.5 text-[12px] text-accent hover:underline">
            {locale === "en" ? "Search in rankings anyway →" : "仍然去榜单里搜一次 →"}
          </button>
        </div>
      )}
    </div>
  );
}
