import { Search } from "lucide-react";
import { getLocale } from "@/lib/utils";
import { getDict, translate } from "@/i18n";

/** 首页 Hero 搜索条：点击后唤起全局搜索浮层 */
export default function HeroSearch() {
  const locale = getLocale();
  const dict = getDict(locale);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("solhub:open-search"))}
      className="group mx-auto flex w-full max-w-xl cursor-text items-center gap-3 rounded-[4px] border border-border-strong bg-card px-4 py-3.5 text-left shadow-md transition-all duration-200 hover:border-foreground/40 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={translate(dict, "nav.search")}
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex-1 truncate text-sm text-muted-foreground">
        {locale === "en" ? "Search products & tools, e.g. “json”, “QR”, “SolYoung”…" : "搜索产品或工具，比如 “json”“二维码”“SolYoung”…"}
      </span>
      <kbd className="hidden shrink-0 rounded-[2px] border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
        /
      </kbd>
    </button>
  );
}
