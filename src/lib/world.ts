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

export interface WorldPost {
  id: string;
  author: string;
  authorName: string;
  authorAvatar?: string;
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
    joinedAt?: string;
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
