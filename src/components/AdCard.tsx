import { p } from "@/lib/paths";
import type { Ad } from "@/data/ads";
import type { Locale } from "@/i18n";

/**
 * 广告卡（访客视角）。
 * 只呈现：这是广告、这是谁、一句话、去哪看。
 * 排名、剩余天数、出价这些运营信息属于广告主，不放在访客面前。
 *
 * 整卡指向独立页 /sponsors/<id>/，所以内部不能再放 <a>，
 * 「查看」用 span 模拟按钮。
 */
export default function AdCard({
  ad,
  locale = "zh",
  size = "grid",
}: {
  ad: Ad;
  locale?: Locale;
  size?: "hero" | "grid";
}) {
  const en = locale === "en";
  const tagline = en ? ad.tagline.en : ad.tagline.zh;
  const body = en ? ad.body.en : ad.body.zh;
  const href = p(`/sponsors/${ad.id}/`, locale);
  const hero = size === "hero";

  return (
    <a
      href={href}
      className={[
        "card group relative block overflow-hidden transition-transform duration-200 hover:-translate-y-0.5",
        hero ? "p-5 sm:p-7" : "p-5",
      ].join(" ")}
      aria-label={`${en ? "Ad" : "广告"}：${ad.name}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#d99a2b] px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
          {en ? "Sponsor" : "赞助商"}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {en ? "Ad" : "广告"}
        </span>
      </div>

      <div className={hero ? "mt-4 flex items-start gap-4" : "mt-3.5 flex items-center gap-3"}>
        <span
          className={[
            "flex shrink-0 items-center justify-center overflow-hidden text-white",
            hero ? "h-16 w-16 rounded-[18px] text-xl font-bold sm:h-[72px] sm:w-[72px]" : "h-11 w-11 rounded-[12px] text-[15px] font-bold",
          ].join(" ")}
          style={{ backgroundColor: ad.accent }}
          aria-hidden="true"
        >
          {ad.icon ? <img src={p(ad.icon)} alt="" className="h-full w-full object-cover" /> : ad.initial}
        </span>
        <div className="min-w-0">
          <h3
            className={[
              "font-display font-extrabold tracking-tight text-foreground",
              hero ? "text-xl sm:text-2xl" : "text-[16px]",
            ].join(" ")}
          >
            {ad.name}
          </h3>
          <p
            className={[
              "text-muted-foreground",
              hero ? "mt-1 text-[13px] leading-6" : "mt-0.5 line-clamp-2 text-[12px] leading-5",
            ].join(" ")}
          >
            {tagline}
          </p>
        </div>
      </div>

      {hero && (
        <p className="mt-3.5 max-w-3xl text-[13px] leading-7 text-muted-foreground">{body}</p>
      )}

      <div className={["flex items-center justify-between gap-3", hero ? "mt-5" : "mt-4"].join(" ")}>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/80">
          {ad.displayUrl}
        </span>
        <span
          className={[
            "btn shrink-0 transition-colors",
            hero ? "btn-accent !h-9 px-4 text-xs" : "btn-outline !h-8 px-3 text-[11px]",
          ].join(" ")}
        >
          {en ? "Open" : "查看"} →
        </span>
      </div>
    </a>
  );
}
