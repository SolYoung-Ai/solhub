import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Pencil,
  ShieldCheck,
  User,
  UserPlus,
  Zap,
} from "lucide-react";
import { loginEmail, registerEmail } from "@/lib/auth";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/**
 * 独立登录 / 注册页面（替代小弹窗）。
 * 左侧：登录后能做什么；右侧：邮箱 + 密码表单（登录 / 注册双 Tab）。
 * 支持 ?next= 相对路径登录后回跳。
 */
export default function AuthPage({ locale = "zh", next = "" }: { locale?: Locale; next?: string }) {
  const en = locale === "en";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("next");
    if (q && q.startsWith("/") && !q.startsWith("//")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("next");
      window.history.replaceState(null, "", url.pathname + url.search);
      window.sessionStorage.setItem("solhub:next", q);
    }
  }, []);

  const safeNext = (): string => {
    try {
      const n = window.sessionStorage.getItem("solhub:next") || next || "";
      window.sessionStorage.removeItem("solhub:next");
      if (n.startsWith("/") && !n.startsWith("//")) return p(n, locale);
    } catch { /* ignore */ }
    return p("/my-submissions/", locale);
  };

  const validate = (): string | null => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
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
    window.location.href = safeNext();
  };

  const benefits: { icon: ReactNode; title: string; desc: string }[] = [
    {
      icon: <Zap className="h-4 w-4" aria-hidden="true" />,
      title: en ? "One-click publishing" : "提交即上线",
      desc: en
        ? "Submit while logged in — if your link opens, the product goes live on the community list instantly."
        : "登录后提交，官网链接可正常打开即自动收录上线，无需等待审核。",
    },
    {
      icon: <Pencil className="h-4 w-4" aria-hidden="true" />,
      title: en ? "Manage anytime" : "随时管理",
      desc: en
        ? "Edit or delete your published products whenever you want from My Account."
        : "在「个人中心」随时编辑或删除已收录的产品与工具。",
    },
    {
      icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
      title: en ? "Auto verification" : "自动核验",
      desc: en
        ? "Link reachability is checked automatically at submit time — no waiting for manual review."
        : "提交时自动检测链接可达性，通过即上线，无需等待人工核验。",
    },
    {
      icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
      title: en ? "Your creator profile" : "个人创作者主页",
      desc: en
        ? "Set a display name, bio and website so users know who built the product."
        : "设置昵称、简介与个人网站，让用户了解产品背后的创作者。",
    },
  ];

  return (
    <div className="container-page py-10 sm:py-16">
      <div className="mx-auto grid w-full max-w-4xl items-stretch gap-8 lg:grid-cols-[1fr_400px] lg:gap-12">
        {/* 左侧：登录后能做什么 */}
        <div className="order-2 lg:order-1">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
            {en ? "SolHub Account" : "SolHub 账号"}
          </p>
          <h2 className="mt-2 font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            {en ? "One account, everything managed" : "一个账号，管理你在 SolHub 的一切"}
          </h2>
          <ul className="mt-6 space-y-5">
            {benefits.map((b) => (
              <li key={b.title} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent/10 text-accent">
                  {b.icon}
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">{b.title}</p>
                  <p className="mt-0.5 text-[13px] leading-6 text-muted-foreground">{b.desc}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-8 rounded-[8px] border border-dashed border-border bg-secondary/40 p-4 text-xs leading-6 text-muted-foreground">
            {en
              ? "Sessions are stored in secure HttpOnly cookies; passwords are hashed with PBKDF2 (100k iterations). We can never see your password."
              : "会话保存在安全的 HttpOnly Cookie 中；密码经 PBKDF2（10 万次迭代）加盐哈希存储，任何人（包括我们）都无法查看原文。"}
          </p>
        </div>

        {/* 右侧：表单卡片 */}
        <div className="order-1 lg:order-2">
          <div className="rounded-[10px] border border-border bg-card p-6 shadow-sm sm:p-8">
            {/* Tab 切换 */}
            <div role="tablist" className="mb-6 grid grid-cols-2 gap-1 rounded-[8px] border border-border bg-secondary/50 p-1">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                onClick={() => { setMode("login"); setError(null); }}
                className={`flex items-center justify-center gap-1.5 rounded-[6px] py-2 text-sm font-medium transition-colors ${
                  mode === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                {en ? "Log in" : "登录"}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                onClick={() => { setMode("register"); setError(null); }}
                className={`flex items-center justify-center gap-1.5 rounded-[6px] py-2 text-sm font-medium transition-colors ${
                  mode === "register" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <User className="h-4 w-4" aria-hidden="true" />
                {en ? "Sign up" : "注册"}
              </button>
            </div>

            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
              {mode === "register" && (
                <label className="block">
                  <span className="label">{en ? "Display name (optional)" : "昵称（可选）"}</span>
                  <div className="relative mt-1.5">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={40}
                      placeholder={en ? "Your name" : "你的名字"}
                      className="input !h-11 !pl-9"
                    />
                  </div>
                </label>
              )}

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
                    required
                  />
                </div>
              </label>

              <label className="block">
                <span className="label">{en ? "Password" : "密码"}</span>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder={en ? "At least 8 characters" : "至少 8 位"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    className="input !h-11 !pl-9 !pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPwd ? (en ? "Hide password" : "隐藏密码") : (en ? "Show password" : "显示密码")}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              {error && (
                <p className="rounded-[8px] bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive" role="alert">{error}</p>
              )}

              <button type="submit" disabled={busy} className="btn btn-accent !h-11 w-full justify-center !text-sm">
                {busy ? (
                  <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {en ? "Working…" : "处理中…"}</>
                ) : mode === "login" ? (
                  <>{en ? "Log in" : "登录"} <ArrowRight className="h-4 w-4" aria-hidden="true" /></>
                ) : (
                  <>{en ? "Create account" : "创建账号"} <ArrowRight className="h-4 w-4" aria-hidden="true" /></>
                )}
              </button>

              <p className="text-center text-xs leading-6 text-muted-foreground">
                {mode === "login" ? (
                  en
                    ? "No account yet? Switch to Sign up above — it takes 10 seconds."
                    : "还没有账号？切换到上方「注册」，10 秒即可创建。"
                ) : (
                  en
                    ? "Already have an account? Switch to Log in above."
                    : "已有账号？切换到上方「登录」即可。"
                )}
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
