import { useEffect, useState } from "react";
import { ArrowRight, Gift, Loader2, Lock, Mail, User } from "lucide-react";
import { loginEmail, registerEmail } from "@/lib/auth";
import { REF_STORE_KEY, resolveInviter } from "@/lib/wallet";
import { NET_ERROR } from "@/lib/net";
import type { Locale } from "@/i18n";

/**
 * 邀请落地页的注册卡
 * ------------------
 * 被邀请人从 ?ref= 进来，这里只做一件事：让他注册，并明确「你和 TA 各得 100 积分」。
 * 注册成功后带着这 100 分直接落到 /wallet/，不用再解释钱在哪。
 */

interface Props {
  locale?: Locale;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HANDLE_RE = /^[a-z][a-z0-9_]{2,19}$/;

export default function JoinSignup({ locale = "zh" }: Props) {
  const en = locale === "en";
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [inviteRef, setInviteRef] = useState("");
  const [inviter, setInviter] = useState<{ login: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = (new URLSearchParams(window.location.search).get("ref") || "").trim().toUpperCase();
    let stored = "";
    try {
      stored = (localStorage.getItem(REF_STORE_KEY) || "").trim().toUpperCase();
    } catch {
      /* 私密模式 */
    }
    const code = fromUrl || stored;
    if (!code) return;
    setInviteRef(code);
    void resolveInviter(code).then((who) => {
      if (who) setInviter({ login: who.login, name: who.name });
    });
  }, []);

  const submit = async () => {
    const mail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) {
      setError(en ? "Enter a valid email." : "请输入正确的邮箱。");
      return;
    }
    if (password.length < 8) {
      setError(en ? "Password needs at least 8 characters." : "密码至少 8 位。");
      return;
    }
    if (mode === "register" && handle.trim() && !HANDLE_RE.test(handle.trim())) {
      setError(en ? "Username: 3–20 chars, starts with a letter, lowercase/numbers/underscore." : "用户名 3–20 位，字母开头，只能小写字母、数字或下划线。");
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      mode === "login"
        ? await loginEmail(mail, password)
        : await registerEmail(mail, password, displayName.trim(), handle.trim(), "", inviteRef);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || NET_ERROR);
      return;
    }
    try {
      if (inviteRef) localStorage.removeItem(REF_STORE_KEY);
    } catch {
      /* 忽略 */
    }
    window.location.href = "/wallet/";
  };

  return (
    <div className="rounded-[22px] border border-border bg-card p-5 shadow-[0_18px_40px_-30px_rgba(60,30,10,.5)] sm:p-6">
      <div className="flex items-center gap-2 rounded-[12px] bg-accent/8 px-3 py-2.5">
        <Gift className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <p className="text-[12.5px] font-medium leading-5 text-foreground/85">
          {inviter
            ? en
              ? `${inviter.name} invited you. Signing up credits you 100 points.`
              : `${inviter.name} 邀请你加入，注册成功你获得 100 积分。`
            : en
              ? "Signing up credits you 100 points — the account is enough."
              : "注册成功你获得 100 积分，账号建好就自动到账。"}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-[10px] bg-secondary/70 p-1">
        {(["register", "login"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded-[8px] py-1.5 text-[12.5px] font-medium transition-colors ${
              mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "register" ? (en ? "Sign up" : "注册") : en ? "Sign in" : "登录"}
          </button>
        ))}
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <label className="block">
          <span className="label mb-1 block">{en ? "Email" : "邮箱"}</span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input !h-10 !pl-9"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </span>
        </label>

        <label className="block">
          <span className="label mb-1 block">{en ? "Password" : "密码"}</span>
          <span className="relative block">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input !h-10 !pl-9"
              placeholder={en ? "At least 8 characters" : "至少 8 位"}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </span>
        </label>

        {mode === "register" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label mb-1 block">{en ? "Name (optional)" : "昵称（可选）"}</span>
              <span className="relative block">
                <User className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={40}
                  className="input !h-10 !pl-9"
                />
              </span>
            </label>
            <label className="block">
              <span className="label mb-1 block">{en ? "Username (optional)" : "用户名（可选）"}</span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">@</span>
                <input
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase())}
                  maxLength={20}
                  className="input !h-10 !pl-8"
                  placeholder="handle"
                />
              </span>
            </label>
          </div>
        )}

        {error && <p className="rounded-[8px] bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}

        <button type="submit" disabled={busy} className="btn btn-accent !h-11 w-full gap-1.5 text-sm disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {mode === "register" ? (en ? "Create creator account" : "注册成为创作者") : en ? "Sign in" : "登录"}
          {!busy && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </button>
      </form>

      <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
        {en ? "No credit card, one email is enough. By signing up you agree to the terms." : "不需要信用卡，一个邮箱即可。注册即表示同意站点条款。"}
      </p>
    </div>
  );
}
