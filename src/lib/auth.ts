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
  /** 邮箱用户自传头像（data URL，存于认证服务） */
  avatar?: string;
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

/** 保存个人资料（昵称 / 简介 / 城市 / 网站 / 头像）。 */
export async function saveProfile(fields: Partial<Pick<AuthUser, "displayName" | "bio" | "location" | "website" | "avatar">>): Promise<{ ok: boolean; error?: string; user?: Partial<AuthUser> }> {
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

/** 用户头像展示地址：GitHub 用户用 avatar_url，邮箱用户用自传 avatar。 */
export function avatarOf(user: AuthUser): string | undefined {
  return user.avatar_url || user.avatar || undefined;
}

/**
 * 把图片文件压缩为正方形 data URL（客户端 canvas 缩放）。
 * 头像/图标上传前统一走这里，保证 ≤200KB。
 */
export function resizeImageToDataUrl(file: File, size = 256, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        /* 居中裁剪为正方形 */
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
