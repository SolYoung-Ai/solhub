/**
 * SolHub 认证客户端（浏览器端专用）。
 * 对接 Cloudflare Worker 认证服务：邮箱+密码（自托管）与 GitHub OAuth 双通道。
 * 会话凭据保存在 Worker 域下的 HttpOnly Cookie 中，前端不接触任何令牌。
 */

const API_BASE =
  (import.meta.env.PUBLIC_SOLHUB_API as string | undefined) ||
  "https://solhub-auth.solyoung.top";

export interface AuthUser {
  /** 公开标识：邮箱用户为 handle（如 solyoung），GitHub 用户为用户名 */
  login: string;
  /** 用户名（handle）：站内唯一，出现在个人主页与帖子作者里 */
  handle?: string;
  /** 登录邮箱（仅本人可见，永不公开） */
  email?: string;
  avatar_url?: string;
  /** 邮箱用户自传头像（data URL，存于认证服务） */
  avatar?: string;
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
  /** 联系方式（用户自愿公开：微信 / Telegram / 备用邮箱等），留空即不展示 */
  contact?: string;
  /** 是否在公开资料里展示注册邮箱（默认不公开） */
  emailPublic?: boolean;
  /** 邮箱是否已完成验证（验证后才允许公开邮箱） */
  emailVerified?: boolean;
  authType?: "email" | "github";
  /** 黄V 认证 */
  verified?: boolean;
  /** 管理员（由 Worker 白名单判定） */
  isAdmin?: boolean;
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

/** 邮箱 + 密码注册（成功即自动登录）。code 为邮箱验证码。 */
export async function registerEmail(
  email: string,
  password: string,
  displayName?: string,
  handle?: string,
  code?: string,
): Promise<AuthResult> {
  try {
    const res = await fetch(`${base()}/auth/register`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName: displayName || "", handle: handle || "", code: code || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `注册失败（${res.status}）` };
    return { ok: true, user: data.user };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/** 验证码用途 */
export type VerifyPurpose = "register" | "verify" | "change" | "reset";

/**
 * 请求下发邮箱验证码。
 * purpose：register 注册 / verify 验证当前邮箱 / change 验证新邮箱 / reset 找回密码。
 */
export async function sendVerifyCode(
  email: string,
  purpose: VerifyPurpose,
): Promise<{ ok: boolean; error?: string; cooldown?: number }> {
  try {
    const res = await fetch(`${base()}/auth/send-code`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `验证码发送失败（${res.status}）` };
    return { ok: true, cooldown: data.cooldown || 60 };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/** 验证「当前邮箱」归属（已登录用户）。 */
export async function verifyEmail(code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${base()}/auth/verify-email`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `验证失败（${res.status}）` };
    return { ok: true };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/** 更换登录邮箱：必须先通过新邮箱的验证码验证，服务端才会切换。 */
export async function changeEmail(
  newEmail: string,
  code: string,
): Promise<{ ok: boolean; error?: string; email?: string }> {
  try {
    const res = await fetch(`${base()}/auth/change-email`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEmail, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `更换失败（${res.status}）` };
    return { ok: true, email: data.email };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/** 找回密码：请求发送重置验证码（无论账号是否存在都返回同样结果）。 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const res = await fetch(`${base()}/auth/forgot-password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `发送失败（${res.status}）` };
    return { ok: true, message: data.message };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/** 重置密码：校验验证码后设置新密码，旧会话全部失效。 */
export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const res = await fetch(`${base()}/auth/reset-password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `重置失败（${res.status}）` };
    return { ok: true, message: data.message };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/**
 * 修改密码（登录态）：需要提供当前密码。
 * 服务端会校验当前密码，换新盐重新哈希，并把 pwdVersion +1，
 * 于是其它设备上的旧会话全部失效；当前设备会自动换发一个新会话，不会被踢下线。
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const res = await fetch(`${base()}/auth/change-password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `修改失败（${res.status}）` };
    return { ok: true, message: data.message };
  } catch {
    return { ok: false, error: "网络错误：无法连接认证服务，请稍后重试。" };
  }
}

/**
 * 注销账号（自助）：需要提供当前密码以确认身份。
 * 服务端会清除账号、公开资料、帖子、关注关系与社区提交。
 */
export async function deleteAccount(
  password: string,
): Promise<{ ok: boolean; error?: string; deletedPosts?: number }> {
  try {
    const res = await fetch(`${base()}/auth/delete-account`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `注销失败（${res.status}）` };
    return { ok: true, deletedPosts: data.deletedPosts || 0 };
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

/** 保存个人资料（昵称 / 简介 / 城市 / 网站 / 联系方式 / 邮箱公开开关 / 头像）。 */
export async function saveProfile(fields: Partial<Pick<AuthUser, "displayName" | "bio" | "location" | "website" | "avatar" | "handle" | "contact" | "emailPublic">>): Promise<{ ok: boolean; error?: string; user?: Partial<AuthUser> }> {
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
