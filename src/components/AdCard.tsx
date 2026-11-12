import { p } from "@/lib/paths";
import type { Ad } from "@/data/ads";
import type { Locale } from "@/i18n";

/**
 * 广告卡（访客视角）。
 *
 * - 整卡直接跳广告主链接（新窗口），没有二级页面
 * - 所有卡片同一尺寸：统一用大卡排版，避免第一条大、后面的小
 * - 「赞助商」+「广告」两个标识必须同时出现（《广告法》要求）
 * - 有 logo 时容器透明 + object-contain，圆形 SVG 也能正常显示
 */
export default function AdCard({
  ad,
  locale = "zh",
  compact = false,
}: {
  ad: Ad;
  locale?: Locale;
  /** 首页摘录用：正文压到 3 行，免得两张卡在手机上占掉一整屏 */
  compact?: boolean;
}) {
  const en = locale === "en";
  const tagline = en ? ad.tagline.en : ad.tagline.zh;
  const body = en ? ad.body.en : ad.body.zh;

  return (
    <a
      href={ad.url}
      target="_blank"
      rel="noopener noreferrer"
      className="card group relative block overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5 sm:p-7"
      aria-label={`${en ? "Ad" : "广告"}：${ad.name}（${ad.displayUrl}）`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#d99a2b] px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
          {en ? "Sponsor" : "赞助商"}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {en ? "Ad" : "广告"}
        </span>
      </div>

      <div className="mt-4 flex items-start gap-4">
        {/* 统一的方形底板：横版 logo 与圆形 logo 放进同一尺寸的框里才协调，
            白底 + 内边距让「扁图形」和「圆图形」的视觉重量接近 */}
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-border text-xl font-bold text-white sm:h-[72px] sm:w-[72px]"
          style={{
            backgroundColor: ad.icon ? "#ffffff" : ad.accent,
            padding: ad.icon ? "10px" : 0,
          }}
          aria-hidden="true"
        >
          {ad.icon ? (
            <img
              src={p(ad.icon)}
              alt=""
              className="h-full w-full object-contain"
              style={{ transform: `scale(${ad.logoZoom ?? 1})` }}
            />
          ) : (
            ad.initial
          )}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            {ad.name}
          </h3>
          <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{tagline}</p>
        </div>
      </div>

      <p className={`mt-3.5 max-w-3xl text-[13px] leading-7 text-muted-foreground ${compact ? "line-clamp-3" : ""}`}>
        {body}
      </p>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/80">
          {ad.displayUrl}
        </span>
        <span className="btn btn-accent shrink-0 !h-9 px-4 text-xs">
          {en ? "Visit" : "去看看"} ↗
        </span>
      </div>
    </a>
  );
}
