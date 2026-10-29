/**
 * SolHub 认证客户端（浏览器端专用）。
 * 对接 Cloudflare Worker 认证服务：邮箱+密码（自托管）与 GitHub OAuth 双通道。
 * 会话凭据保存在 Worker 域下的 HttpOnly Cookie 中，前端不接触任何令牌。
 */

const API_BASE =
  (import.meta.env.PUBLIC_SOLHUB_API as string | undefined) ||
  "https://solhub-auth.solyoung.top";

export interface AuthUser {
  login: string;
  email?: string;
  avatar_url?: string;
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
  authType?: "email" | "github";
}

function base(): string {
  return API_BASE.replace(/\/$/, "");
}

/** 获取当前登录用户；未登录返回 null。 */
export async function fetchMe(): Promise<AuthUser | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`${base()}/me`, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export interface AuthResult {
  ok: boolean;
  user?: AuthUser;
  error?: string;
}

/** 邮箱 + 密码注册（成功即自动登录）。 */
export async function registerEmail(email: string, password: string, displayName?: string): Promise<AuthResult> {
  try {
    const res = await fetch(`${base()}/auth/register`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName: displayName || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `注册失败（${res.status}）` };
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/** 邮箱 + 密码登录。 */
export async function loginEmail(email: string, password: string): Promise<AuthResult> {
  try {
    const res = await fetch(`${base()}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `登录失败（${res.status}）` };
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/** 退出登录（清除会话 Cookie）。 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${base()}/auth/logout`, { method: "POST", credentials: "include" });
  } catch {
    /* 忽略网络错误 */
  }
}

/** 保存个人资料（昵称 / 简介 / 城市 / 网站）。 */
export async function saveProfile(fields: Partial<Pick<AuthUser, "displayName" | "bio" | "location" | "website">>): Promise<{ ok: boolean; error?: string; user?: Partial<AuthUser> }> {
  try {
    const res = await fetch(`${base()}/profile`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `保存失败（${res.status}）` };
    return { ok: true, user: data };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}
