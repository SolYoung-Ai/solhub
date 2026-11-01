/**
 * SolHub Auth Service — Cloudflare Worker（无服务器账号体系）
 *
 * 双登录方式：
 *   1. 邮箱 + 密码（本 Worker 自托管）：KV 存用户，PBKDF2-SHA256 哈希密码，
 *      HttpOnly Secure 会话 Cookie（KV TTL 30 天自动过期）
 *   2. GitHub OAuth（原有通道）：solhub_token cookie
 *
 * KV 绑定 PROFILES：
 *   user:<email>      邮箱用户记录（含密码哈希与个人资料）
 *   session:<id>      会话（{email, createdAt}，30 天 TTL）
 *   profile:<login>   GitHub 用户的展示资料（兼容保留）
 *
 * 安全边界：任何密钥（GITHUB_CLIENT_SECRET / GITHUB_PAT）只存在于 Worker 环境变量，
 * 严禁返回给前端。密码哈希永不出库。
 */

const REPO = "SolYoung-Ai/solhub";
const SITE_BASE = "https://solhub.solyoung.top";
const OAUTH_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";
const SESSION_COOKIE = "solhub_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 天
const ALLOWED_ORIGINS = [
  "https://solhub.solyoung.top",
  "https://solyoung.top",
  "http://localhost:4321",
];

function corsFor(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function json(request, data, status, setCookie) {
  const headers = { "Content-Type": "application/json", ...corsFor(request) };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

function redirect(request, url, extraHeaders) {
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...corsFor(request), ...(extraHeaders || {}) },
  });
}

function readCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/* ---------------- 密码与令牌（WebCrypto） ---------------- */

function toB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hashPassword(password, saltB64) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: 100000, salt: fromB64(saltB64) },
    key, 256,
  );
  return toB64(bits);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------------- 邮箱用户与会话（KV） ---------------- */

async function createSession(request, env, email) {
  const id = crypto.randomUUID() + "-" + toB64(crypto.getRandomValues(new Uint8Array(12)));
  await env.PROFILES.put(`session:${id}`, JSON.stringify({ email, createdAt: new Date().toISOString() }), {
    expirationTtl: SESSION_TTL,
  });
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_TTL}`;
}

async function getSessionUser(request, env) {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id) return null;
  const raw = await env.PROFILES.get(`session:${id}`);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    const userRaw = await env.PROFILES.get(`user:${s.email}`);
    if (!userRaw) return null;
    /* 被封禁的账号立即掉线（按匿名处理） */
    if (await env.PROFILES.get(`ban:${s.email}`)) return null;
    const user = JSON.parse(userRaw);
    return { email: user.email, displayName: user.displayName || "", bio: user.bio || "", location: user.location || "", website: user.website || "", avatar: user.avatar || "", verified: !!user.verified };
  } catch {
    return null;
  }
}

/* ---------------- 身份统一（邮箱 or GitHub） ---------------- */

async function getGitHubIdentity(request) {
  const token = readCookie(request, "solhub_token");
  if (!token) return null;
  const res = await fetch(`${API}/user`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "SolHub" },
  });
  const user = await res.json();
  if (!user.login) return null;
  return { type: "github", login: user.login, avatar_url: user.avatar_url, token };
}

async function getIdentity(request, env) {
  const session = await getSessionUser(request, env);
  if (session) return { type: "email", login: session.email, user: session };
  const gh = await getGitHubIdentity(request);
  if (gh) return gh;
  return null;
}

/* ---------------- 世界（社交）：帖子 / 点赞 / 评论 / 关注 ---------------- */

const POST_MAX = 500;
const COMMENT_MAX = 300;
const FEED_CAP = 300;

async function kvGetJSON(env, key, fallback) {
  const raw = await env.PROFILES.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
async function kvPutJSON(env, key, val) {
  await env.PROFILES.put(key, JSON.stringify(val));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 取用户展示信息快照（昵称/头像/认证） */
async function displayOf(env, identity) {
  if (identity.type === "email") {
    const u = identity.user;
    return {
      login: u.email,
      name: u.displayName || u.email.split("@")[0],
      avatar: u.avatar || "",
      verified: !!u.verified,
    };
  }
  const profile = await kvGetJSON(env, `profile:${identity.login}`, {});
  return {
    login: identity.login,
    name: profile.displayName || identity.login,
    avatar: identity.avatar_url || profile.avatar || "",
    verified: !!profile.verified,
  };
}

async function authorOf(env, login) {
  if (login && login.includes("@")) {
    const user = await kvGetJSON(env, `user:${login}`, null);
    if (user) return { login, name: user.displayName || login.split("@")[0], avatar: user.avatar || "" };
    return { login, name: login.split("@")[0], avatar: "" };
  }
  const profile = await kvGetJSON(env, `profile:${login}`, {});
  return { login, name: profile.displayName || login, avatar: profile.avatar || "" };
}

/* ---------------- 封禁（独立键，便于信息流快速过滤） ---------------- */

/** 取封禁记录（未封禁返回 null） */
async function banOf(env, login) {
  if (!login) return null;
  const raw = await env.PROFILES.get(`ban:${login}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { bannedAt: "", reason: "" }; }
}

async function isBanned(env, login) {
  return !!(await banOf(env, login));
}

/** 写操作前的拦截：被封禁的账号不能发帖/评论/点赞/关注 */
async function blockedIfBanned(request, env, login) {
  const ban = await banOf(env, login);
  if (!ban) return null;
  return json(request, { error: ban.reason ? `账号已被封禁：${ban.reason}` : "账号已被封禁" }, 403);
}

/** 读取仓库里的社区产品数据（只读，失败返回空数组，不阻塞页面）。 */
async function readCommunity(env) {
  if (!env.GITHUB_PAT) return [];
  try {
    const fileRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json?ref=main`, {
      headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
    });
    const fileData = await fileRes.json();
    if (!fileData.content) return [];
    return JSON.parse(decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, "")))));
  } catch {
    return [];
  }
}

/** 读取仓库里的产品索引（构建时由 products.ts 生成，失败返回空数组）。 */
async function readProductIndex(env) {
  if (!env.GITHUB_PAT) return [];
  try {
    const res = await fetch(`${API}/repos/${REPO}/contents/src/data/product-index.json?ref=main`, {
      headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
    });
    const data = await res.json();
    if (!data.content) return [];
    return JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))));
  } catch {
    return [];
  }
}

/** 把产品裁成卡片需要的字段。 */
function toCard(p) {
  return {
    slug: p.slug,
    name: p.name,
    shortDescription: p.shortDescription || "",
    icon: p.icon || "",
    websiteUrl: p.websiteUrl || "",
    category: p.category || "other",
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 6) : [],
    verificationStatus: p.verificationStatus || "pending",
    publishedAt: p.publishedAt || "",
  };
}

/** 从社区数据里挑出某人提交的产品，裁成卡片需要的字段。 */
function productsOf(community, login) {
  return community.filter((p) => p.submittedBy === login).map(toCard);
}

/**
 * 用户的产品 = 社区提交的（submittedBy）+ 认领的（user.productSlugs，来自官方目录）。
 * 按 slug 去重，认领顺序优先。
 */
function mergeProducts(communityProducts, claimedSlugs, index) {
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (!p || !p.slug || seen.has(p.slug)) return;
    seen.add(p.slug);
    out.push(p);
  };
  for (const slug of claimedSlugs) {
    const hit = index.find((p) => p.slug === slug);
    if (hit) push({ ...toCard(hit), claimed: true });
  }
  for (const p of communityProducts) push({ ...p, claimed: false });
  return out;
}

/** 认领列表（容错：非数组或脏值一律忽略） */
function claimedSlugsOf(user) {
  if (!user || !Array.isArray(user.productSlugs)) return [];
  return user.productSlugs.filter((s) => typeof s === "string" && s.length < 80).slice(0, 50);
}

async function hydratePost(env, id, viewer) {
  const [p, likes, comments] = await Promise.all([
    kvGetJSON(env, `post:${id}`, null),
    kvGetJSON(env, `post:${id}:likes`, []),
    kvGetJSON(env, `post:${id}:comments`, []),
  ]);
  if (!p) return null;
  return {
    ...p,
    likeCount: likes.length,
    likedByMe: viewer ? likes.includes(viewer) : false,
    commentCount: comments.length,
  };
}

async function feedPosts(env, ids, viewer, limit) {
  const slice = ids.slice(0, Math.min(ids.length, limit * 2));
  const posts = (await Promise.all(slice.map((id) => hydratePost(env, id, viewer)))).filter(Boolean);
  if (!posts.length) return [];
  /* 隐藏被封禁作者的内容 */
  const authors = [...new Set(posts.map((p) => p.author))];
  const bans = await kvGetMany(env, authors.map((a) => `ban:${a}`));
  const banned = new Set(authors.filter((a, i) => bans[i]));
  return (banned.size ? posts.filter((p) => !banned.has(p.author)) : posts).slice(0, limit);
}

async function pushFeed(env, key, id) {
  const list = await kvGetJSON(env, key, []);
  list.unshift(id);
  await kvPutJSON(env, key, list.slice(0, FEED_CAP));
}

async function removeFromFeed(env, key, id) {
  const list = await kvGetJSON(env, key, []);
  const next = list.filter((x) => x !== id);
  await kvPutJSON(env, key, next);
}

async function toggleInList(env, key, value) {
  const list = await kvGetJSON(env, key, []);
  const has = list.includes(value);
  const next = has ? list.filter((x) => x !== value) : [value, ...list];
  await kvPutJSON(env, key, next);
  return !has;
}

/* ---------------- 搜索：开发者 + 帖子 ---------------- */

const SEARCH_POST_SCAN = 300; // 与 feed:global 上限保持一致
const SEARCH_USER_SCAN = 500; // 一次最多扫描的用户记录数

/** 批量读 KV（每批 40 并发，避免瞬时过多子请求） */
async function kvGetMany(env, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 40) {
    out.push(...(await Promise.all(keys.slice(i, i + 40).map((k) => env.PROFILES.get(k)))));
  }
  return out;
}

/** 列出某前缀下的全部 key（分页拉取，最多 cap 个） */
async function listKeys(env, prefix, cap) {
  const keys = [];
  let cursor;
  while (keys.length < cap) {
    const page = await env.PROFILES.list({ prefix, limit: Math.min(1000, cap - keys.length), cursor });
    for (const k of page.keys) keys.push(k.name);
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return keys.slice(0, cap);
}

function hit(q, fields) {
  return fields.some((f) => f && String(f).toLowerCase().includes(q));
}

/** 搜索所有注册过的开发者（邮箱用户 + GitHub 用户） */
async function searchUsers(env, q, limit) {
  const emailKeys = await listKeys(env, "user:", SEARCH_USER_SCAN);
  const ghKeys = await listKeys(env, "profile:", 100);
  const raws = await kvGetMany(env, [...emailKeys, ...ghKeys]);
  const users = [];
  const seen = new Set();
  raws.forEach((raw, i) => {
    if (!raw) return;
    let u;
    try { u = JSON.parse(raw); } catch { return; }
    const isEmail = i < emailKeys.length;
    const login = isEmail ? u.email : ghKeys[i - emailKeys.length];
    if (!login || seen.has(login)) return;
    const name = u.displayName || (isEmail ? login.split("@")[0] : login);
    if (!hit(q, [name, login, String(login).split("@")[0], u.bio, u.website, u.location])) return;
    seen.add(login);
    users.push({
      login,
      name,
      avatar: u.avatar || "",
      bio: u.bio || "",
      website: u.website || "",
      joinedAt: u.createdAt || "",
      verified: !!u.verified,
    });
  });
  const top = users.slice(0, limit);
  const bans = await kvGetMany(env, top.map((x) => `ban:${x.login}`));
  return top.filter((_, i) => !bans[i]);
}

/** 搜索全部帖子（正文 / 链接 / 作者名 / 账号） */
async function searchPosts(env, q, viewer, limit) {
  const ids = (await kvGetJSON(env, "feed:global", [])).slice(0, SEARCH_POST_SCAN);
  if (!ids.length) return [];
  const raws = await kvGetMany(env, ids.map((id) => `post:${id}`));
  const matched = [];
  raws.forEach((raw, i) => {
    if (!raw) return;
    let p;
    try { p = JSON.parse(raw); } catch { return; }
    if (!hit(q, [p.text, p.linkUrl, p.authorName, p.author])) return;
    matched.push(p);
  });
  const out = [];
  for (const p of matched.slice(0, limit)) {
    const [likes, comments] = await Promise.all([
      kvGetJSON(env, `post:${p.id}:likes`, []),
      kvGetJSON(env, `post:${p.id}:comments`, []),
    ]);
    out.push({
      ...p,
      likeCount: likes.length,
      likedByMe: viewer ? likes.includes(viewer) : false,
      commentCount: comments.length,
    });
  }
  return out;
}

/* ---------------- 管理后台（/admin/*） ---------------- */

/** 管理员邮箱白名单（env.ADMIN_EMAILS，逗号分隔） */
function adminEmails(env) {
  const raw = String(env.ADMIN_EMAILS || "solyoungwork@gmail.com");
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isAdminLogin(env, login) {
  return !!login && adminEmails(env).includes(String(login).toLowerCase());
}

/** 校验管理员身份；通过返回 { identity }，否则返回 { error: Response } */
async function requireAdmin(request, env) {
  const identity = await getIdentity(request, env);
  if (!identity) return { error: json(request, { error: "未登录" }, 401) };
  if (!isAdminLogin(env, identity.login)) return { error: json(request, { error: "无权访问" }, 403) };
  return { identity };
}

/** 枚举全部账号（邮箱用户 + GitHub 用户），附封禁/认证/发帖数 */
async function listAllUsers(env, cap) {
  const emailKeys = await listKeys(env, "user:", cap);
  const ghKeys = await listKeys(env, "profile:", 100);
  const raws = await kvGetMany(env, [...emailKeys, ...ghKeys]);

  const accounts = [];
  raws.forEach((raw, i) => {
    const isEmail = i < emailKeys.length;
    const login = isEmail ? (emailKeys[i] || "").slice(5) : (ghKeys[i - emailKeys.length] || "").slice(8);
    if (!login) return;
    let u = {};
    if (raw) { try { u = JSON.parse(raw); } catch {} }
    accounts.push({
      login,
      type: isEmail ? "email" : "github",
      name: u.displayName || (isEmail ? login.split("@")[0] : login),
      avatar: u.avatar || "",
      bio: u.bio || "",
      website: u.website || "",
      location: u.location || "",
      createdAt: u.createdAt || "",
      verified: !!u.verified,
      verifiedAt: u.verifiedAt || "",
    });
  });

  const logins = accounts.map((a) => a.login);
  const [bans, postIds] = await Promise.all([
    kvGetMany(env, logins.map((l) => `ban:${l}`)),
    kvGetMany(env, logins.map((l) => `feed:user:${l}`)),
  ]);

  return accounts.map((a, i) => {
    let ban = null;
    if (bans[i]) { try { ban = JSON.parse(bans[i]); } catch { ban = { reason: "" }; } }
    let posts = [];
    if (postIds[i]) { try { posts = JSON.parse(postIds[i]); } catch {} }
    return {
      ...a,
      banned: !!ban,
      banReason: ban?.reason || "",
      bannedAt: ban?.bannedAt || "",
      postCount: Array.isArray(posts) ? posts.length : 0,
    };
  });
}

/** 读取产品认证覆盖（KV 覆盖官方目录的核验状态） */
async function readProductOverrides(env, slugs) {
  const uniq = [...new Set(slugs)];
  if (!uniq.length) return {};
  const raws = await kvGetMany(env, uniq.map((s) => `product:override:${s}`));
  const out = {};
  uniq.forEach((s, i) => {
    if (!raws[i]) return;
    try { out[s] = JSON.parse(raws[i]); } catch {}
  });
  return out;
}

/** 把认证覆盖应用到产品卡片 */
function applyOverride(card, overrides) {
  const o = overrides[card.slug];
  if (!o) return card;
  return { ...card, verificationStatus: o.verified ? "verified" : "pending", claimed: card.claimed };
}

/* ---------------- 主路由 ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsFor(request) });
    }

    /* ---------- 邮箱注册 ---------- */
    if (url.pathname === "/auth/register" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = String(body.displayName || "").trim().slice(0, 40);
      if (!EMAIL_RE.test(email)) return json(request, { error: "邮箱格式不正确" }, 400);
      if (password.length < 8) return json(request, { error: "密码至少 8 位" }, 400);
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);

      const key = `user:${email}`;
      if (await env.PROFILES.get(key)) {
        return json(request, { error: "该邮箱已注册，请直接登录" }, 409);
      }
      const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      const passHash = await hashPassword(password, salt);
      await env.PROFILES.put(key, JSON.stringify({
        email, displayName, passSalt: salt, passHash, createdAt: new Date().toISOString(),
      }));
      const cookie = await createSession(request, env, email);
      return json(request, { ok: true, user: { login: email, email, displayName } }, 200, cookie);
    }

    /* ---------- 邮箱登录 ---------- */
    if (url.pathname === "/auth/login" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);

      const raw = await env.PROFILES.get(`user:${email}`);
      if (!raw) return json(request, { error: "邮箱或密码错误" }, 401);
      const user = JSON.parse(raw);
      const hash = await hashPassword(password, user.passSalt);
      if (hash !== user.passHash) return json(request, { error: "邮箱或密码错误" }, 401);
      const ban = await banOf(env, email);
      if (ban) {
        return json(request, { error: ban.reason ? `账号已被封禁：${ban.reason}` : "账号已被封禁，如有疑问请联系管理员。" }, 403);
      }
      const cookie = await createSession(request, env, email);
      return json(request, { ok: true, user: { login: email, email, displayName: user.displayName || "" } }, 200, cookie);
    }

    /* ---------- 退出登录 ---------- */
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      const id = readCookie(request, SESSION_COOKIE);
      if (id && env.PROFILES) await env.PROFILES.delete(`session:${id}`);
      const clear = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      return json(request, { ok: true }, 200, clear);
    }

    /* ---------- GitHub OAuth（保留） ---------- */
    if (url.pathname === "/auth") {
      const params = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: env.WORKER_URL + "/callback",
        scope: "public_repo",
      });
      return redirect(request, `${OAUTH_URL}?${params}`);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return json(request, { error: "missing code" }, 400);
      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return json(request, { error: "token exchange failed" }, 400);
      const cookie = `solhub_token=${encodeURIComponent(tokenData.access_token)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=2592000`;
      return redirect(request, `${SITE_BASE}/my-submissions/`, { "Set-Cookie": cookie });
    }

    /* ---------- 当前用户 ---------- */
    if (url.pathname === "/me") {
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { authenticated: false }, 401);
      if (identity.type === "email") {
        const admin = isAdminLogin(env, identity.login);
        return json(request, { authenticated: true, isAdmin: admin, user: { ...identity.user, authType: "email", isAdmin: admin } });
      }
      let profile = {};
      if (env.PROFILES) {
        const raw = await env.PROFILES.get(`profile:${identity.login}`);
        if (raw) { try { profile = JSON.parse(raw); } catch {} }
      }
      const admin = isAdminLogin(env, identity.login);
      return json(request, {
        authenticated: true,
        isAdmin: admin,
        user: { login: identity.login, avatar_url: identity.avatar_url, authType: "github", isAdmin: admin, ...profile },
      });
    }

    /* ---------- 个人资料（GET / PUT） ---------- */
    if (url.pathname === "/profile") {
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "not authenticated" }, 401);

      if (request.method === "GET") {
        if (identity.type === "email") {
          const u = identity.user;
          return json(request, { login: u.email, email: u.email, displayName: u.displayName, bio: u.bio, location: u.location, website: u.website, avatar: u.avatar || "" });
        }
        let profile = {};
        if (env.PROFILES) {
          const raw = await env.PROFILES.get(`profile:${identity.login}`);
          if (raw) { try { profile = JSON.parse(raw); } catch {} }
        }
        return json(request, { login: identity.login, avatar_url: identity.avatar_url, ...profile });
      }

      if (request.method === "PUT") {
        const body = await request.json();
        const allowed = {
          displayName: String(body.displayName || "").slice(0, 40),
          bio: String(body.bio || "").slice(0, 200),
          location: String(body.location || "").slice(0, 40),
          website: String(body.website || "").slice(0, 200),
        };
        /* 头像：客户端压缩后的 data URL（≤200KB），邮箱用户存 KV */
        if (typeof body.avatar === "string") {
          if (body.avatar === "") {
            allowed.avatar = "";
          } else if (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(body.avatar) && body.avatar.length <= 300000) {
            allowed.avatar = body.avatar;
          }
        }
        if (identity.type === "email") {
          const key = `user:${identity.login}`;
          const raw = await env.PROFILES.get(key);
          if (!raw) return json(request, { error: "user not found" }, 404);
          const user = JSON.parse(raw);
          Object.assign(user, allowed);
          await env.PROFILES.put(key, JSON.stringify(user));
          return json(request, { ok: true, ...allowed });
        }
        if (env.PROFILES) {
          await env.PROFILES.put(`profile:${identity.login}`, JSON.stringify(allowed));
        }
        return json(request, { ok: true, ...allowed });
      }
    }

    /* ---------- 我的 GitHub Issue 投稿（仅 GitHub 登录） ---------- */
    if (url.pathname === "/my-issues") {
      const gh = await getGitHubIdentity(request);
      if (!gh) return json(request, []);
      const res = await fetch(`${API}/repos/${REPO}/issues?creator=${encodeURIComponent(gh.login)}&state=all&per_page=50`, {
        headers: { Authorization: `Bearer ${gh.token}`, "User-Agent": "SolHub" },
      });
      const issues = await res.json();
      return json(request, issues);
    }

    if (url.pathname.startsWith("/issues/") && request.method === "PATCH" && !url.pathname.endsWith("/close")) {
      const gh = await getGitHubIdentity(request);
      if (!gh) return json(request, { authenticated: false }, 401);
      const number = url.pathname.split("/")[2];
      const body = await request.text();
      const res = await fetch(`${API}/repos/${REPO}/issues/${number}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${gh.token}`, "User-Agent": "SolHub", "Content-Type": "application/json" },
        body,
      });
      return json(request, await res.json(), res.status);
    }

    if (url.pathname.match(/^\/issues\/\d+\/close$/) && request.method === "POST") {
      const gh = await getGitHubIdentity(request);
      if (!gh) return json(request, { authenticated: false }, 401);
      const number = url.pathname.split("/")[2];
      const res = await fetch(`${API}/repos/${REPO}/issues/${number}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${gh.token}`, "User-Agent": "SolHub", "Content-Type": "application/json" },
        body: JSON.stringify({ state: "closed" }),
      });
      return json(request, { ok: true }, res.status);
    }

    /* ---------- 图标上传（GitHub 登录用户，提交到仓库 icons/） ---------- */
    if (url.pathname === "/upload-icon" && request.method === "POST") {
      const gh = await getGitHubIdentity(request);
      if (!gh) return json(request, { error: "not authenticated" }, 401);
      const body = await request.json();
      if (!body.dataUrl) return json(request, { error: "missing dataUrl" }, 400);
      const m = body.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!m) return json(request, { error: "invalid dataUrl" }, 400);
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const filename = `icon-${Date.now()}.${ext}`;
      const path = `icons/${filename}`;
      const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${gh.token}`, "User-Agent": "SolHub", "Content-Type": "application/json" },
        body: JSON.stringify({ message: `add icon ${filename}`, content: m[2] }),
      });
      const data = await res.json();
      if (!data.content) return json(request, { error: "upload failed", detail: data }, 500);
      return json(request, { url: `https://raw.githubusercontent.com/${REPO}/main/${path}` });
    }

    /* ---------- URL 可达性检测 ---------- */
    if (url.pathname === "/check-url" && request.method === "POST") {
      const body = await request.json();
      const targetUrl = String(body.url || "");
      if (!targetUrl) return json(request, { ok: false, error: "缺少 URL" }, 400);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(targetUrl, {
          method: "HEAD", redirect: "follow", signal: ctrl.signal,
          headers: { "User-Agent": "SolHub/1.0" },
        });
        clearTimeout(t);
        if (res.ok || res.status === 301 || res.status === 302 || res.status === 403) {
          return json(request, { ok: true, status: res.status });
        }
        return json(request, { ok: false, status: res.status, error: `网站返回 ${res.status}` });
      } catch {
        return json(request, { ok: false, error: "网站无法访问，请检查 URL 是否正确" });
      }
    }

    /* ---------- 提交产品（登录用户自动收录到 community.json） ---------- */
    if (url.pathname === "/publish" && request.method === "POST") {
      if (!env.GITHUB_PAT) return json(request, { error: "server not configured" }, 500);
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "请先登录" }, 401);

      let data;
      try { data = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const name = String(data.name || "").slice(0, 80);
      const websiteUrl = String(data.websiteUrl || "");
      if (!name) return json(request, { error: "产品名称不能为空" }, 400);
      if (!websiteUrl || !/^https?:\/\//.test(websiteUrl)) return json(request, { error: "官网 URL 不能为空且需以 http(s):// 开头" }, 400);

      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const checkRes = await fetch(websiteUrl, {
          method: "HEAD", redirect: "follow", signal: ctrl.signal,
          headers: { "User-Agent": "SolHub/1.0" },
        });
        clearTimeout(t);
        if (!checkRes.ok && checkRes.status !== 301 && checkRes.status !== 302 && checkRes.status !== 403) {
          return json(request, { error: `网站 ${websiteUrl} 返回 ${checkRes.status}，无法收录` }, 400);
        }
      } catch {
        return json(request, { error: `无法访问 ${websiteUrl}，请确认网站可以正常打开` }, 400);
      }

      const fileRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json?ref=main`, {
        headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
      });
      const fileData = await fileRes.json();
      let community = [];
      if (fileData.content) {
        try { community = JSON.parse(decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ""))))); } catch { community = []; }
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Date.now().toString(36);
      const newProduct = {
        id: slug,
        slug,
        name,
        shortDescription: String(data.shortDescription || "").slice(0, 120),
        description: String(data.description || data.shortDescription || "").slice(0, 500),
        websiteUrl,
        icon: data.iconUrl && !String(data.iconUrl).startsWith("data:") ? data.iconUrl : "",
        category: String(data.category || "other"),
        tags: Array.isArray(data.tags) ? data.tags.slice(0, 8) : String(data.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
        developerName: String(data.developerName || identity.login).slice(0, 80),
        publishedAt: new Date().toISOString().slice(0, 10),
        launchBatch: "Community",
        verificationStatus: "verified",
        verificationMethod: "官网链接自动检测可访问，已自动收录上线",
        verifiedAt: new Date().toISOString().slice(0, 10),
        isDemo: false,
        submittedBy: identity.login,
      };
      community.push(newProduct);

      const content = btoa(unescape(encodeURIComponent(JSON.stringify(community, null, 2))));
      const writeRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub", "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `community: add ${name} by @${identity.login}`,
          content,
          sha: fileData.sha,
        }),
      });
      const writeData = await writeRes.json();
      if (!writeData.commit) return json(request, { error: "写入失败", detail: writeData }, 500);
      return json(request, { ok: true, product: newProduct, message: "链接检测通过，产品已自动收录上线" });
    }

    /* ---------- 我的收录产品 ---------- */
    if (url.pathname === "/my-products" && request.method === "GET") {
      if (!env.GITHUB_PAT) return json(request, { error: "server not configured" }, 500);
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "not authenticated" }, 401);
      const fileRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json?ref=main`, {
        headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
      });
      const fileData = await fileRes.json();
      let community = [];
      if (fileData.content) {
        try { community = JSON.parse(decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ""))))); } catch {}
      }
      const [index, mine] = await Promise.all([
        readProductIndex(env),
        kvGetJSON(env, `user:${identity.login}`, null),
      ]);
      const claimed = mergeProducts(
        productsOf(community, identity.login),
        claimedSlugsOf(mine),
        index,
      );
      return json(request, { products: claimed, sha: fileData.sha });
    }

    if (url.pathname.startsWith("/my-products/")) {
      if (!env.GITHUB_PAT) return json(request, { error: "server not configured" }, 500);
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "not authenticated" }, 401);
      const slug = url.pathname.split("/")[2];

      const fileRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json?ref=main`, {
        headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
      });
      const fileData = await fileRes.json();
      let community = [];
      if (fileData.content) {
        try { community = JSON.parse(decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ""))))); } catch {}
      }
      const idx = community.findIndex((p) => p.slug === slug && p.submittedBy === identity.login);
      if (idx === -1) return json(request, { error: "产品不存在或不是你的" }, 404);

      if (request.method === "DELETE") {
        community.splice(idx, 1);
      } else if (request.method === "PUT") {
        const body = await request.json();
        const p = community[idx];
        /* 若修改了官网链接，重新检测可达性 */
        if (body.websiteUrl) {
          const nextUrl = String(body.websiteUrl);
          if (nextUrl !== p.websiteUrl) {
            if (!/^https?:\/\//.test(nextUrl)) return json(request, { error: "官网 URL 需以 http(s):// 开头" }, 400);
            try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 5000);
              const checkRes = await fetch(nextUrl, {
                method: "HEAD", redirect: "follow", signal: ctrl.signal,
                headers: { "User-Agent": "SolHub/1.0" },
              });
              clearTimeout(t);
              if (!checkRes.ok && checkRes.status !== 301 && checkRes.status !== 302 && checkRes.status !== 403) {
                return json(request, { error: `网站返回 ${checkRes.status}，链接需可正常打开才能保存` }, 400);
              }
            } catch {
              return json(request, { error: "无法访问新的官网链接，请确认网站可以正常打开" }, 400);
            }
          }
        }
        if (body.name) p.name = String(body.name).slice(0, 80);
        if (body.shortDescription) p.shortDescription = String(body.shortDescription).slice(0, 120);
        if (body.description) p.description = String(body.description).slice(0, 500);
        if (body.websiteUrl) p.websiteUrl = String(body.websiteUrl);
        if (body.category) p.category = String(body.category);
        if (body.tags) p.tags = body.tags.slice(0, 8);
        if (body.developerName) p.developerName = String(body.developerName).slice(0, 80);
      }

      const content = btoa(unescape(encodeURIComponent(JSON.stringify(community, null, 2))));
      const writeRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub", "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `${request.method === "DELETE" ? "remove" : "update"} community product ${slug} by @${identity.login}`,
          content,
          sha: fileData.sha,
        }),
      });
      const writeData = await writeRes.json();
      if (!writeData.commit) return json(request, { error: "写入失败", detail: writeData }, 500);
      return json(request, { ok: true });
    }

    /* ================= 管理后台 ================= */

    if (url.pathname === "/admin/stats" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const gate = await requireAdmin(request, env);
      if (gate.error) return gate.error;

      const [emailKeys, ghKeys, globalFeed, banKeys] = await Promise.all([
        listKeys(env, "user:", 1000),
        listKeys(env, "profile:", 100),
        kvGetJSON(env, "feed:global", []),
        listKeys(env, "ban:", 1000),
      ]);
      return json(request, {
        users: emailKeys.length + ghKeys.length,
        posts: globalFeed.length,
        banned: banKeys.length,
        admins: adminEmails(env),
        me: gate.identity.login,
      });
    }

    if (url.pathname === "/admin/users" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const gate = await requireAdmin(request, env);
      if (gate.error) return gate.error;

      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      let users = await listAllUsers(env, 500);
      if (q) {
        users = users.filter((u) =>
          u.name.toLowerCase().includes(q) ||
          u.login.toLowerCase().includes(q) ||
          (u.bio || "").toLowerCase().includes(q) ||
          (u.website || "").toLowerCase().includes(q),
        );
      }
      users.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const admins = adminEmails(env);
      return json(request, {
        total: users.length,
        users: users.slice(0, 100).map((u) => ({ ...u, isAdmin: admins.includes(u.login.toLowerCase()) })),
      });
    }

    /* 用户操作：封禁 / 认证 / 重置密码 / 删除 */
    {
      const m = url.pathname.match(/^\/admin\/users\/([^/]+)\/(ban|verify|password|delete)$/);
      if (m) {
        if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
        const gate = await requireAdmin(request, env);
        if (gate.error) return gate.error;

        const login = decodeURIComponent(m[1]);
        const action = m[2];
        const isEmailUser = login.includes("@");
        const key = isEmailUser ? `user:${login}` : `profile:${login}`;

        if (action === "delete") {
          if (request.method !== "DELETE" && request.method !== "POST") return json(request, { error: "method not allowed" }, 405);
          if (isAdminLogin(env, login)) return json(request, { error: "不能删除管理员账号" }, 400);
          const ids = await kvGetJSON(env, `feed:user:${login}`, []);
          for (const id of ids.slice(0, 500)) {
            await env.PROFILES.delete(`post:${id}`);
            await env.PROFILES.delete(`post:${id}:likes`);
            await env.PROFILES.delete(`post:${id}:comments`);
            await removeFromFeed(env, "feed:global", id);
          }
          await Promise.all([
            env.PROFILES.delete(`feed:user:${login}`),
            env.PROFILES.delete(key),
            env.PROFILES.delete(`ban:${login}`),
            env.PROFILES.delete(`following:${login}`),
            env.PROFILES.delete(`followers:${login}`),
          ]);
          return json(request, { ok: true, deletedPosts: ids.length });
        }

        if (request.method !== "POST") return json(request, { error: "method not allowed" }, 405);
        let body = {};
        try { body = await request.json(); } catch {}

        if (action === "ban") {
          if (isAdminLogin(env, login)) return json(request, { error: "不能封禁管理员账号" }, 400);
          if (body.banned) {
            await env.PROFILES.put(
              `ban:${login}`,
              JSON.stringify({ bannedAt: new Date().toISOString(), reason: String(body.reason || "").slice(0, 200), by: gate.identity.login }),
            );
          } else {
            await env.PROFILES.delete(`ban:${login}`);
          }
          return json(request, { ok: true, banned: !!body.banned });
        }

        if (action === "verify") {
          const verified = !!body.verified;
          const raw = await env.PROFILES.get(key);
          if (!raw) return json(request, { error: "用户不存在" }, 404);
          let rec = {};
          try { rec = JSON.parse(raw); } catch { return json(request, { error: "用户数据损坏" }, 500); }
          rec.verified = verified;
          rec.verifiedAt = verified ? new Date().toISOString().slice(0, 10) : "";
          rec.verifiedBy = verified ? gate.identity.login : "";
          await env.PROFILES.put(key, JSON.stringify(rec));

          /* 回填已有帖子的作者认证标记，信息流立即生效 */
          const ids = await kvGetJSON(env, `feed:user:${login}`, []);
          const posts = await kvGetMany(env, ids.slice(0, 200).map((id) => `post:${id}`));
          let patched = 0;
          for (let i = 0; i < posts.length; i += 1) {
            if (!posts[i]) continue;
            try {
              const p = JSON.parse(posts[i]);
              if (!!p.authorVerified === verified) continue;
              p.authorVerified = verified;
              await kvPutJSON(env, `post:${ids[i]}`, p);
              patched += 1;
            } catch {}
          }
          return json(request, { ok: true, verified, patched });
        }

        if (action === "password") {
          if (!isEmailUser) return json(request, { error: "GitHub 账号无法在此改密码" }, 400);
          const raw = await env.PROFILES.get(key);
          if (!raw) return json(request, { error: "用户不存在" }, 404);
          let rec = {};
          try { rec = JSON.parse(raw); } catch { return json(request, { error: "用户数据损坏" }, 500); }
          const next = String(body.password || "").trim() || (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6));
          if (next.length < 8) return json(request, { error: "密码至少 8 位" }, 400);
          const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
          rec.passSalt = salt;
          rec.passHash = await hashPassword(next, salt);
          rec.passwordResetAt = new Date().toISOString();
          await env.PROFILES.put(key, JSON.stringify(rec));
          return json(request, { ok: true, password: next });
        }
      }
    }

    if (url.pathname === "/admin/posts" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const gate = await requireAdmin(request, env);
      if (gate.error) return gate.error;

      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const ids = (await kvGetJSON(env, "feed:global", [])).slice(0, 300);
      const raws = await kvGetMany(env, ids.map((id) => `post:${id}`));
      let posts = [];
      raws.forEach((raw) => {
        if (!raw) return;
        try { posts.push(JSON.parse(raw)); } catch {}
      });
      if (q) {
        posts = posts.filter((p) =>
          (p.text || "").toLowerCase().includes(q) ||
          (p.authorName || "").toLowerCase().includes(q) ||
          (p.author || "").toLowerCase().includes(q),
        );
      }
      return json(request, { total: posts.length, posts: posts.slice(0, 100) });
    }

    {
      const m = url.pathname.match(/^\/admin\/posts\/([^/]+)$/);
      if (m && request.method === "DELETE") {
        if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
        const gate = await requireAdmin(request, env);
        if (gate.error) return gate.error;
        const id = decodeURIComponent(m[1]);
        const post = await kvGetJSON(env, `post:${id}`, null);
        if (!post) return json(request, { error: "帖子不存在" }, 404);
        await env.PROFILES.delete(`post:${id}`);
        await env.PROFILES.delete(`post:${id}:likes`);
        await env.PROFILES.delete(`post:${id}:comments`);
        await removeFromFeed(env, "feed:global", id);
        await removeFromFeed(env, `feed:user:${post.author}`, id);
        return json(request, { ok: true });
      }
    }

    if (url.pathname === "/admin/products" && request.method === "GET") {
      if (!env.GITHUB_PAT) return json(request, { error: "未配置 GITHUB_PAT" }, 500);
      const gate = await requireAdmin(request, env);
      if (gate.error) return gate.error;

      const [index, community] = await Promise.all([readProductIndex(env), readCommunity(env)]);
      const overrides = await readProductOverrides(env, [...index.map((p) => p.slug), ...community.map((p) => p.slug)]);
      const list = [
        ...community.map((p) => ({
          ...toCard(p),
          source: "community",
          submittedBy: p.submittedBy || "",
          verified: (overrides[p.slug]?.verified ?? p.verificationStatus === "verified"),
        })),
        ...index.map((p) => ({
          ...toCard(p),
          source: "catalog",
          submittedBy: "",
          verified: (overrides[p.slug]?.verified ?? p.verificationStatus === "verified"),
        })),
      ];
      return json(request, { total: list.length, products: list });
    }

    {
      const m = url.pathname.match(/^\/admin\/products\/([^/]+)\/verify$/);
      if (m && request.method === "POST") {
        if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
        const gate = await requireAdmin(request, env);
        if (gate.error) return gate.error;

        const slug = decodeURIComponent(m[1]);
        let body = {};
        try { body = await request.json(); } catch {}
        const verified = !!body.verified;
        const stamp = new Date().toISOString().slice(0, 10);

        /* 社区产品：直接改 community.json；目录产品：写 KV 覆盖 */
        const community = await readCommunity(env);
        const hit = community.find((p) => p.slug === slug);
        if (hit) {
          if (!env.GITHUB_PAT) return json(request, { error: "未配置 GITHUB_PAT" }, 500);
          const fileRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json?ref=main`, {
            headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
          });
          const fileData = await fileRes.json();
          let list = [];
          if (fileData.content) {
            try { list = JSON.parse(decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ""))))); } catch {}
          }
          const idx = list.findIndex((p) => p.slug === slug);
          if (idx === -1) return json(request, { error: "产品不存在" }, 404);
          list[idx].verificationStatus = verified ? "verified" : "pending";
          list[idx].verifiedAt = verified ? stamp : "";
          list[idx].verifiedBy = verified ? gate.identity.login : "";
          const content = btoa(unescape(encodeURIComponent(JSON.stringify(list, null, 2))));
          const writeRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub", "Content-Type": "application/json" },
            body: JSON.stringify({
              message: `admin: ${verified ? "verify" : "unverify"} community product ${slug}`,
              content,
              sha: fileData.sha,
            }),
          });
          const writeData = await writeRes.json();
          if (!writeData.commit) return json(request, { error: "写入仓库失败", detail: writeData }, 500);
          return json(request, { ok: true, verified, source: "community" });
        }

        await env.PROFILES.put(
          `product:override:${slug}`,
          JSON.stringify({ verified, verifiedAt: stamp, verifiedBy: gate.identity.login }),
        );
        return json(request, { ok: true, verified, source: "catalog" });
      }
    }


    if (url.pathname === "/search" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const identity = await getIdentity(request, env);
      const viewer = identity ? identity.login : null;
      const qRaw = String(url.searchParams.get("q") || "").trim().slice(0, 60);
      const limit = Math.min(Number(url.searchParams.get("limit") || 20) || 20, 50);
      if (!qRaw) return json(request, { query: "", users: [], posts: [] });

      const q = qRaw.toLowerCase();
      const [users, posts] = await Promise.all([
        searchUsers(env, q, limit),
        searchPosts(env, q, viewer, limit),
      ]);
      return json(request, { query: qRaw, users, posts });
    }

    /* ---------- 世界：信息流 ---------- */
    if (url.pathname === "/world" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const identity = await getIdentity(request, env);
      const viewer = identity ? identity.login : null;
      const tab = url.searchParams.get("tab") || "latest";
      const author = url.searchParams.get("author") || "";
      const limit = Math.min(Number(url.searchParams.get("limit") || 30) || 30, 60);

      let ids = [];
      if (author) {
        ids = await kvGetJSON(env, `feed:user:${author}`, []);
      } else if (tab === "following" && viewer) {
        const following = await kvGetJSON(env, `following:${viewer}`, []);
        const all = (await kvGetJSON(env, "feed:global", [])).slice(0, 120);
        const recs = await Promise.all(all.map((id) => kvGetJSON(env, `post:${id}`, null)));
        recs.forEach((p, i) => {
          if (ids.length >= limit) return;
          if (p && (following.includes(p.author) || p.author === viewer)) ids.push(all[i]);
        });
      } else {
        ids = await kvGetJSON(env, "feed:global", []);
      }

      const posts = await feedPosts(env, ids, viewer, limit);
      return json(request, { posts, viewer });
    }

    /* ---------- 世界：发帖 ---------- */
    if (url.pathname === "/world/posts" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "请先登录后再发布" }, 401);
      const blocked = await blockedIfBanned(request, env, identity.login);
      if (blocked) return blocked;

      /* 频率限制：同一账号 30 秒一条 */
      const rlKey = `rl:post:${identity.login}`;
      const last = await env.PROFILES.get(rlKey);
      if (last && Date.now() - Number(last) < 30000) {
        const wait = Math.ceil((30000 - (Date.now() - Number(last))) / 1000);
        return json(request, { error: `发布太频繁，请 ${wait} 秒后再试` }, 429);
      }

      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const text = String(body.text || "").trim().slice(0, POST_MAX);
      const linkUrl = String(body.linkUrl || "").trim().slice(0, 500);
      if (!text && !linkUrl) return json(request, { error: "内容不能为空" }, 400);
      if (linkUrl && !/^https?:\/\//.test(linkUrl)) return json(request, { error: "链接需以 http(s):// 开头" }, 400);

      const author = await displayOf(env, identity);
      const id = newId();
      const post = {
        id,
        author: author.login,
        authorName: author.name,
        authorAvatar: author.avatar,
        authorVerified: !!author.verified,
        text,
        linkUrl,
        createdAt: new Date().toISOString(),
      };
      await Promise.all([
        kvPutJSON(env, `post:${id}`, post),
        kvPutJSON(env, `post:${id}:likes`, []),
        kvPutJSON(env, `post:${id}:comments`, []),
        env.PROFILES.put(rlKey, String(Date.now()), { expirationTtl: 120 }),
      ]);
      await Promise.all([
        pushFeed(env, "feed:global", id),
        pushFeed(env, `feed:user:${author.login}`, id),
      ]);
      return json(request, { ok: true, post: { ...post, likeCount: 0, likedByMe: false, commentCount: 0 } });
    }

    /* ---------- 世界：单帖操作（删除 / 点赞 / 评论） ---------- */
    if (url.pathname.startsWith("/world/posts/")) {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const parts = url.pathname.split("/").filter(Boolean); // world posts <id> [like|comments]
      const id = parts[2];
      const action = parts[3] || "";
      const identity = await getIdentity(request, env);
      const viewer = identity ? identity.login : null;
      const post = await kvGetJSON(env, `post:${id}`, null);
      if (!post) return json(request, { error: "帖子不存在或已删除" }, 404);

      if (action === "" && request.method === "DELETE") {
        if (!identity || post.author !== identity.login) return json(request, { error: "只能删除自己的帖子" }, 403);
        await env.PROFILES.delete(`post:${id}`);
        await env.PROFILES.delete(`post:${id}:likes`);
        await env.PROFILES.delete(`post:${id}:comments`);
        await removeFromFeed(env, "feed:global", id);
        await removeFromFeed(env, `feed:user:${post.author}`, id);
        return json(request, { ok: true });
      }

      if (action === "like" && request.method === "POST") {
        if (!identity) return json(request, { error: "登录后才能点赞" }, 401);
        const blocked = await blockedIfBanned(request, env, identity.login);
        if (blocked) return blocked;
        const liked = await toggleInList(env, `post:${id}:likes`, viewer);
        const likes = await kvGetJSON(env, `post:${id}:likes`, []);
        return json(request, { ok: true, liked, likeCount: likes.length });
      }

      if (action === "comments") {
        if (request.method === "GET") {
          const comments = await kvGetJSON(env, `post:${id}:comments`, []);
          return json(request, { comments });
        }
        if (request.method === "POST") {
          if (!identity) return json(request, { error: "登录后才能评论" }, 401);
          const blocked = await blockedIfBanned(request, env, identity.login);
          if (blocked) return blocked;
          const rlKey = `rl:comment:${identity.login}`;
          const last = await env.PROFILES.get(rlKey);
          if (last && Date.now() - Number(last) < 10000) {
            return json(request, { error: "评论太频繁，请稍后再试" }, 429);
          }
          let body;
          try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
          const text = String(body.text || "").trim().slice(0, COMMENT_MAX);
          if (!text) return json(request, { error: "评论不能为空" }, 400);
          const who = await displayOf(env, identity);
          const comments = await kvGetJSON(env, `post:${id}:comments`, []);
          const comment = {
            id: newId(),
            author: who.login,
            authorName: who.name,
            authorAvatar: who.avatar,
            text,
            createdAt: new Date().toISOString(),
          };
          comments.push(comment);
          await kvPutJSON(env, `post:${id}:comments`, comments.slice(-200));
          await env.PROFILES.put(rlKey, String(Date.now()), { expirationTtl: 60 });
          return json(request, { ok: true, comment, commentCount: comments.length });
        }
      }
    }

    /* ---------- 世界：用户公开主页 / 关注 ---------- */
    if (url.pathname.startsWith("/users/")) {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const parts = url.pathname.split("/").filter(Boolean); // users <login> [follow|following|followers]
      const target = decodeURIComponent(parts[1] || "");
      const action = parts[2] || "";
      const identity = await getIdentity(request, env);
      const viewer = identity ? identity.login : null;

      if (action === "follow" && request.method === "POST") {
        if (!identity) return json(request, { error: "登录后才能关注" }, 401);
        const blocked = await blockedIfBanned(request, env, identity.login);
        if (blocked) return blocked;
        if (viewer === target) return json(request, { error: "不能关注自己" }, 400);
        const nowFollowing = await toggleInList(env, `following:${viewer}`, target);
        await toggleInList(env, `followers:${target}`, viewer);
        const followers = await kvGetJSON(env, `followers:${target}`, []);
        return json(request, { ok: true, following: nowFollowing, followerCount: followers.length });
      }

      if (action === "following" || action === "followers") {
        const list = await kvGetJSON(env, `${action}:${target}`, []);
        const users = [];
        for (const login of list.slice(0, 100)) {
          users.push(await authorOf(env, login));
        }
        return json(request, { users });
      }

      if (action === "") {
        const [author, followers, following, postIds, myFollowing, community, user, index, ban] = await Promise.all([
          authorOf(env, target),
          kvGetJSON(env, `followers:${target}`, []),
          kvGetJSON(env, `following:${target}`, []),
          kvGetJSON(env, `feed:user:${target}`, []),
          viewer ? kvGetJSON(env, `following:${viewer}`, []) : Promise.resolve([]),
          readCommunity(env),
          kvGetJSON(env, `user:${target}`, null),
          readProductIndex(env),
          banOf(env, target),
        ]);
        const posts = await feedPosts(env, postIds, viewer, 30);
        const overrides = await readProductOverrides(
          env,
          mergeProducts(productsOf(community, target), claimedSlugsOf(user), index).map((p) => p.slug),
        );
        const products = mergeProducts(productsOf(community, target), claimedSlugsOf(user), index)
          .map((p) => applyOverride(p, overrides));
        return json(request, {
          user: {
            ...author,
            bio: user?.bio || "",
            location: user?.location || "",
            website: user?.website || "",
            joinedAt: user?.createdAt || "",
            verified: !!user?.verified,
            banned: !!ban,
          },
          followerCount: followers.length,
          followingCount: following.length,
          postCount: postIds.length,
          productCount: products.length,
          isFollowing: myFollowing.includes(target),
          isSelf: viewer === target,
          posts,
          products,
        });
      }
    }

    return json(request, { error: "not found" }, 404);
  },
};
