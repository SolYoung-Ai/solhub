import { useState, useRef } from "react";
import { Loader2, Mail, Lock, User, X, LogIn, UserPlus } from "lucide-react";
import { loginEmail, registerEmail } from "@/lib/auth";
import type { Locale } from "@/i18n";

/**
 * 登录 / 注册弹窗：邮箱 + 密码双 Tab。
 * 成功后刷新页面，让 Header 与个人中心拿到新会话。
 */
export default function AuthDialog({ locale = "zh", onClose }: { locale?: Locale; onClose: () => void }) {
  const en = locale === "en";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const validate = (): string | null => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      // 邮箱框如果在视口外（小屏被裁切），强制滚回可见区域
      emailRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => emailRef.current?.focus(), 200);
      return en ? "Please enter a valid email address." : "请输入正确的邮箱地址。";
    }
    if (password.length < 8) {
      return en ? "Password must be at least 8 characters." : "密码至少 8 位。";
    }
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setBusy(true);
    setError(null);
    const result = mode === "login"
      ? await loginEmail(email.trim(), password)
      : await registerEmail(email.trim(), password, displayName.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error || (en ? "Something went wrong." : "操作失败，请重试。"));
      return;
    }
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 animate-fade-in" role="dialog" aria-modal="true" aria-label={en ? "Authentication" : "登录 / 注册"}>
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      {/* 整层可滚动：内容再高也不会把顶部（邮箱框）裁出屏幕 */}
      <div className="absolute inset-0 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full items-center justify-center px-4 py-6">
          <div className="animate-dialog-in relative w-full max-w-sm rounded-[10px] border border-border bg-card p-5 shadow-xl">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label={en ? "Close" : "关闭"}
            >
              <X className="h-4 w-4" />
            </button>

            {/* Tab 切换 */}
            <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-[8px] border border-border bg-secondary/50 p-1">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                onClick={() => { setMode("login"); setError(null); }}
                className={`flex items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-[13px] font-medium transition-colors ${
                  mode === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                {en ? "Log in" : "登录"}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                onClick={() => { setMode("register"); setError(null); }}
                className={`flex items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-[13px] font-medium transition-colors ${
                  mode === "register" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                {en ? "Sign up" : "注册"}
              </button>
            </div>

            <form
              className="space-y-3.5"
              onSubmit={(e) => { e.preventDefault(); void submit(); }}
              noValidate
            >
              {mode === "register" && (
                <label className="block">
                  <span className="label">{en ? "Display name (optional)" : "昵称（可选）"}</span>
                  <div className="relative mt-1">
                    <User className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={40}
                      placeholder={en ? "Your name" : "你的名字"}
                      className="input !pl-8"
                    />
                  </div>
                </label>
              )}

              <label className="block">
                <span className="label">{en ? "Email" : "邮箱"}</span>
                <div className="relative mt-1">
                  <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    ref={emailRef}
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    className="input !pl-8"
                    required
                  />
                </div>
              </label>

              <label className="block">
                <span className="label">{en ? "Password" : "密码"}</span>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder={en ? "At least 8 characters" : "至少 8 位"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    className="input !pl-8"
                    required
                  />
                </div>
              </label>

              {error && (
                <p className="rounded-[8px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{error}</p>
              )}

              <button type="submit" disabled={busy} className="btn btn-accent !h-10 w-full justify-center">
                {busy ? (
                  <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {en ? "Working…" : "处理中…"}</>
                ) : mode === "login" ? (
                  en ? "Log in" : "登录"
                ) : (
                  en ? "Create account" : "创建账号"
                )}
              </button>

              {mode === "register" && (
                <p className="text-center text-[11px] leading-5 text-muted-foreground">
                  {en
                    ? "Your session is stored in a secure HttpOnly cookie. Passwords are hashed with PBKDF2."
                    : "会话保存在安全的 HttpOnly Cookie 中；密码经 PBKDF2 加密存储，任何人（包括我们）都无法查看原文。"}
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
