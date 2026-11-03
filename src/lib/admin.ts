/**
 * 管理后台客户端（/admin/*）。
 * 所有接口都在 Worker 侧用 ADMIN_EMAILS 白名单校验，前端只是壳。
 */

import { request } from "@/lib/net";
import { base } from "@/lib/api-base";

export type AdminStatus = "unauthorized" | "forbidden" | "locked" | "ok" | "error";

export interface AdminResult<T> {
  status: AdminStatus;
  data?: T;
  error?: string;
}

/* ---------------- 管理口令 ----------------
 * 口令只存在本次浏览器会话（sessionStorage），关掉标签页即失效；
 * Worker 侧用 wrangler secret 的 ADMIN_KEY 比对，仓库里没有明文。
 */
const KEY_STORAGE = "solhub.admin.key";

/** 规整用户输入的口令，消除「看起来一样但比对失败」的隐形因素：
 *  - 去除所有空白与不可见字符（零宽空格 U+200B/C/D、不换行空格、BOM 等）
 *  - 全角 ASCII（含全角数字 ０-９）转半角，避免中文输入法敲出的全角串比对失败
 *  后端 adminKeyOk 按字符逐一比对 ASCII 码，全角与半角长度相同却字符不同，
 *  会静默判错；这里在发送前归一化，从根本上解决「输入 2944354040 却进不去」。 */
function normalizeKey(input: string): string {
  return String(input || "")
    // 不可见字符：NBSP(U+00A0)、U+2000-U+200D 各类窄空格与零宽字符、U+2060、BOM(U+FEFF)
    .replace(/[\u00a0\u2000-\u200d\u2060\ufeff]/g, "")
    // 常规空白（含首尾空格、换行、制表符）
    .replace(/\s+/g, "")
    // 全角 ASCII -> 半角（含全角数字 ０-９、全角标点）
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

export function getAdminKey(): string {
  try {
    // 读取时也归一化，防御历史会话里可能残留的全角/带不可见字符的口令
    return normalizeKey(window.sessionStorage.getItem(KEY_STORAGE) || "");
  } catch {
    return "";
  }
}

export function setAdminKey(key: string) {
  try {
    if (key) window.sessionStorage.setItem(KEY_STORAGE, key);
    else window.sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    /* 隐私模式下忽略 */
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<AdminResult<T>> {
  const key = getAdminKey();
  const headers = new Headers(init?.headers);
  if (key && !headers.has("X-Admin-Key")) headers.set("X-Admin-Key", key);
  try {
    const res = await request(`${base()}${path}`, {
      cache: "no-store",
      ...init,
      headers,
    }, { retries: 1 });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (data.needKey) return { status: "locked", error: data.error || "需要管理口令" };
      return { status: "unauthorized", error: data.error || "未登录" };
    }
    if (res.status === 403) return { status: "forbidden", error: data.error || "无权访问" };
    if (!res.ok) return { status: "error", error: data.error || `请求失败（${res.status}）` };
    return { status: "ok", data: data as T };
  } catch {
    return { status: "error", error: "网络错误，请稍后重试。" };
  }
}

/** 用口令试一次 /admin/stats：成功则记住口令。
 *  发送前先 normalizeKey 归一化（去不可见字符、全角转半角），
 *  避免中文输入法/复制粘贴带出的隐形差异导致「明明输对却判错」。 */
export async function unlockAdmin(key: string): Promise<AdminResult<AdminStats>> {
  const normalized = normalizeKey(key);
  const res = await call<AdminStats>("/admin/stats", { headers: { "X-Admin-Key": normalized } });
  if (res.status === "ok") setAdminKey(normalized);
  else if (res.status === "locked") setAdminKey("");
  return res;
}

export interface AdminStats {
  users: number;
  posts: number;
  banned: number;
  admins: string[];
  me: string;
}

export interface AdminUser {
  login: string;
  /** 公开用户名（handle）；GitHub 账号与 login 相同 */
  handle?: string;
  type: "email" | "github";
  name: string;
  avatar: string;
  bio: string;
  website: string;
  location: string;
  createdAt: string;
  verified: boolean;
  verifiedAt: string;
  banned: boolean;
  banReason: string;
  bannedAt: string;
  postCount: number;
  isAdmin: boolean;
}

export interface AdminPost {
  id: string;
  author: string;
  authorName: string;
  authorAvatar?: string;
  authorVerified?: boolean;
  text: string;
  linkUrl?: string;
  createdAt: string;
}

export interface AdminProduct {
  slug: string;
  name: string;
  shortDescription: string;
  icon: string;
  websiteUrl: string;
  category: string;
  tags: string[];
  verificationStatus: string;
  publishedAt: string;
  source: "catalog" | "community";
  submittedBy: string;
  verified: boolean;
}

export const adminStats = () => call<AdminStats>("/admin/stats");

export const adminUsers = (q = "") =>
  call<{ total: number; users: AdminUser[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const adminPosts = (q = "") =>
  call<{ total: number; posts: AdminPost[] }>(`/admin/posts${q ? `?q=${encodeURIComponent(q)}` : ""}`);

export const adminProducts = () =>
  call<{ total: number; products: AdminProduct[] }>("/admin/products");

export const adminBan = (login: string, banned: boolean, reason = "") =>
  call<{ ok: boolean }>(`/admin/users/${encodeURIComponent(login)}/ban`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ banned, reason }),
  });

export const adminVerifyUser = (login: string, verified: boolean) =>
  call<{ ok: boolean; patched: number }>(`/admin/users/${encodeURIComponent(login)}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified }),
  });

export const adminResetPassword = (login: string, password = "") =>
  call<{ ok: boolean; password: string }>(`/admin/users/${encodeURIComponent(login)}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

export const adminDeleteUser = (login: string) =>
  call<{ ok: boolean; deletedPosts: number }>(`/admin/users/${encodeURIComponent(login)}/delete`, {
    method: "DELETE",
  });

export const adminDeletePost = (id: string) =>
  call<{ ok: boolean }>(`/admin/posts/${encodeURIComponent(id)}`, { method: "DELETE" });

export const adminVerifyProduct = (slug: string, verified: boolean) =>
  call<{ ok: boolean; source: string }>(`/admin/products/${encodeURIComponent(slug)}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified }),
  });
