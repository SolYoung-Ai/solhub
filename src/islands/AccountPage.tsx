import { Component, useEffect, useState } from "react";
import { Loader2, LogIn, Pencil, ShieldCheck, User } from "lucide-react";
import AccountPanel from "@/components/AccountPanel";
import { avatarOf, fetchMeState, type AuthUser } from "@/lib/auth";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/* ---------- 错误兜底 ---------- */

class PageErrorBoundary extends Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <div className="py-20 text-center">
          <p className="text-sm font-bold text-foreground">页面出错了</p>
          <p className="mt-2 text-xs text-muted-foreground">{this.state.err.message || "未知错误"}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-outline mt-4 !h-9 px-4 text-xs">
            刷新页面重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AccountPageWithBoundary({ locale = "zh" }: { locale?: Locale }) {
  return (
    <PageErrorBoundary>
      <AccountPage locale={locale} />
    </PageErrorBoundary>
  );
}

function AccountPage({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { user: me, failed } = await fetchMeState();
        /* 网络失败 ≠ 未登录：单独标记，页面上给出可重试的提示 */
        if (failed) setLoadFailed(true);
        setUser(me);
      } catch {
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {en ? "Loading…" : "加载中…"}
      </div>
    );
  }

  /* 未登录：引导去登录（带 next 回跳） */
  if (!user) {
    return (
      <div className="py-20 text-center">
        <LogIn className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-sm text-muted-foreground">
          {en ? "Log in to manage your account info." : "登录后即可管理你的账号信息。"}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <a
            href={p("/login/?next=" + encodeURIComponent("/account/"), locale)}
            className="btn btn-accent !h-10 px-5"
          >
            {en ? "Log in / Sign up" : "登录 / 注册"}
          </a>
          <a href={p("/my-submissions/", locale)} className="btn btn-outline !h-10 px-5">
            {en ? "My profile" : "个人主页"}
          </a>
        </div>
        {loadFailed && (
          <p className="mt-4 text-xs text-destructive">
            {en ? "Network error. Try refreshing." : "网络异常，请尝试刷新。"}
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          {en
            ? "Email + password sign-in. Your session is stored in a secure cookie."
            : "使用邮箱 + 密码登录；会话保存在安全的 Cookie 中。"}
        </p>
      </div>
    );
  }

  const avatar = avatarOf(user);
  const displayName = user.displayName || user.login;
  const handle = user.handle || user.login;

  return (
    <div className="pb-10">
      {/* 身份卡：这是谁的账号（只读概览，编辑公开资料请去个人主页） */}
      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        <div className="flex items-center gap-4 px-5 py-5 sm:px-7">
          {avatar ? (
            <img src={avatar} alt="" className="h-16 w-16 shrink-0 rounded-full border border-border object-cover" />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-secondary">
              <User className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-display text-lg font-extrabold tracking-tight text-foreground">
                {displayName}
              </h1>
              {user.isAdmin && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
                  <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" /> {en ? "Admin" : "管理员"}
                </span>
              )}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
              <span className="font-medium text-accent">@{handle}</span>
              {user.email && <span className="truncate">{user.email}</span>}
              {user.emailVerified && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
                  <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                  {en ? "Verified" : "已验证"}
                </span>
              )}
            </p>
          </div>
          <a
            href={p("/my-submissions/", locale)}
            className="btn btn-outline !h-8 shrink-0 gap-1.5 px-4 text-xs"
          >
            <Pencil className="h-3 w-3" /> {en ? "Edit profile" : "编辑资料"}
          </a>
        </div>
      </div>

      {/* 账号安全：登录邮箱 / 密码 / 注销账号 */}
      <div className="mt-6">
        <AccountPanel
          email={user.email || ""}
          verified={!!user.emailVerified}
          locale={locale}
          onEmailChanged={(next) =>
            setUser((u) => (u ? { ...u, email: next, emailVerified: true } : u))
          }
        />
      </div>
    </div>
  );
}
