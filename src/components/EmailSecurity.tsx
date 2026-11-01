import { useState } from "react";
import { Check, Loader2, Mail, ShieldAlert, ShieldCheck } from "lucide-react";
import VerifyCodeField from "@/components/VerifyCodeField";
import { changeEmail, verifyEmail } from "@/lib/auth";
import { p } from "@/lib/paths";

/**
 * 邮箱安全卡片：展示当前邮箱与验证状态，支持
 *   1) 验证「当前邮箱」（发码 → 校验）
 *   2) 更换邮箱（发码到新邮箱 → 校验通过后才切换）
 */
export default function EmailSecurity({
  email,
  verified,
  locale = "zh",
  onChanged,
}: {
  email: string;
  verified: boolean;
  locale?: "zh" | "en";
  onChanged: (email: string) => void;
}) {
  const en = locale === "en";
  const [mode, setMode] = useState<"none" | "verify" | "change">("none");
  const [code, setCode] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const reset = () => {
    setMode("none");
    setCode("");
    setNewEmail("");
    setErr(null);
  };

  const submitVerify = async () => {
    if (code.length !== 6) {
      setErr(en ? "Please enter the 6-digit code." : "请输入 6 位验证码。");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await verifyEmail(code);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || (en ? "Verification failed." : "验证失败。"));
      return;
    }
    setOk(en ? "Your email is now verified." : "邮箱验证完成。");
    reset();
    onChanged(email);
  };

  const submitChange = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setErr(en ? "Please enter a valid email address." : "请输入正确的邮箱地址。");
      return;
    }
    if (code.length !== 6) {
      setErr(en ? "Please enter the 6-digit code." : "请输入 6 位验证码。");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await changeEmail(newEmail.trim(), code);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || (en ? "Could not change your email." : "更换邮箱失败。"));
      return;
    }
    setOk(en ? "Email updated. A notice was sent to your old address." : "邮箱已更换，旧邮箱会收到一条变更通知。");
    reset();
    onChanged(r.email || newEmail.trim());
  };

  return (
    <div className="border-t border-border px-5 py-5 sm:px-7">
      <p className="text-sm font-bold text-foreground">{en ? "Email security" : "邮箱安全"}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">{email}</span>
        {verified ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {en ? "Verified" : "已验证"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" /> {en ? "Not verified" : "未验证"}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        {en
          ? "Your email is never shown publicly unless you turn it on. Verifying it lets you publish the address with a Verified badge."
          : "邮箱默认不公开；只有你主动开启才会展示在主页上。完成验证后即可公开邮箱，并显示「已验证」标识。"}
      </p>

      {mode === "none" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!verified && (
            <button
              type="button"
              onClick={() => { setMode("verify"); setErr(null); setOk(null); }}
              className="btn btn-outline !h-8 gap-1.5 px-4 text-xs"
            >
              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {en ? "Verify email" : "验证邮箱"}
            </button>
          )}
          <button
            type="button"
            onClick={() => { setMode("change"); setErr(null); setOk(null); }}
            className="btn btn-outline !h-8 px-4 text-xs"
          >
            {en ? "Change email" : "更换邮箱"}
          </button>
          <a
            href={p("/forgot-password/", locale)}
            className="btn btn-ghost !h-8 px-4 text-xs text-muted-foreground"
          >
            {en ? "Forgot password?" : "忘记密码？"}
          </a>
        </div>
      )}

      {mode === "verify" && (
        <div className="mt-4 space-y-3">
          <VerifyCodeField
            email={email}
            purpose="verify"
            code={code}
            onCodeChange={setCode}
            onError={setErr}
            locale={locale}
            label={en ? `Code sent to ${email}` : `验证码已发送至 ${email}`}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void submitVerify()} disabled={busy} className="btn btn-accent !h-8 gap-1.5 px-4 text-xs">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {en ? "Confirm" : "确认验证"}
            </button>
            <button type="button" onClick={reset} className="btn btn-outline !h-8 px-4 text-xs">
              {en ? "Cancel" : "取消"}
            </button>
          </div>
        </div>
      )}

      {mode === "change" && (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">{en ? "New email" : "新邮箱"}</span>
            <div className="relative mt-1.5">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="email"
                value={newEmail}
                onChange={(e) => { setNewEmail(e.target.value); setCode(""); setErr(null); }}
                placeholder="you@example.com"
                autoComplete="email"
                className="input !h-11 !pl-9"
              />
            </div>
          </label>
          <VerifyCodeField
            email={newEmail}
            purpose="change"
            code={code}
            onCodeChange={setCode}
            onError={setErr}
            locale={locale}
            label={en ? "Code sent to your new email" : "验证码将发送到新邮箱"}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void submitChange()} disabled={busy} className="btn btn-accent !h-8 gap-1.5 px-4 text-xs">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {en ? "Save new email" : "确认更换"}
            </button>
            <button type="button" onClick={reset} className="btn btn-outline !h-8 px-4 text-xs">
              {en ? "Cancel" : "取消"}
            </button>
          </div>
        </div>
      )}

      {err && <p className="mt-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{err}</p>}
      {ok && <p className="mt-3 rounded-[8px] bg-accent/10 px-3 py-2 text-xs text-accent" role="status">{ok}</p>}
    </div>
  );
}
