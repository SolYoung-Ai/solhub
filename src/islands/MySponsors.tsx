import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarPlus,
  Check,
  Loader2,
  Megaphone,
  Pencil,
  PowerOff,
  ShieldOff,
  X,
} from "lucide-react";
import {
  fetchMyAds,
  offlineAd,
  renewAd,
  updateAdDesc,
  type AdSlot,
  type AdsMineData,
} from "@/lib/sponsors";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/**
 * 我的赞助
 * --------
 * 只管自己名下的位置：列表 / 状态 / 续费 / 改介绍 / 下架。
 * 所有写操作都先给确认，成功后重新拉一次列表 —— 状态和余额都以服务端为准。
 */

interface Props {
  locale?: Locale;
}

function dayText(iso: string, en: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return en
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function MySponsors({ locale = "zh" }: Props) {
  const en = locale === "en";
  const [data, setData] = useState<AdsMineData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "guest" | "forbidden" | "error">("loading");
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [busyId, setBusyId] = useState("");
  /** 待确认的操作：{ id, kind } */
  const [confirm, setConfirm] = useState<{ id: string; kind: "renew" | "offline" } | null>(null);
  /** 正在编辑介绍的位置 */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetchMyAds();
    if (!res.ok) {
      if (res.reason === "unauth") return setState("guest");
      if (res.reason === "forbidden") {
        setErr(res.error || "");
        return setState("forbidden");
      }
      setErr(res.error || (en ? "Could not load your slots" : "没能加载你的赞助位"));
      return setState("error");
    }
    setData(res.data);
    setState("ready");
  }, [en]);

  useEffect(() => {
    void load();
  }, [load]);

  const note = (tone: "ok" | "warn", text: string) => {
    setFlash({ tone, text });
    window.setTimeout(() => setFlash(null), 3600);
  };

  const doRenew = async (id: string) => {
    setConfirm(null);
    setBusyId(id);
    const res = await renewAd(id);
    setBusyId("");
    if (!res.ok) {
      note("warn", res.error || (en ? "Renew failed" : "续费失败"));
      return;
    }
    note("ok", en ? "Renewed for another week." : `已续费 ${data?.days ?? 7} 天`);
    await load();
  };

  const doOffline = async (id: string) => {
    setConfirm(null);
    setBusyId(id);
    const res = await offlineAd(id);
    setBusyId("");
    if (!res.ok) {
      note("warn", res.error || (en ? "Could not take it down" : "下架失败"));
      return;
    }
    note("ok", en ? "Taken down — it no longer shows in the rail." : "已下架，右栏不再显示");
    await load();
  };

  const saveDesc = async () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) {
      note("warn", en ? "Description cannot be empty" : "介绍不能为空");
      return;
    }
    setBusyId(editing.id);
    const res = await updateAdDesc(editing.id, text);
    setBusyId("");
    if (!res.ok) {
      note("warn", res.error || (en ? "Save failed" : "保存失败"));
      return;
    }
    setEditing(null);
    note("ok", en ? "Description updated." : "介绍已更新，右栏会显示新文案");
    await load();
  };

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {en ? "Loading your slots…" : "正在加载你的赞助位…"}
      </div>
    );
  }

  if (state === "guest") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-border bg-card text-accent">
          <Megaphone className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-display text-lg font-extrabold text-foreground">{en ? "Sign in to manage slots" : "登录后管理你的赞助位"}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground">
          {en ? "Your slots, renewals and edits live with your SolHub account." : "赞助位跟账号走，登录后可以看到状态、续费或下架。"}
        </p>
        <a href={p("/login/?next=/ads/mine/", locale)} className="btn btn-accent mt-5 !h-10 px-5 text-sm">
          {en ? "Sign in" : "去登录"}
        </a>
      </div>
    );
  }

  if (state === "forbidden") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <ShieldOff className="mx-auto h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
        <h2 className="mt-3 font-display text-lg font-bold text-foreground">{en ? "No access" : "没有权限"}</h2>
        <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">{err || (en ? "You can only manage slots bought on your own account." : "只能管理自己账号下购买的赞助位。")}</p>
        <a href={p("/ads/", locale)} className="btn btn-outline mt-5 !h-9 px-4 text-xs">
          {en ? "Back to ad slots" : "回到广告位"} 
        </a>
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-foreground">{en ? "Could not load your slots" : "没能加载你的赞助位"}</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{err}</p>
        <button type="button" onClick={() => void load()} className="btn btn-outline mt-4 !h-9 px-4 text-xs">
          {en ? "Retry" : "重试"}
        </button>
      </div>
    );
  }

  const live = data.ads.filter((a) => a.status === "live");

  return (
    <div className="mx-auto max-w-3xl">
      {/* 概览 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[16px] border border-border bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{en ? "Live slots" : "投放中"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">{live.length}</p>
        </div>
        <div className="rounded-[16px] border border-border bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{en ? "My points" : "我的积分"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">{data.balance.toLocaleString("en-US")}</p>
        </div>
        <div className="rounded-[16px] border border-border bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{en ? "Renew price" : "续费价格"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">
            {data.price}
            <span className="ml-1 text-[11px] font-medium text-muted-foreground">{en ? `pts / ${data.days}d` : `积分 / ${data.days} 天`}</span>
          </p>
        </div>
      </div>

      {flash && (
        <p
          className={`mt-3 rounded-[12px] px-3.5 py-2.5 text-[12.5px] ${
            flash.tone === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          }`}
          role="status"
        >
          {flash.text}
        </p>
      )}

      {data.ads.length === 0 ? (
        <div className="mt-4 rounded-[20px] border border-dashed border-border bg-card px-6 py-14 text-center">
          <Megaphone className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-3 text-[14px] font-semibold text-foreground">{en ? "No slots yet" : "还没有赞助位"}</p>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-6 text-muted-foreground">
            {en
              ? `Buy a slot for ${data.price} points and your product shows in the rail on Products, Hot and Creators.`
              : `${data.price} 积分可以买一周，产品会出现在「产品 / 热点 / 创作者」三个页面的右栏。`}
          </p>
          <a href={p("/ads/", locale)} className="btn btn-accent mt-5 !h-10 gap-1.5 px-5 text-sm">
            {en ? "Buy a slot" : "去购买赞助位"}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {data.ads.map((slot: AdSlot) => {
            const liveNow = slot.status === "live";
            const isBusy = busyId === slot.id;
            const isEditing = editing?.id === slot.id;
            return (
              <li key={slot.id} className="overflow-hidden rounded-[18px] border border-border bg-card">
                <div className="flex items-start gap-3 p-4">
                  {slot.icon ? (
                    <img src={slot.icon} alt="" className="h-10 w-10 shrink-0 rounded-[11px] border border-border object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-border bg-secondary text-[14px] font-bold text-foreground/70">
                      {slot.name.slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-foreground">{slot.name}</p>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold leading-none ${
                          liveNow ? "bg-success/10 text-success" : slot.status === "offline" ? "bg-secondary text-muted-foreground" : "bg-warning/10 text-warning"
                        }`}
                      >
                        {liveNow
                          ? en
                            ? `Live · ${slot.daysLeft}d left`
                            : `投放中 · 剩 ${slot.daysLeft} 天`
                          : slot.status === "offline"
                            ? en
                              ? "Taken down"
                              : "已下架"
                            : en
                              ? "Ended"
                              : "已到期"}
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="mt-2">
                        <textarea
                          value={editing.text}
                          onChange={(e) => setEditing({ id: slot.id, text: e.target.value.slice(0, 90) })}
                          rows={2}
                          className="w-full rounded-[10px] border border-border bg-secondary/40 px-3 py-2 text-[12.5px] leading-5 text-foreground outline-none focus:border-accent"
                          placeholder={en ? "One line about your product" : "一句话介绍你的产品"}
                        />
                        <div className="mt-1.5 flex items-center gap-2">
                          <button type="button" onClick={() => void saveDesc()} disabled={isBusy} className="btn btn-accent !h-7 gap-1 px-2.5 text-[11.5px]">
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {en ? "Save" : "保存"}
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className="btn btn-outline !h-7 gap-1 px-2.5 text-[11.5px]">
                            <X className="h-3 w-3" /> {en ? "Cancel" : "取消"}
                          </button>
                          <span className="text-[10.5px] text-muted-foreground">{editing.text.length}/90</span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{slot.desc || (en ? "No description" : "还没有介绍")}</p>
                    )}
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {en ? "Until " : "到期 "}
                      {dayText(slot.endAt, en)}
                      {slot.slug && (
                        <>
                          {" · "}
                          <a href={p(`/products/${slot.slug}/`, locale)} className="text-accent hover:underline">
                            {en ? "view product" : "查看产品"}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                {/* 操作区 */}
                {confirm?.id === slot.id ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border bg-secondary/30 px-4 py-2.5">
                    <span className="text-[12px] text-foreground/80">
                      {confirm.kind === "renew"
                        ? en
                          ? `Renew for ${data.days} days and spend ${data.price} points?`
                          : `确认续费 ${data.days} 天、扣 ${data.price} 积分？`
                        : en
                          ? "Take this slot down now? Remaining time is not refunded."
                          : "确认立即下架？剩余时间不退积分。"}
                    </span>
                    <div className="ml-auto flex gap-2">
                      <button
                        type="button"
                        onClick={() => (confirm.kind === "renew" ? void doRenew(slot.id) : void doOffline(slot.id))}
                        className="btn btn-accent !h-7 px-3 text-[11.5px]"
                      >
                        {en ? "Confirm" : "确认"}
                      </button>
                      <button type="button" onClick={() => setConfirm(null)} className="btn btn-outline !h-7 px-3 text-[11.5px]">
                        {en ? "Cancel" : "取消"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setConfirm({ id: slot.id, kind: "renew" })}
                      disabled={isBusy || !liveNow}
                      className="btn btn-outline !h-7 gap-1 px-2.5 text-[11.5px] disabled:opacity-40"
                    >
                      <CalendarPlus className="h-3 w-3" /> {en ? "Renew" : "续费"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing({ id: slot.id, text: slot.desc || "" })}
                      disabled={isBusy || !!editing || !liveNow}
                      className="btn btn-outline !h-7 gap-1 px-2.5 text-[11.5px] disabled:opacity-40"
                    >
                      <Pencil className="h-3 w-3" /> {en ? "Edit text" : "改介绍"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm({ id: slot.id, kind: "offline" })}
                      disabled={isBusy || !liveNow}
                      className="btn btn-outline !h-7 gap-1 px-2.5 text-[11.5px] text-destructive hover:border-destructive/40 disabled:opacity-40"
                    >
                      <PowerOff className="h-3 w-3" /> {en ? "Take down" : "下架"}
                    </button>
                    {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-center text-[11.5px] leading-5 text-muted-foreground">
        {en
          ? "Slots are tied to your account — nobody else can renew or take down what you bought."
          : "赞助位跟账号绑定：别人看不到、也改不了你买的位置。"}
      </p>
    </div>
  );
}
