import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Gift, Loader2, LogIn, UserPlus } from "lucide-react";
import { p } from "@/lib/paths";
import { fetchMe, type AuthUser } from "@/lib/auth";
import { cachedWallet, fetchWallet, REF_STORE_KEY, resolveInviter, type WalletData } from "@/lib/wallet";
import { copyText } from "@/lib/utils";

interface Props {
  locale?: "zh" | "en";
}

/**
 * 拉新 / 邀请（v2，后端打通）
 * ---------------------------
 * - 邀请码不再是本地随机码，而是后端按账号算出来的（同一个号在哪儿都一样）；
 * - 对方用 ?ref=<code> 进来 → 码存本地（先逛后注册也不丢）→ 注册成功时后端给邀请人 +100；
 * - 本区块只负责「把码和链接给到用户 + 说清奖励规则」，积分明细在 /wallet/。
 */
export default function RecruitShare({ locale = "zh" }: Props) {
  const en = locale === "en";
  const [inviter, setInviter] = useState<{ login: string; name: string } | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(() => cachedWallet());
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<"" | "code" | "link">("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = (params.get("ref") || "").trim().toUpperCase();
    if (ref) {
      /* 先存下来：对方可能在注册前逛好几页，归因不能丢 */
      try {
        localStorage.setItem(REF_STORE_KEY, ref);
      } catch {
        /* 私密模式忽略 */
      }
      void resolveInviter(ref).then((who) => {
        if (who) setInviter({ login: who.login, name: who.name });
      });
    }
    let alive = true;
    (async () => {
      const [user, res] = await Promise.all([fetchMe().catch(() => null), fetchWallet()]);
      if (!alive) return;
      setMe(user);
      if (res.ok) setWallet(res.data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const link = useMemo(() => {
    if (wallet?.link) return wallet.link;
    return "";
  }, [wallet]);

  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? wallet?.code || "" : link;
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(what);
    window.setTimeout(() => setCopied(""), 1600);
  };

  return (
    <div>
      {inviter && (
        <div
          className="mb-4 flex items-center gap-2 rounded-[16px] border border-accent/25 bg-accent/5 px-3.5 py-2.5 text-[13px] text-foreground/80"
          role="status"
        >
          <Gift className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            {en
              ? `${inviter.name} (@${inviter.login}) invited you — sign up and they get 100 points.`
              : `${inviter.name}（@${inviter.login}）邀请你加入；用这个链接注册，TA 会得到 100 积分。`}
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {en ? "Loading your invite link…" : "正在取你的邀请链接…"}
        </div>
      ) : !me ? (
        <div className="rounded-[16px] border border-dashed border-border bg-secondary/30 px-4 py-5">
          <p className="text-[13px] font-medium text-foreground/80">
            {en ? "Sign in to get your own invite link" : "登录后才有你的专属邀请链接"}
          </p>
          <p className="mt-1 text-[12.5px] leading-6 text-muted-foreground">
            {en
              ? "Each creator gets one code. Every new account that signs up with it credits you 100 points."
              : "每位创作者一个专属邀请码；对方用它注册成功后，你得 100 积分。"}
          </p>
          <a href={p("/login/?next=/join/", locale)} className="btn btn-accent mt-3 !h-9 gap-1.5 px-4 text-xs">
            <LogIn className="h-3.5 w-3.5" /> {en ? "Sign in" : "登录领取"}
          </a>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="min-w-0">
              <p className="label mb-1.5">{en ? "Invite code" : "你的邀请码"}</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[10px] border border-border bg-secondary/50 px-3 py-2 font-mono text-[14px] font-bold tracking-[0.14em] text-foreground">
                  {wallet?.code || "—"}
                </code>
                <button type="button" onClick={() => void copy("code")} className="btn btn-outline !h-9 shrink-0 gap-1.5 px-3 text-xs">
                  {copied === "code" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === "code" ? (en ? "Copied" : "已复制") : en ? "Copy" : "复制"}
                </button>
              </div>
            </div>
            <button type="button" onClick={() => void copy("link")} className="btn btn-accent !h-10 shrink-0 gap-1.5 px-5 text-sm">
              {copied === "link" ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {copied === "link" ? (en ? "Link copied" : "链接已复制") : en ? "Copy invite link" : "复制邀请链接"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
            <span>
              {en ? "Invited " : "已邀请 "}
              <strong className="text-foreground">{wallet?.invitedCount ?? 0}</strong>
              {en ? " creators" : " 位创作者"}
            </span>
            <span>
              {en ? "Earned " : "累计获得 "}
              <strong className="text-foreground">{wallet?.earned ?? 0}</strong>
              {en ? " pts" : " 积分"}
            </span>
            <a href={p("/wallet/", locale)} className="text-accent hover:underline">
              {en ? "Open wallet →" : "打开我的钱包 →"}
            </a>
          </div>

          <p className="mt-3 text-[12.5px] leading-6 text-muted-foreground">
            {en
              ? "Every new creator who signs up with your code adds 100 points to your wallet automatically. One reward per new account — self-invites and duplicate emails are rejected."
              : "对方用你的邀请码注册成功后，100 积分自动进你的钱包；每个新账号只发一次，自邀和重复邮箱都会被拒绝。"}
          </p>
        </>
      )}
    </div>
  );
}
