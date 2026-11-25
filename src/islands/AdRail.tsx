import { useEffect, useState } from "react";
import { ArrowUpRight, Plus, Sparkles } from "lucide-react";
import { base } from "@/lib/api-base";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/**
 * 右栏赞助位（发现 / 产品 / 热点 / 创作者 共用）
 *
 * 只做展示：读 /ads/active，把当前在投的广告渲染成卡片；下面跟一张
 * 「你的产品在这里」的招商卡，点了去 /ads/ 用积分买。
 *
 * 宽度固定 240px 且只在 lg 以上出现 —— 主内容区不被压窄，
 * 手机端整块隐藏（广告不该占手机首屏）。
 */

interface Ad {
  id: string;
  name: string;
  desc: string;
  icon: string;
  url: string;
  ownerHandle: string;
}

export default function AdRail({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [ads, setAds] = useState<Ad[]>([]);
  const [price, setPrice] = useState(300);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let alive = true;
    fetch(`${base()}/ads/active`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        if (Array.isArray(data.ads)) setAds(data.ads.filter((a: Ad) => a && a.name));
        if (Number(data.price) > 0) setPrice(Number(data.price));
        if (Number(data.days) > 0) setDays(Number(data.days));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <aside className="hidden w-[240px] shrink-0 lg:block" aria-label={en ? "Sponsored" : "赞助位"}>
      <div className="sticky top-20 space-y-3">
        {ads.map((ad) => (
          <div key={ad.id} className="overflow-hidden rounded-[16px] border border-border bg-card">
            <div className="px-3.5 pt-3.5">
              <div className="flex items-start gap-2.5">
                {ad.icon ? (
                  <img
                    src={ad.icon}
                    alt=""
                    loading="lazy"
                    className="h-9 w-9 shrink-0 rounded-[10px] border border-border bg-card object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-secondary text-[13px] font-bold text-foreground/70">
                    {ad.name.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-foreground">{ad.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-[1.45] text-muted-foreground">{ad.desc}</p>
                </div>
              </div>
              <a
                href={ad.url}
                className="mt-2.5 flex h-7 w-full items-center justify-center gap-1 rounded-[8px] bg-foreground text-[11.5px] font-medium text-background transition-opacity hover:opacity-85"
              >
                {en ? "Visit" : "访问"}
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-border px-3.5 py-2 text-[10.5px] text-muted-foreground">
              <span className="rounded-[4px] border border-border px-1 py-px">{en ? "Ad" : "广告"}</span>
              {ad.ownerHandle && <span className="truncate">@{ad.ownerHandle}</span>}
            </div>
          </div>
        ))}

        {/* 招商卡：虚线框，一眼看出是空位而不是广告 */}
        <a
          href={p("/ads/", locale)}
          className="block rounded-[16px] border border-dashed border-border bg-card/60 px-3.5 py-3.5 transition-colors hover:border-accent/50"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-dashed border-border text-muted-foreground">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <p className="mt-2 flex items-center gap-1 text-[12.5px] font-semibold text-foreground">
            {en ? "Your product here" : "你的产品在这里"}
            <Sparkles className="h-3 w-3 text-accent" aria-hidden="true" />
          </p>
          <p className="mt-1 text-[11px] leading-[1.5] text-muted-foreground">
            {en
              ? `${price} points per ${days} days · shown on Discover, Products, Hot and Creators.`
              : `每周 ${price} 积分 · 发现 / 产品 / 热点 / 创作者 四个页面同时展示。`}
          </p>
          <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] text-accent">
            {en ? "Get this slot" : "购买这个位置"}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </span>
        </a>
      </div>
    </aside>
  );
}
