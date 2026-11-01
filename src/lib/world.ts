/**
 * 「世界」社交模块客户端（浏览器侧）。
 * 帖子、点赞、评论、关注全部走认证 Worker，数据存 KV，不写仓库。
 */

const API_BASE =
  (import.meta.env.PUBLIC_SOLHUB_API as string | undefined) ||
  "https://solhub-auth.solyoung.top";

function base(): string {
  return API_BASE.replace(/\/$/, "");
}

/**
 * 官方账号：用于发布产品更新日志（新品上架与每日推荐）。
 * 公开标识就是 handle @solhub；历史帖子可能仍带邮箱形态，isOfficial 两种都认。
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

export interface WorldPost {
  id: string;
  author: string;
  authorName: string;
  authorAvatar?: string;
  /** 作者黄V 认证（发帖时的快照，管理员认证后会回填） */
  authorVerified?: boolean;
  text: string;
  linkUrl?: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
}

export interface WorldComment {
  id: string;
  author: string;
  authorName: string;
  authorAvatar?: string;
  text: string;
  createdAt: string;
}

/** 用户主页里展示的产品卡片（来自社区收录数据） */
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
  postCount: number;
  productCount: number;
  isFollowing: boolean;
  isSelf: boolean;
  posts: WorldPost[];
  products: WorldProduct[];
}

export interface FollowUser {
  login: string;
  name: string;
  avatar?: string;
}

/** 搜索命中的开发者（含从未发帖、只注册过的账号） */
export interface SearchUser {
  login: string;
  name: string;
  avatar?: string;
  bio?: string;
  website?: string;
  joinedAt?: string;
  verified?: boolean;
}

export interface SearchResult {
  users: SearchUser[];
  posts: WorldPost[];
}

async function getJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${base()}${path}`, { credentials: "include", cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export async function fetchFeed(opts: { tab?: "latest" | "following"; author?: string; limit?: number } = {}): Promise<WorldPost[]> {
  const q = new URLSearchParams();
  if (opts.tab) q.set("tab", opts.tab);
  if (opts.author) q.set("author", opts.author);
  if (opts.limit) q.set("limit", String(opts.limit));
  const data = await getJSON<{ posts: WorldPost[] }>(`/world?${q.toString()}`, { posts: [] });
  return Array.isArray(data.posts) ? data.posts : [];
}

export async function createPost(input: { text: string; linkUrl?: string }): Promise<{ ok: boolean; error?: string; post?: WorldPost }> {
  try {
    const res = await fetch(`${base()}/world/posts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `发布失败（${res.status}）` };
    return { ok: true, post: data.post };
  } catch {
    return { ok: false, error: "网络错误，请稍后重试。" };
  }
}

export async function deletePost(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${base()}/world/posts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `删除失败（${res.status}）` };
    return { ok: true };
  } catch {
    return { ok: false, error: "网络错误，请稍后重试。" };
  }
}

export async function toggleLike(id: string): Promise<{ ok: boolean; liked?: boolean; likeCount?: number; error?: string }> {
  try {
    const res = await fetch(`${base()}/world/posts/${encodeURIComponent(id)}/like`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error };
    return { ok: true, liked: data.liked, likeCount: data.likeCount };
  } catch {
    return { ok: false, error: "网络错误" };
  }
}

export async function fetchComments(id: string): Promise<WorldComment[]> {
  const data = await getJSON<{ comments: WorldComment[] }>(`/world/posts/${encodeURIComponent(id)}/comments`, { comments: [] });
  return Array.isArray(data.comments) ? data.comments : [];
}

export async function addComment(id: string, text: string): Promise<{ ok: boolean; error?: string; comment?: WorldComment }> {
  try {
    const res = await fetch(`${base()}/world/posts/${encodeURIComponent(id)}/comments`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `评论失败（${res.status}）` };
    return { ok: true, comment: data.comment };
  } catch {
    return { ok: false, error: "网络错误，请稍后重试。" };
  }
}

export async function fetchProfile(login: string): Promise<PublicProfile | null> {
  try {
    const res = await fetch(`${base()}/users/${encodeURIComponent(login)}`, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PublicProfile;
  } catch {
    return null;
  }
}

export async function toggleFollow(login: string): Promise<{ ok: boolean; following?: boolean; followerCount?: number; error?: string }> {
  try {
    const res = await fetch(`${base()}/users/${encodeURIComponent(login)}/follow`, {
      method: "POST",
      credentials: "include",
    });
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

/**
 * 全站搜索（服务端）：开发者（所有注册账号）+ 帖子（全量信息流）。
 * Worker 端 /search 会遍历 KV 里的用户记录与帖子，不限于当前已加载的信息流。
 */
export async function searchWorld(query: string, limit = 20): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { users: [], posts: [] };
  const params = new URLSearchParams({ q, limit: String(limit) });
  const empty: SearchResult = { users: [], posts: [] };
  try {
    const res = await fetch(`${base()}/search?${params.toString()}`, { credentials: "include", cache: "no-store" });
    if (!res.ok) return empty;
    const data = (await res.json()) as Partial<SearchResult>;
    return {
      users: Array.isArray(data.users) ? data.users : [],
      posts: Array.isArray(data.posts) ? data.posts : [],
    };
  } catch {
    return empty;
  }
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 10月3日 */
export function timeAgo(iso: string, locale: "zh" | "en" = "zh"): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return locale === "en" ? "just now" : "刚刚";
  if (min < 60) return locale === "en" ? `${min}m` : `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === "en" ? `${hr}h` : `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return locale === "en" ? `${day}d` : `${day} 天前`;
  const d = new Date(t);
  return locale === "en"
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 从链接取主域名，用于卡片展示 */
export function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}
