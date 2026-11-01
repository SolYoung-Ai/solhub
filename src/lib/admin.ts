/**
 * 管理后台客户端（/admin/*）。
 * 所有接口都在 Worker 侧用 ADMIN_EMAILS 白名单校验，前端只是壳。
 */

const API_BASE =
  (import.meta.env.PUBLIC_SOLHUB_API as string | undefined) ||
  "https://solhub-auth.solyoung.top";

function base(): string {
  return API_BASE.replace(/\/$/, "");
}

export type AdminStatus = "unauthorized" | "forbidden" | "ok" | "error";

export interface AdminResult<T> {
  status: AdminStatus;
  data?: T;
  error?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<AdminResult<T>> {
  try {
    const res = await fetch(`${base()}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...init,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { status: "unauthorized", error: data.error || "未登录" };
    if (res.status === 403) return { status: "forbidden", error: data.error || "无权访问" };
    if (!res.ok) return { status: "error", error: data.error || `请求失败（${res.status}）` };
    return { status: "ok", data: data as T };
  } catch {
    return { status: "error", error: "网络错误，请稍后重试。" };
  }
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
