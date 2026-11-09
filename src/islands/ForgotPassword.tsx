import { useState } from "react";
import { ArrowRight, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import VerifyCodeField from "@/components/VerifyCodeField";
import { requestPasswordReset, resetPassword } from "@/lib/auth";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/**
 * 找回密码：两步
 *   1) 填邮箱 → 请求验证码
 *   2) 填验证码 + 新密码 → 重置（重置后旧会话全部失效）
 * 为了不泄露账号是否存在，第 1 步无论邮箱是否注册都返回同样的提示。
 */
export default function ForgotPassword({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const requestCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(en ? "Please enter a valid email address." : "请输入正确的邮箱地址。");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await requestPasswordReset(email.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.error || (en ? "Could not send the code." : "验证码发送失败。"));
      return;
    }
    setNotice(r.message || (en ? "If the address is registered, we've sent a code." : "如果该邮箱已注册，我们会发送验证码。"));
    setStage("code");
  };

  const submit = async () => {
    if (code.length !== 6) {
      setError(en ? "Please enter the 6-digit code." : "请输入 6 位验证码。");
      return;
    }
    if (password.length < 8) {
      setError(en ? "Password must be at least 8 characters." : "密码至少 8 位。");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await resetPassword(email.trim(), code, password);
    setBusy(false);
    if (!r.ok) {
      setError(r.error || (en ? "Could not reset your password." : "重置失败。"));
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="mx-auto w-full max-w-md rounded-[16px] border border-border bg-card p-6 shadow-sm sm:p-8">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-xl font-extrabold tracking-tight text-foreground">
          {en ? "Password updated" : "密码已重置"}
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          {en
            ? "You can now log in with your new password. For your security, all other sessions were signed out."
            : "现在可以用新密码登录了。为安全起见，你其他设备上的登录状态都已失效。"}
        </p>
        <a href={p("/login/", locale)} className="btn btn-accent mt-6 !h-10 w-full justify-center gap-1.5 text-sm">
          {en ? "Go to log in" : "去登录"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-[16px] border border-border bg-card p-6 shadow-sm sm:p-8">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <KeyRound className="h-5 w-5" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-xl font-extrabold tracking-tight text-foreground">
        {en ? "Reset your password" : "找回密码"}
      </h1>
      <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
        {en
          ? "We'll email you a 6-digit code. Use it to set a new password."
          : "我们会给你发一封带 6 位验证码的邮件，用它来设置新密码。"}
      </p>

      <div className="mt-5 space-y-4">
        <label className="block">
          <span className="label">{en ? "Email" : "邮箱"}</span>
          <div className="relative mt-1.5">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              className="input !h-11 !pl-9"
            />
          </div>
        </label>

        {stage === "email" ? (
          <>
            <button
              type="button"
              onClick={() => void requestCode()}
              disabled={busy}
              className="btn btn-accent !h-11 w-full justify-center gap-1.5 text-sm"
            >
              {busy ? (
                <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {en ? "Sending…" : "发送中…"}</>
              ) : (
                <>{en ? "Send code" : "发送验证码"}</>
              )}
            </button>
            {notice && (
              <p className="rounded-[8px] bg-accent/10 px-3 py-2.5 text-[13px] leading-6 text-accent" role="status">{notice}</p>
            )}
          </>
        ) : (
          <>
            <VerifyCodeField
              email={email}
              purpose="reset"
              code={code}
              onCodeChange={setCode}
              onError={setError}
              locale={locale}
            />
            <label className="block">
              <span className="label">{en ? "New password" : "新密码"}</span>
              <div className="relative mt-1.5">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder={en ? "At least 8 characters" : "至少 8 位"}
                  autoComplete="new-password"
                  className="input !h-11 !pl-9"
                />
              </div>
            </label>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="btn btn-accent !h-11 w-full justify-center gap-1.5 text-sm"
            >
              {busy ? (
                <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {en ? "Working…" : "处理中…"}</>
              ) : (
                <>{en ? "Set new password" : "设置新密码"} <ArrowRight className="h-4 w-4" aria-hidden="true" /></>
              )}
            </button>
          </>
        )}

        {error && (
          <p className="rounded-[8px] bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive" role="alert">{error}</p>
        )}

        <p className="text-center text-xs text-muted-foreground">
          <a href={p("/login/", locale)} className="hover:text-foreground hover:underline">
            {en ? "Back to log in" : "返回登录"}
          </a>
        </p>
      </div>
    </div>
  );
}
