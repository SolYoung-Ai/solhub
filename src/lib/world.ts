/**
 * 「创作者」模块客户端（浏览器侧）。
 *
 * 发帖功能已下线：这里只保留「人」相关的读写 —— 创作者名录、公开主页、关注关系。
 * 帖子 / 点赞 / 评论的接口不再被前端使用，服务端接口保留但不再有新入口。
 */

import { request } from "@/lib/net";
import { base } from "@/lib/api-base";

/**
 * 官方账号：用于产品更新日志。
 * 公开标识就是 handle @solhub；历史数据可能仍带邮箱形态，isOfficial 两种都认。
 */
export const OFFICIAL_LOGIN = "solhub";
const OFFICIAL_LEGACY = "solhub@solyoung.top";
export const OFFICIAL_NAME = "SolHub 官方";
export const OFFICIAL_WEBSITE = "https://solhub.solyoung.top";

export function isOfficial(login: string | undefined | null): boolean {
  if (!login) return false;
  const v = login.toLowerCase();
  return v === OFFICIAL_LOGIN || v === OFFICIAL_LEGACY;
}

/** 用户主页里展示的作品卡片（来自社区收录数据） */
export interface WorldProduct {
  slug: string;
  name: string;
  shortDescription: string;
  icon?: string;
  websiteUrl: string;
  category: string;
  tags: string[];
  verificationStatus: "verified" | "pending" | "unverified";
  publishedAt?: string;
}

export interface PublicProfile {
  user: {
    login: string;
    name: string;
    avatar?: string;
    bio?: string;
    location?: string;
    website?: string;
    /** 联系方式（用户自愿公开） */
    contact?: string;
    /** 注册邮箱：仅当用户本人开启「公开邮箱」时才有值 */
    email?: string;
    /** 邮箱是否已通过验证码验证（公开邮箱必须已验证） */
    emailVerified?: boolean;
    joinedAt?: string;
    /** 黄V 认证 */
    verified?: boolean;
    /** 已被封禁（主页会提示） */
    banned?: boolean;
  };
  followerCount: number;
  followingCount: number;
  productCount: number;
  isFollowing: boolean;
  isSelf: boolean;
  products: WorldProduct[];
}

export interface FollowUser {
  login: string;
  name: string;
  avatar?: string;
}

/** 创作者名录里的一行 */
export interface Creator {
  login: string;
  name: string;
  avatar?: string;
  bio?: string;
  website?: string;
  location?: string;
  joinedAt?: string;
  /** 黄V 认证 */
  verified?: boolean;
  productCount: number;
}

export interface CreatorList {
  total: number;
  counts: { all: number; verified: number; products: number };
  creators: Creator[];
  /** 还有下一页（服务端按 offset 分页，避免名录一多就只给前 N 个人） */
  hasMore?: boolean;
  nextOffset?: number;
}

export type CreatorFilter = "all" | "verified" | "products";

async function getJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await request(`${base()}${path}`, { cache: "no-store" }, { retries: 1 });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/**
 * 创作者名录（全站注册账号，不限于发过内容的）。
 * 排序由服务端定：有作品优先 → 认证优先 → 先加入优先。
 */
export async function fetchCreators(
  opts: { q?: string; filter?: CreatorFilter; limit?: number; offset?: number } = {},
): Promise<CreatorList> {
  const q = new URLSearchParams();
  if (opts.q) q.set("q", opts.q);
  if (opts.filter && opts.filter !== "all") q.set("filter", opts.filter);
  if (opts.limit) q.set("limit", String(opts.limit));
  if (opts.offset) q.set("offset", String(opts.offset));
  const empty: CreatorList = { total: 0, counts: { all: 0, verified: 0, products: 0 }, creators: [], hasMore: false };
  try {
    const res = await request(`${base()}/creators?${q.toString()}`, { cache: "no-store" }, { retries: 1 });
    if (!res.ok) return empty;
    const data = (await res.json()) as Partial<CreatorList>;
    return {
      total: Number(data.total) || 0,
      counts: {
        all: Number(data.counts?.all) || 0,
        verified: Number(data.counts?.verified) || 0,
        products: Number(data.counts?.products) || 0,
      },
      creators: Array.isArray(data.creators) ? data.creators : [],
      hasMore: !!data.hasMore,
      nextOffset: Number(data.nextOffset) || 0,
    };
  } catch {
    return empty;
  }
}

export async function fetchProfile(login: string): Promise<PublicProfile | null> {
  try {
    const res = await request(`${base()}/users/${encodeURIComponent(login)}`, { cache: "no-store" }, { retries: 1 });
    if (!res.ok) return null;
    return (await res.json()) as PublicProfile;
  } catch {
    return null;
  }
}

export async function toggleFollow(login: string): Promise<{ ok: boolean; following?: boolean; followerCount?: number; error?: string }> {
  try {
    const res = await request(`${base()}/users/${encodeURIComponent(login)}/follow`, {
      method: "POST",
    }, { retries: 0 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error };
    return { ok: true, following: data.following, followerCount: data.followerCount };
  } catch {
    return { ok: false, error: "网络错误" };
  }
}

export async function fetchFollowList(login: string, kind: "following" | "followers"): Promise<FollowUser[]> {
  const data = await getJSON<{ users: FollowUser[] }>(`/users/${encodeURIComponent(login)}/${kind}`, { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

/** 从链接取主域名，用于卡片展示 */
export function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}
