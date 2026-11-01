import { useEffect, useRef, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { sendVerifyCode, type VerifyPurpose } from "@/lib/auth";

/**
 * 邮箱验证码输入 + 「获取验证码」按钮（含倒计时）。
 * 注册 / 验证当前邮箱 / 更换邮箱 / 找回密码 四个场景共用。
 */
export default function VerifyCodeField({
  email,
  purpose,
  code,
  onCodeChange,
  onError,
  locale = "zh",
  label,
  optional = false,
}: {
  email: string;
  purpose: VerifyPurpose;
  code: string;
  onCodeChange: (v: string) => void;
  onError?: (msg: string | null) => void;
  locale?: "zh" | "en";
  label?: string;
  /** 验证码是否可选（注册场景：不填也能注册，之后可补验） */
  optional?: boolean;
}) {
  const en = locale === "en";
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const startCountdown = (sec: number) => {
    setLeft(sec);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  };

  const send = async () => {
    if (busy || left > 0) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      onError?.(en ? "Please enter a valid email address first." : "请先填写正确的邮箱地址。");
      return;
    }
    setBusy(true);
    const r = await sendVerifyCode(email.trim(), purpose);
    setBusy(false);
    if (!r.ok) {
      onError?.(r.error || (en ? "Could not send the code." : "验证码发送失败。"));
      return;
    }
    onError?.(null);
    setSent(true);
    startCountdown(r.cooldown || 60);
  };

  return (
    <div>
      <span className="label">
        {label || (optional
          ? (en ? "Email verification code (optional)" : "邮箱验证码（可选）")
          : (en ? "Email verification code" : "邮箱验证码"))}
      </span>
      <div className="mt-1.5 flex gap-2">
        <div className="relative flex-1">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            value={code}
            onChange={(e) => {
              onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6));
              onError?.(null);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={en ? "6-digit code" : "6 位验证码"}
            className="input !h-11 !pl-9 tracking-[0.3em]"
          />
        </div>
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || left > 0}
          className="btn btn-outline !h-11 shrink-0 gap-1.5 px-4 text-xs"
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {en ? "Sending" : "发送中"}
            </>
          ) : left > 0 ? (
            `${left}s`
          ) : (
            (en ? "Send code" : "获取验证码")
          )}
        </button>
      </div>
      <p className="mt-1 block text-[11px] text-muted-foreground">
        {sent
          ? en
            ? "Code sent — it expires in 10 minutes. Don't forget to check the spam folder."
            : "验证码已发送，10 分钟内有效。没收到的话记得看一眼垃圾箱。"
          : optional
            ? en
              ? "We'll email a 6-digit code to this address. You can skip it and verify later in My Account."
              : "我们会向该邮箱发送 6 位验证码；不想现在验证也可以留空，之后在「个人中心」随时补验。"
            : en
              ? "We'll email a 6-digit code to this address."
              : "我们会向该邮箱发送 6 位验证码。"}
      </p>
    </div>
  );
}
