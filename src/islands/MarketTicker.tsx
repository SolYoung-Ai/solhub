/**
 * 行情条（/hot/ 顶部）
 * =====================
 *
 * 八个指数：上证、深证、纳斯达克、标普 500、恒生、COMEX 黄金、比特币、美元指数。
 *
 * 三个刻意的设计：
 *   1. 取不到就整条隐藏。数据源是东方财富和新浪的免费接口，没有 SLA，随时可能
 *      加校验或封 IP。这时候页面上不该出现红色报错条 —— 读者是来看新闻的，
 *      一条取不到的行情栏不值得占用他的注意力。
 *   2. 失败不清空已有数据。网络抖一下就把整条抹掉、下一轮又冒出来，比一直显示
 *      旧数字更烦；后端也会在回源失败时回退到 KV 里的旧快照并标 stale。
 *   3. 60 秒一轮、页面不可见时暂停。和后端缓存 TTL 对齐，多开几个标签页也不会
 *      把接口打穿。
 *
 * 涨跌配色按 A 股习惯：涨红、跌绿。
 */

import { useEffect, useState } from "react";
import { base } from "@/lib/api-base";

interface Quote {
  key: string;
  zh: string;
  en: string;
  price: number;
  change: number | null;
  pct: number;
  digits: number;
}

interface QuotesResponse {
  updatedAt: string | null;
  stale: boolean;
  items: Quote[];
}

const REFRESH_MS = 60 * 1000;

/** 涨红跌绿；持平走中性色 */
function toneOf(pct: number): string {
  if (pct > 0) return "text-[#c4372a] dark:text-[#f2795f]";
  if (pct < 0) return "text-[#0d7f57] dark:text-[#4fc08d]";
  return "text-muted-foreground";
}

function fmtPrice(v: number, digits: number, en: boolean): string {
  return new Intl.NumberFormat(en ? "en-US" : "zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

function fmtPct(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(2)}%`;
}

function clockOf(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MarketTicker({ locale = "zh" }: { locale?: "zh" | "en" }) {
  const en = locale === "en";
  const [data, setData] = useState<QuotesResponse | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch(`${base()}/quotes`, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as QuotesResponse;
        if (!alive) return;
        if (Array.isArray(json.items) && json.items.length) setData(json);
      } catch {
        /* 保留上一份；一份都没有时这根条压根不渲染 */
      }
    };

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const items = data?.items ?? [];
  if (!items.length) return null;

  const clock = clockOf(data?.updatedAt ?? null);

  return (
    <section aria-label={en ? "Market indices" : "行情"} className="mb-4 sm:mb-5">
      <div className="rounded-xl border border-border bg-card">
        {/* 手机上横向滑动，不换行、不挤压任何东西；1280 桌面端八格正好排满 */}
        <div className="flex items-center gap-4 overflow-x-auto px-3.5 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((q) => (
            <div key={q.key} className="shrink-0" title={q.en}>
              <div className="whitespace-nowrap text-[11px] leading-none text-muted-foreground">
                {en ? q.en : q.zh}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-[13px] font-semibold leading-none tabular-nums text-foreground">
                  {fmtPrice(q.price, q.digits, en)}
                </span>
                <span className={`text-[11px] leading-none tabular-nums ${toneOf(q.pct)}`}>{fmtPct(q.pct)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 免责与时间放在同一行：时间原本占掉右侧 60px，八格就排不下了 */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0.5">
        <p className="text-[10px] text-muted-foreground">
          {en
            ? "Source: Eastmoney / Sina Finance. Indicative only; closed markets show the last price."
            : "数据来源：东方财富 / 新浪财经，仅供参考；休市时显示最近成交价。"}
        </p>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {clock}
          {data?.stale ? (en ? " · delayed" : " · 延迟") : ""}
        </span>
      </div>
    </section>
  );
}
