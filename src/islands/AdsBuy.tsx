import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Coins, Loader2, Megaphone, Sparkles } from "lucide-react";
import { request } from "@/lib/net";
import { base } from "@/lib/api-base";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/**
 * 广告位购买（积分）
 *
 * 规则跟后端一致：一周固定价格，扣积分、写一条 ad 明细、生成 7 天有效的广告位。
 * 这里**不做本地乐观扣分** —— 买完重新拉一次 /ads/mine，余额与列表都以服务端为准。
 */

interface Option {
  slug: string;
  name: string;
  desc: string;
  icon: string;
  url: string;
}

interface Slot {
  id: string;
  name: string;
  slug: string;
  startAt: string;
  endAt: string;
}

interface AdsData {
  price: number;
  days: number;
  balance: number;
  available: number;
  ads: Slot[];
  options: Option[];
}

function dayText(iso: string, en: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return en
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function AdsBuy({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [data, setData] = useState<AdsData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await request(`${base()}/ads/mine`, { cache: "no-store" }, { retries: 1 });
      if (res.status === 401) {
        setState("guest");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const json = (await res.json()) as AdsData & { ok?: boolean };
      setData(json);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await request(`${base()}/ads/buy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: picked }),
      }, { retries: 0 });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; balance?: number };
      if (!res.ok || !json.ok) {
        setMsg({ tone: "warn", text: json.error || (en ? "Purchase failed." : "购买失败，请稍后重试。") });
        return;
      }
      setMsg({
        tone: "ok",
        text: en ? "Slot is live — it shows in the rail on Products, Hot and Creators." : "投放成功，产品 / 热点 / 创作者 三个页面的右栏都已经显示了。",
      });
      setPicked("");
      await load();
    } catch {
      setMsg({ tone: "warn", text: en ? "Network error." : "网络错误，请重试。" });
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {en ? "Loading…" : "加载中…"}
      </div>
    );
  }

  if (state === "guest") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-border bg-card text-accent">
          <Megaphone className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-display text-lg font-extrabold text-foreground">{en ? "Sign in to book a slot" : "登录后购买广告位"}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground">
          {en ? "Slots are paid with points. Sign in to see your balance and products." : "广告位用积分购买，登录后能看到你的余额和可投放的产品。"}
        </p>
        <a href={p("/login/?next=/ads/", locale)} className="btn btn-accent mt-5 !h-10 px-5 text-sm">
          {en ? "Sign in" : "去登录"}
        </a>
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm font-medium text-foreground">{en ? "Could not load slots" : "没能加载广告位信息"}</p>
        <button type="button" onClick={() => void load()} className="btn btn-outline mt-4 !h-9 px-4 text-xs">
          {en ? "Retry" : "重试"}
        </button>
      </div>
    );
  }

  const enough = data.balance >= data.price;
  const active = data.ads.filter((a) => new Date(a.endAt).getTime() > Date.now());

  return (
    <div className="mx-auto max-w-3xl">
      {/* 价格 / 余额 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[16px] border border-border bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{en ? "Price" : "价格"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">
            {data.price}
            <span className="ml-1 text-[11px] font-medium text-muted-foreground">{en ? `pts / ${data.days}d` : `积分 / ${data.days} 天`}</span>
          </p>
        </div>
        <div className="rounded-[16px] border border-border bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{en ? "My points" : "我的积分"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">{data.balance.toLocaleString("en-US")}</p>
        </div>
        <div className="rounded-[16px] border border-border bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{en ? "Active slots" : "在投位置"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">{active.length}</p>
        </div>
      </div>

      {!enough && (
        <p className="mt-3 rounded-[12px] border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12.5px] leading-5 text-warning">
          {en
            ? `You need ${data.price - data.balance} more points. Invite creators — both of you get 100 points.`
            : `还差 ${data.price - data.balance} 积分。去邀请创作者：你和被邀请的人都各得 100 积分。`}
          <a href={p("/wallet/", locale)} className="ml-1 underline underline-offset-2">
            {en ? "Open wallet" : "打开钱包"}
          </a>
        </p>
      )}

      {/* 选产品 */}
      <section className="mt-4 overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="border-b border-border bg-secondary/30 px-5 py-3.5">
          <h2 className="font-display text-[15px] font-bold text-foreground">{en ? "Pick a product" : "选择要投放的产品"}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {en
              ? "Only products listed under your account can be featured."
              : "只能投放你自己名下的产品（已收录到目录的）。"}
          </p>
        </div>
        {data.options.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] font-medium text-foreground/70">{en ? "No product to feature yet" : "还没有可投放的产品"}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{en ? "Submit a product first — it goes live once the link opens." : "先提交一个产品，链接能打开就会自动收录。"}</p>
            <a href={p("/submit/", locale)} className="btn btn-accent mt-4 !h-9 px-4 text-xs">
              {en ? "Submit a product" : "去提交产品"}
            </a>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.options.map((o) => {
              const on = picked === o.slug;
              return (
                <li key={o.slug}>
                  <button
                    type="button"
                    onClick={() => setPicked(on ? "" : o.slug)}
                    className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors ${on ? "bg-accent/5" : "hover:bg-secondary/40"}`}
                  >
                    {o.icon ? (
                      <img src={o.icon} alt="" className="h-9 w-9 shrink-0 rounded-[10px] border border-border object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-secondary text-[13px] font-bold text-foreground/70">
                        {o.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-foreground">{o.name}</span>
                      <span className="mt-0.5 line-clamp-1 block text-[11.5px] text-muted-foreground">{o.desc}</span>
                    </span>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>
                      {on && <Check className="h-3 w-3" aria-hidden="true" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {msg && (
        <p className={`mt-3 rounded-[12px] px-3.5 py-2.5 text-[12.5px] ${msg.tone === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
          {msg.text}
        </p>
      )}

      <button
        type="button"
        onClick={() => void buy()}
        disabled={!picked || busy || !enough}
        className="btn btn-accent mt-4 !h-11 w-full gap-1.5 text-sm disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
        {en ? `Book ${data.days} days · ${data.price} points` : `投放 ${data.days} 天 · 扣 ${data.price} 积分`}
      </button>

      {/* 我的投放 */}
      <section className="mt-6 overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-display text-[15px] font-bold text-foreground">{en ? "My slots" : "我的投放"}</h2>
          <a href={p("/wallet/", locale)} className="inline-flex items-center gap-0.5 text-[11.5px] text-accent">
            {en ? "Points history" : "积分明细"} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
        {data.ads.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] text-muted-foreground">
            {en ? "Nothing running yet." : "还没有投放记录。"}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.ads.map((a) => {
              const live = new Date(a.endAt).getTime() > Date.now();
              return (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <Sparkles className={`h-4 w-4 shrink-0 ${live ? "text-accent" : "text-muted-foreground"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{a.name}</span>
                  <span className={`shrink-0 text-[11.5px] ${live ? "text-success" : "text-muted-foreground"}`}>
                    {live ? (en ? `until ${dayText(a.endAt, en)}` : `至 ${dayText(a.endAt, en)}`) : en ? "ended" : "已结束"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
