import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Gift,
  Loader2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Wallet as WalletIcon,
} from "lucide-react";
import { fetchMe, type AuthUser } from "@/lib/auth";
import { cachedWallet, fetchWallet, type WalletData, type WalletLedgerItem } from "@/lib/wallet";
import { copyText } from "@/lib/utils";
import GoldBadge from "@/components/GoldBadge";
import BlueBadge from "@/components/BlueBadge";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/**
 * 我的钱包
 * =========
 *
 * 视觉目标：像一张银行卡，而不是积分流水表。
 *   - 卡面用深炭→暖橙的斜向渐变 + 两团柔光 + 极淡的斜纹，模拟塑料卡的反光；
 *   - 芯片、无接触标识用纯 CSS 画，不引外部图片，深浅主题都不会花；
 *   - 积分数字是卡面主角，其余信息（持卡人 / 邀请码 / 加入时间）压低层级。
 *
 * 数据全部来自 /wallet（后端把余额、明细、邀请码、已邀请名单一次给全），
 * 前端不做任何「本地加一分」的乐观计算 —— 数字必须和账本一致。
 */

interface Props {
  locale?: Locale;
}

function fmt(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US");
}

function dayText(iso: string, en: boolean): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return en
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ledgerLabel(type: string, en: boolean): string {
  if (type === "invite") return en ? "Referral" : "邀请奖励";
  if (type === "signup") return en ? "Welcome" : "注册奖励";
  if (type === "ad") return en ? "Ad slot" : "广告位";
  if (type === "signup") return en ? "Welcome" : "注册奖励";
  if (type === "ad") return en ? "Ad slot" : "广告位";
  if (type === "spend") return en ? "Spend" : "积分消费";
  return en ? "Points" : "积分变动";
}

export default function Wallet({ locale = "zh" }: Props) {
  const en = locale === "en";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<WalletData | null>(() => cachedWallet());
  const [state, setState] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [copied, setCopied] = useState<"" | "code" | "link">("");

  const load = useCallback(async () => {
    const me = await fetchMe().catch(() => null);
    setUser(me);
    const res = await fetchWallet();
    if (res.ok) {
      setData(res.data);
      setState("ready");
      return;
    }
    setState(res.reason === "unauth" || !me ? "guest" : "error");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? data?.code || "" : data?.link || "";
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(what);
    window.setTimeout(() => setCopied(""), 1600);
  };

  const holder = useMemo(() => {
    const name = data?.handle || user?.handle || user?.login || "";
    return name ? `@${name}` : "—";
  }, [data?.handle, user?.handle, user?.login]);

  if (state === "loading" && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {en ? "Loading wallet…" : "正在打开钱包…"}
      </div>
    );
  }

  if (state === "guest") {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-border bg-card text-accent">
          <WalletIcon className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-xl font-extrabold text-foreground">{en ? "Sign in to open your wallet" : "登录后查看我的钱包"}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-muted-foreground">
          {en
            ? "Your points, invite code and referral rewards live with your SolHub account."
            : "积分、邀请码和邀请奖励都跟着 SolHub 账号走，登录后即可查看。"}
        </p>
        <a href={p(`/login/?next=/wallet/`, locale)} className="btn btn-accent mt-5 !h-10 px-5 text-sm">
          {en ? "Sign in" : "去登录"}
        </a>
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-sm font-medium text-foreground">{en ? "Wallet failed to load" : "钱包没能加载出来"}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{en ? "Network hiccup — try again." : "网络不稳定，再试一次。"}</p>
        <button type="button" onClick={() => void load()} className="btn btn-outline mt-5 !h-10 px-5 text-sm">
          {en ? "Retry" : "重试"}
        </button>
      </div>
    );
  }

  /* 后端字段理论上齐全，但老缓存 / 灰度期间可能缺项，这里兜一层，别整页白屏 */
  const invitedRows = Array.isArray(data.invited) ? data.invited : [];
  const ledgerRows = Array.isArray(data.ledger) ? data.ledger : [];

  return (
    <div className="mx-auto max-w-3xl">
      {/* ---------------- 卡面 ---------------- */}
      <div
        className="relative overflow-hidden rounded-[26px] px-6 pb-6 pt-5 text-white shadow-[0_24px_60px_-28px_rgba(70,35,10,.6)] sm:px-8 sm:pb-7 sm:pt-6"
        style={{ background: "linear-gradient(132deg,#241f1d 0%,#3d2b21 46%,#7c4016 100%)" }}
      >
        <div className="pointer-events-none absolute -right-20 -top-24 h-60 w-60 rounded-full bg-[#ff9a4d]/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-28 -left-12 h-56 w-56 rounded-full bg-[#ffd7a8]/12 blur-3xl" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.045]"
          style={{ backgroundImage: "repeating-linear-gradient(114deg,#fff 0 1px,transparent 1px 10px)" }}
          aria-hidden="true"
        />

        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {en ? "SolHub · Creator wallet" : "SolHub · 创作者钱包"}
          </div>
          <div className="flex items-center gap-2.5">
            {/* 芯片 */}
            <span
              className="relative block h-7 w-10 overflow-hidden rounded-[5px]"
              style={{ background: "linear-gradient(135deg,#f7ddb0,#c99b4d)" }}
              aria-hidden="true"
            >
              <span className="absolute inset-x-[5px] top-[7px] h-px bg-[#8a6a2f]/55" />
              <span className="absolute inset-x-[5px] top-[13px] h-px bg-[#8a6a2f]/55" />
              <span className="absolute inset-y-[9px] left-[13px] w-px bg-[#8a6a2f]/45" />
            </span>
            {/* 无接触标识 */}
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 8.5a8 8 0 0 1 0 7" />
              <path d="M9.5 7a11 11 0 0 1 0 10" />
              <path d="M13 5.5a14 14 0 0 1 0 13" />
            </svg>
          </div>
        </div>

        <div className="relative mt-6 sm:mt-7">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/55">{en ? "Points balance" : "积分余额"}</p>
          <div className="mt-1 flex items-end gap-2">
            <span className="font-display text-[40px] font-extrabold leading-none tracking-tight sm:text-[46px]">{fmt(data.balance)}</span>
            <span className="pb-1 text-[12px] text-white/60">{en ? "pts" : "积分"}</span>
          </div>
        </div>

        <div className="relative mt-7 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">{en ? "Holder" : "持卡人"}</p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13.5px] font-semibold">
              {holder}
              {/* 用户都是黄V；官方账号（编辑部 / 官方号）才是蓝V */}
              {data.verified && (data.official ? <BlueBadge className="h-3.5 w-3.5" /> : <GoldBadge className="h-3.5 w-3.5" />)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">{en ? "Invite code" : "邀请码"}</p>
            <p className="mt-0.5 font-mono text-[13.5px] font-semibold tracking-[0.12em]">{data.code || "—"}</p>
          </div>
        </div>
      </div>

      {/* ---------------- 三个数字 ---------------- */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-[16px] border border-border bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{en ? "Available" : "可用积分"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">{fmt(data.available)}</p>
        </div>
        <div className="rounded-[16px] border border-border bg-card p-4">
          <p className="text-[11px] text-muted-foreground">{en ? "Total earned" : "累计获得"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">{fmt(data.earned)}</p>
        </div>
        <div className="col-span-2 rounded-[16px] border border-border bg-card p-4 sm:col-span-1">
          <p className="text-[11px] text-muted-foreground">{en ? "Creators invited" : "已邀请人数"}</p>
          <p className="mt-1 font-display text-xl font-extrabold text-foreground">{fmt(data.invitedCount)}</p>
        </div>
      </div>

      {/* ---------------- 邀请奖励 ---------------- */}
      <section className="mt-4 overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="flex items-start gap-3 border-b border-border bg-secondary/30 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-accent/12 text-accent">
            <Gift className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-bold text-foreground">
              {en ? `Invite a creator — you both get ${data.invitePoints} pts` : `邀请 1 位创作者，你和 TA 各得 ${data.invitePoints} 积分`}
            </h2>
            <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
              {en
                ? "They sign up with your code and both sides are credited automatically — once per new account."
                : "对方用你的邀请码注册成功后，双方积分都自动到账；每个新账号只算一次。"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <p className="label mb-1.5">{en ? "Invite code" : "你的邀请码"}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[10px] border border-border bg-secondary/50 px-3 py-2 font-mono text-[15px] font-bold tracking-[0.14em] text-foreground">
                {data.code || "—"}
              </code>
              <button
                type="button"
                onClick={() => void copy("code")}
                className="btn btn-outline !h-9 shrink-0 gap-1.5 px-3 text-xs"
              >
                {copied === "code" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === "code" ? (en ? "Copied" : "已复制") : en ? "Copy" : "复制"}
              </button>
            </div>
          </div>
          <div className="sm:w-[210px]">
            <p className="label mb-1.5">{en ? "Invite link" : "邀请链接"}</p>
            <button type="button" onClick={() => void copy("link")} className="btn btn-accent !h-9 w-full gap-1.5 px-3 text-xs">
              {copied === "link" ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
              {copied === "link" ? (en ? "Link copied" : "链接已复制") : en ? "Copy invite link" : "复制邀请链接"}
            </button>
          </div>
        </div>

        {invitedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3.5">
            <span className="text-[11.5px] text-muted-foreground">{en ? "Invited" : "已邀请"}</span>
            {invitedRows.slice(0, 8).map((it) => (
              <a
                key={it.login + it.at}
                href={p(`/world/?u=${encodeURIComponent(it.login)}`, locale)}
                className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11.5px] text-foreground/80 hover:border-accent/40 hover:text-accent"
              >
                @{it.login}
              </a>
            ))}
            {data.invitedCount > 8 && (
              <span className="text-[11.5px] text-muted-foreground">{en ? `+${data.invitedCount - 8} more` : `等 ${data.invitedCount} 人`}</span>
            )}
          </div>
        )}

        <div className="border-t border-border px-5 py-3">
          <a href={p("/join/", locale)} className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
            {en ? "Open the creator program" : "了解全球创作者计划"}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </section>

      {/* ---------------- 明细 ---------------- */}
      <section className="mt-4 overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-display text-[15px] font-bold text-foreground">{en ? "Points activity" : "积分明细"}</h2>
          <span className="text-[11px] text-muted-foreground">{en ? "Latest 50" : "最近 50 条"}</span>
        </div>
        {ledgerRows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <ShieldCheck className="mx-auto h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-2.5 text-[13px] font-medium text-foreground/70">{en ? "No activity yet" : "还没有积分记录"}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {en ? "Invite your first creator — 100 points will show up here." : "邀请第一位创作者，100 积分就会出现在这里。"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {ledgerRows.map((it: WalletLedgerItem) => (
              <li key={it.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{it.note || ledgerLabel(it.type, en)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {ledgerLabel(it.type, en)} · {dayText(it.at, en)}
                  </p>
                </div>
                <span className={`shrink-0 font-display text-[14px] font-extrabold ${it.amount >= 0 ? "text-success" : "text-destructive"}`}>
                  {it.amount >= 0 ? "+" : ""}
                  {fmt(it.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 text-center text-[11.5px] leading-5 text-muted-foreground">
        {en
          ? "Points live on SolHub's backend. Each new account credits 100 to both sides, once; self-invites and duplicate emails are rejected."
          : "积分记在 SolHub 自己的后端：每个新账号给双方各 100，只发一次；自邀与重复邮箱都会被拒绝。"}
      </p>
    </div>
  );
}
