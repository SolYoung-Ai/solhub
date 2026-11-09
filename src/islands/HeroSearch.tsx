import { useMemo, useRef, useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { getLocale } from "@/lib/utils";
import { getDict, translate } from "@/i18n";
import { searchIndex, buildSearchIndex, type SearchIndexEntry } from "@/lib/search";
import { p } from "@/lib/paths";
import { products } from "@/data/products";
import { skills } from "@/data/skills";
import { useCatalogSearchEntries } from "@/lib/skills-catalog";

/** 首页 Hero 搜索条：直接输入出下拉结果 */
export default function HeroSearch() {
  const locale = getLocale();
  const dict = getDict(locale);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /* 用户是否用方向键在下拉里挪动过：挪过 → Enter 进选中项；没挪过 → Enter 去产品页看全部结果 */
  const [keyNav, setKeyNav] = useState(false);
  /* 窄屏放不下完整占位文案（会被硬截断成 “SolY”），单独给一版短的。
     用 effect 而非初始值，避免 SSR 与首帧水合不一致。 */
  const [narrow, setNarrow] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /* 与导航搜索共用索引：产品 + 精选 Skill，再异步追加 1000 条真实 SKILL.md */
  const index = useMemo(() => buildSearchIndex(products, locale, skills), [locale]);
  const catalogEntries = useCatalogSearchEntries(locale);
  const fullIndex = useMemo(() => [...index, ...catalogEntries], [index, catalogEntries]);
  const results = query.trim() ? searchIndex(query, fullIndex, locale).slice(0, 8) : [];
  const skillHref = `${p("/skills/", locale)}?q=${encodeURIComponent(query.trim())}`;

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
    window.location.href = p(r.href, locale);
  };

  /* 提交搜索：统一去产品页，带上关键词看完整列表（而不是替用户直接跳进某个产品）。
     产品页的 LaunchesExplorer 会读 ?q= 把关键词填进搜索框并过滤。 */
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
      <div className="flex items-center gap-3 rounded-[16px] border border-border-strong bg-card px-4 py-3.5 shadow-md transition-all duration-200 focus-within:border-foreground/40 focus-within:shadow-lg">
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
              /* 用方向键选过 → 进那一个；只是敲了词直接回车 → 去产品页看全部结果 */
              if (keyNav && results[active]) go(results[active]);
              else submit();
            }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder={
            locale === "en"
              ? narrow ? "Search products & Skills…" : "Search products, Skills or keywords, e.g. “json”, “pdf”, “find-skills”…"
              : narrow ? "搜索产品、Skill…" : "搜索产品、Skill 或关键词，比如 “json”“二维码”“find-skills”…"
          }
          /* 移动端 16px：iOS Safari 对小于 16px 的输入框会在聚焦时自动放大页面。
             w-0 + min-w-0：flex 子项默认 min-width:auto，Safari 会按 input 的固有宽度
             （由 placeholder 长度和字号决定）撑住不收缩，右侧搜索按钮就被挤到圆角框外
             甚至屏幕外。basis 归零 + min-width:0 之后，宽度完全由 flex 分配，任何
             字号下按钮都留在框内。 */
          className="w-0 min-w-0 flex-1 bg-transparent text-[16px] text-foreground placeholder:text-muted-foreground focus:outline-none sm:text-sm"
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
          aria-label={locale === "en" ? "Search all products" : "在产品中搜索"}
        >
          <span className="hidden sm:inline">{locale === "en" ? "Search" : "搜索"}</span>
          <Search className="h-3.5 w-3.5 sm:hidden" aria-hidden="true" />
        </button>
      </div>
      {open && query.trim() && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 glass-sheet overflow-hidden rounded-[20px]">
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
                  <span
                    className={
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] " +
                      (r.kind === "skill"
                        ? "bg-[#ec4899]/10 text-[#db2777]"
                        : "bg-secondary text-muted-foreground")
                    }
                  >
                    {r.kind === "skill" ? "Skill" : locale === "en" ? "Product" : "产品"}
                  </span>
                </button>
              </li>
            ))}
            {/* 不想逐条挑？去产品页看完整结果，或去 Skill 库按关键词筛选 */}
            <li className="border-t border-border">
              <button
                type="button"
                onClick={submit}
                className="flex w-full items-center justify-between px-4 py-2 text-[12px] text-accent hover:bg-secondary"
              >
                <span>{locale === "en" ? "See all results in products" : "在产品中查看全部结果"}</span>
                <span aria-hidden="true">→</span>
              </button>
            </li>
            <li className="border-t border-border">
              <a
                href={skillHref}
                className="flex w-full items-center justify-between px-4 py-2 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <span>{locale === "en" ? "Search this keyword in the Skill library" : "在 Skill 库中搜索这个关键词"}</span>
                <span aria-hidden="true">→</span>
              </a>
            </li>
          </ul>
        </div>
      )}
      {open && query.trim() && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 glass-sheet rounded-[20px] px-4 py-3 text-[13px] text-muted-foreground">
          <p>{translate(dict, "search.emptyTitle", { q: query.trim() })}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" onClick={submit} className="text-[12px] text-accent hover:underline">
              {locale === "en" ? "Search products anyway →" : "仍然去产品里搜一次 →"}
            </button>
            <a href={skillHref} className="text-[12px] text-accent hover:underline">
              {locale === "en" ? "Search Skills →" : "去 Skill 库里搜一次 →"}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
