import { useEffect, useMemo, useState } from "react";
import AdCard from "@/components/AdCard";
import { daysLeft, rankAds, type Ad } from "@/data/ads";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/**
 * 广告墙 + 站内广告搜索。
 * 搜索范围只有广告（不碰产品与 Skill），匹配 name / tagline / 正文 / 关键词，
 * 空格分词后逐词 AND，简单可预期，不引入分词库。
 */
function matches(ad: Ad, q: string): boolean {
  if (!q.trim()) return true;
  const hay = [
    ad.name,
    ad.tagline.zh,
    ad.tagline.en,
    ad.body.zh,
    ad.body.en,
    ad.kind.zh,
    ad.kind.en,
    ...ad.keywords,
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

export default function AdsBoard({
  ads,
  builtAt,
  locale = "zh",
  joinHref,
}: {
  ads: Ad[];
  /** 构建时间：SSR 与首帧都用它，避免 hydration 前后数量不一致 */
  builtAt: string;
  locale?: Locale;
  joinHref: string;
}) {
  const en = locale === "en";
  const [q, setQ] = useState("");
  /* 首帧用构建时间，挂载后切到真实时间：30 天到期不必等下次部署 */
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const ranked = useMemo(() => rankAds(ads, now ?? new Date(builtAt)), [ads, now, builtAt]);
  const results = useMemo(
    () => ranked.map((ad, i) => ({ ad, rank: i + 1 })).filter(({ ad }) => matches(ad, q)),
    [ranked, q],
  );

  const total = ranked.length;

  return (
    <div>
      <div className="relative max-w-xl">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={en ? "Search ads only — try “packaging”, “AI”…" : "只搜广告：试试「包装」「设计」「AI」…"}
          aria-label={en ? "Search sponsors and ads" : "搜索赞助商与广告"}
          className="input h-11 w-full !pl-10 pr-16 text-[13px]"
        />
        <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[11px] text-muted-foreground/80">
          {q ? (en ? `${results.length} found` : `${results.length} 条`) : en ? `${total} ads` : `${total} 条广告`}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground/80">
        {en
          ? "Search covers sponsored placements only — products and Skills are searched from the sidebar."
          : "搜索范围仅限赞助位；产品与 Skill 请用左侧搜索。"}
      </p>

      {results.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-border px-6 py-14 text-center">
          <p className="text-[13px] font-semibold text-foreground">
            {en ? "No ad matches that" : "没有匹配的广告"}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {en ? "Try a shorter word, or book this slot yourself." : "换个更短的词，或者把这个位置买下来。"}
          </p>
          <button
            type="button"
            onClick={() => setQ("")}
            className="btn btn-outline mt-2 !h-9 px-4 text-xs"
          >
            {en ? "Clear" : "清空搜索"}
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {results.map(({ ad, rank }, i) => (
            <div key={ad.id}>
              <AdCard
                ad={ad}
                rank={rank}
                days={daysLeft(ad, now ?? new Date(builtAt))}
                locale={locale}
                size={i === 0 && !q ? "hero" : "grid"}
              />
            </div>
          ))}

          {!q && (
            <a
              href={joinHref}
              className="flex flex-col items-center justify-center gap-1.5 rounded-[16px] border border-dashed border-border px-4 py-10 text-center transition-colors hover:border-accent/50 hover:bg-accent/5"
            >
              <span className="text-[13px] font-semibold text-foreground">
                {en ? "Next slot is open" : "下一个位置空着"}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {en ? "Bid any amount · 30 days · ranked by bid" : "自由出价 · 展示 30 天 · 按金额排序"}
              </span>
              <span className="mt-1 text-[11px] font-medium text-accent">
                {en ? "Book it" : "我要这个位置"} →
              </span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
