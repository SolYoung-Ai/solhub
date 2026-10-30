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
    const user = JSON.parse(userRaw);
    return { email: user.email, displayName: user.displayName || "", bio: user.bio || "", location: user.location || "", website: user.website || "", avatar: user.avatar || "" };
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

/** 取用户展示信息快照（昵称/头像） */
async function displayOf(env, identity) {
  if (identity.type === "email") {
    const u = identity.user;
    return {
      login: u.email,
      name: u.displayName || u.email.split("@")[0],
      avatar: u.avatar || "",
    };
  }
  const profile = await kvGetJSON(env, `profile:${identity.login}`, {});
  return {
    login: identity.login,
    name: profile.displayName || identity.login,
    avatar: identity.avatar_url || profile.avatar || "",
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
  const slice = ids.slice(0, limit);
  const posts = await Promise.all(slice.map((id) => hydratePost(env, id, viewer)));
  return posts.filter(Boolean);
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
        return json(request, { authenticated: true, user: { ...identity.user, authType: "email" } });
      }
      let profile = {};
      if (env.PROFILES) {
        const raw = await env.PROFILES.get(`profile:${identity.login}`);
        if (raw) { try { profile = JSON.parse(raw); } catch {} }
      }
      return json(request, {
        authenticated: true,
        user: { login: identity.login, avatar_url: identity.avatar_url, authType: "github", ...profile },
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
      return json(request, { products: community.filter((p) => p.submittedBy === identity.login), sha: fileData.sha });
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
        const author = await authorOf(env, target);
        const followers = await kvGetJSON(env, `followers:${target}`, []);
        const following = await kvGetJSON(env, `following:${target}`, []);
        const postIds = await kvGetJSON(env, `feed:user:${target}`, []);
        const posts = await feedPosts(env, postIds, viewer, 30);
        let isFollowing = false;
        if (viewer) {
          const myFollowing = await kvGetJSON(env, `following:${viewer}`, []);
          isFollowing = myFollowing.includes(target);
        }
        return json(request, {
          user: author,
          followerCount: followers.length,
          followingCount: following.length,
          postCount: postIds.length,
          isFollowing,
          isSelf: viewer === target,
          posts,
        });
      }
    }

    return json(request, { error: "not found" }, 404);
  },
};
