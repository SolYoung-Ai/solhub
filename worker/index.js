/**
 * SolHub Auth Service — Cloudflare Worker（无服务器账号体系）
 *
 * 登录方式：邮箱 + 密码（本 Worker 自托管）：KV 存用户，PBKDF2-SHA256 哈希密码，
 *   HttpOnly Secure 会话 Cookie（KV TTL 30 天自动过期）。
 *   GitHub OAuth 通道已于 2026-11 整体下线（要 public_repo 权限，前端却早无入口）。
 *
 * KV 绑定 PROFILES：
 *   user:<email>      邮箱用户记录（个人资料；密码哈希不存这里）
 *   pw:<email>        密码凭据 { s:盐, h:哈希, v:密码版本号 }（与资料分键，见下）
 *   session:<id>      会话（{email, handle, pwdVersion, createdAt}，30 天 TTL）
 *   profile:<login>   GitHub 用户的展示资料（历史遗留，只读兼容）
 *   handle:<handle>   用户名 → 邮箱索引（公开标识解析用）
 *   alias:<oldEmail>  改邮箱后旧邮箱 → 新邮箱的别名（让旧会话不失效）
 *   vcode:<用途>:<邮箱>:<验证码> 一枚邮箱验证码一个键（10 分钟 TTL）
 *   vcode:meta:<用途>:<邮箱>  { w 最近发码时间, s 窗口内次数, n 错误次数, l 锁定到 }
 *   vcode:fuse         阿里云配额类错误熔断标记（命中后 1 小时内不再发信）
 *
 * 限流与存储选型（重要，都是踩过坑之后定下来的）：
 *   1. Workers Cache API 是 data center local —— 官方文档明说数据不跨机房同步。
 *      同一请求序列落在不同 colo（本项目实测 LHR/AMS 交替）时计数会各算各的，
 *      限流静默失效。所以 Cache API 只用于「粗粒度兜底」（IP 限流、每日预算）。
 *   2. Cloudflare KV 是最终一致的，写后数秒内其它节点可能读到旧值。
 *      因此验证码不能「存固定键再覆盖」—— 覆盖与否取决于读没读到旧值，
 *      结果是用户收到两封邮件、只有一封的码能用，注册直接失败。
 *      改成「码即键」：每枚码一个独立键，多枚码天然并存、互不覆盖，
 *      校验 = 按输入的码精确查找，不依赖任何读-改-写。
 *   3. 每日发码预算的硬防线在阿里云控制台的「日发送量上限」（设 200 封），
 *      超额邮件直接发不出去、不会产生费用；Worker 侧只做软提示与熔断。
 *   4. 密码凭据与个人资料分键存（pw:<email> vs user:<email>）：
 *      改密码只需要改密码，若把密码留在资料记录里，「读-改-整条写回」就会把
 *      KV 边缘缓存里的旧快照写回去，把后改的头像/简介等字段覆盖掉。
 *      分键后改密码与资料彻底解耦，两个方向都不会互相覆盖。
 *
 * 标识分层（重要）：
 *   SID（内部标识）= 邮箱 / GitHub 用户名，只用于 KV 键、登录态、封禁、限流，永不出现在公开响应里。
 *   PID（公开标识）= 邮箱用户的 handle（如 @solyoung）或 GitHub 用户名，出现在帖子作者、
 *                    个人主页、搜索结果、产品提交记录里。
 *   两者用 sidOf() / pidOf() 互相解析，旧链接里的邮箱地址仍然可用（向后兼容）。
 *
 * 安全边界：任何密钥（GITHUB_PAT / DM_ACCESS_KEY_SECRET）只存在于
 * Worker 环境变量，严禁返回给前端。密码哈希永不出库。
 *
 * 邮件通道（阿里云 DirectMail）：
 *   DM_ACCESS_KEY_ID / DM_ACCESS_KEY_SECRET  AccessKey
 *   DM_SENDER         发信地址（控制台创建，如 noreply@mail.solyoung.top）
 *   DM_REGION_ID      地域，默认 cn-hangzhou
 *   DM_TAG            邮件标签（可选，用于控制台统计）
 *   DM_DRY_RUN=1      干跑模式：只走完全部校验但不真正发信（用于无密钥时联调）
 */

import { searchHotItems } from "./hot-search.js";

const REPO = "SolYoung-Ai/solhub";
const SITE_BASE = "https://solhub.solyoung.top";
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
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, X-Solhub-Session, Authorization",
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

/* ---------------- 头像外置 ----------------
   头像历史上以 base64 data URL 存 KV，而且会被复制进每一条帖子（authorAvatar）。
   列表接口把这些 base64 内联进 JSON，会让响应膨胀到几十上百 KB（实测
   /world 75KB、/search 117KB，其中 98% 是头像），每敲一个字都要重下一遍。
   这里改成列表里只回一个短链接，图片由 GET /avatar/<login> 单独发并带缓存头，
   浏览器第二次直接命中本地缓存。空值与外部链接（GitHub 头像）保持原样。 */
function apiBaseOf(request, env) {
  const override = String((env && env.PUBLIC_API_BASE) || "").replace(/\/+$/, "");
  if (override) return override;
  try { return `${new URL(request.url).origin}/api`; } catch { return ""; }
}

function avatarUrl(imgBase, login, raw, hasAvatar) {
  const v = String(raw || "");
  if (v) {
    if (!/^data:image\//i.test(v)) return v; /* GitHub 等外链原样返回 */
    if (!imgBase || !login) return v; /* 兜底：拿不到基址就保持内联，宁可大也不要坏 */
    return `${imgBase}/avatar/${encodeURIComponent(login)}`;
  }
  /* 头像已外置到 avatar:<sid>，记录里只剩一个 hasAvatar 标记 */
  if (hasAvatar && imgBase && login) return `${imgBase}/avatar/${encodeURIComponent(login)}`;
  return "";
}

/* ---------------- 头像外置 ----------------
   头像是这个站里最「便宜又最贵」的字段：便宜是因为它只有一张图，贵是因为
   它以 base64 内联在 user:* / profile:* 里，而几乎所有读接口都要「枚举全部
   账号」——/creators、/search、关注列表、后台账号表。实测单条用户记录 6KB，
   其中 90% 是头像，于是一次创作者名录请求要读进几百 KB 的图片字节再全部丢掉。

   改成独立键后：
     user:<email> / profile:<login>  只剩 hasAvatar: true（约 0.5KB）
     avatar:<sid>                    存原始值（data URL 或外链）
   读列表时完全不需要碰头像；只有 GET /avatar/<login> 真发图时才读一次。

   键名用 SID（邮箱 / GitHub 登录名）而不是 handle，是为了避免「改名要搬头像」。 */

function avatarKey(sid) {
  return `avatar:${sid}`;
}

/** 取头像原始值：记录里的外链优先，其次是外置键，最后兼容迁移前的内联 data URL */
async function readAvatarRaw(env, sid, rec) {
  const r = rec || {};
  const inline = String(r.avatar || "");
  if (inline) return inline;
  if (!sid || !r.hasAvatar) return "";
  return (await env.PROFILES.get(avatarKey(sid))) || "";
}

/** 写/清头像。传空串表示删除 */
async function writeAvatarRaw(env, sid, value) {
  const v = String(value || "");
  if (!sid) return;
  if (!v) {
    await env.PROFILES.delete(avatarKey(sid));
    return;
  }
  await env.PROFILES.put(avatarKey(sid), v);
}

/* 移动端（iOS Safari）的 ITP 会拦截跨站 Cookie，导致 solhub_session 存不下来、
   连带着 /me 这类带凭证的请求直接被浏览器掐掉（表现为「连不上认证服务」）。
   解决办法：邮箱登录额外回传一个会话令牌，前端用 X-Solhub-Session 头携带，
   走的是「跨域请求 + 自定义头」而不是第三方 Cookie，ITP 不会拦。 */
function readBearerSession(request) {
  return (request.headers.get("X-Solhub-Session") || "").trim();
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

/* ---------------- 密码凭据独立存放 ----------------
   密码相关字段单独放一个 KV 键：pw:<email> = { s:盐, h:哈希, v:密码版本号 }。
   改密码时只写这个键，绝不整条重写 user:<email>。

   为什么：Cloudflare KV 是最终一致的，读可能拿到边缘缓存里的旧记录。
   如果「读-改-整条写回」，那份旧记录会把后写进去的字段（头像、简介…）覆盖掉 ——
   实测「上传头像后立刻改密码」会把头像抹掉。密码与资料分键后互不牵连。

   凭据的读法与其它数据不同：**不走读穿缓存，只读 KV 边缘（TTL 30s）**。
   读穿缓存是机房本地的、条目 TTL 长达一年，而改密只会在写入的那个机房刷新它，
   其它机房可能一直拿着旧凭据 —— 表现为「刚改完密码，用新密码登录有几率被判密码错误」。
   直接读 KV 边缘，不一致窗口被压到 30 秒且必然自愈。

   老账号的凭据仍在 user:* 里，verifyCredential 会在首次验证时顺手迁移。

   已知限制（Cloudflare KV 的最终一致性，改动前就存在，不是这次新引入的）：
   改密后「旧密码」在别的机房最多还能通过 30~60 秒，旧会话也会在这段时间内继续有效
   （随边缘缓存刷新而失效）。要做到全机房瞬时一致需要 Durable Objects，当前架构不划算。 */

/** 读凭据：绕开读穿缓存，只走 KV 边缘（30s TTL），避免拿到长期陈旧的值 */
async function readCredentialKey(env, key) {
  const raw = await env.PROFILES.get(key, { cacheTtl: 30 });
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** 读候选凭据，顺序即优先级（新的在前） */
async function readCredentialCandidates(env, email) {
  const out = [];
  const latest = await readCredentialKey(env, `pwnew:${email}`);
  if (latest && latest.h && latest.s) out.push({ salt: latest.s, hash: latest.h, ver: latest.v || 0 });
  const cur = await readCredentialKey(env, `pw:${email}`);
  if (cur && cur.h && cur.s) out.push({ salt: cur.s, hash: cur.h, ver: cur.v || 0 });
  return out;
}

/** 写密码凭据：只碰 pw:* 与 pwnew:*，绝不改资料记录 */
async function writeCredential(env, email, salt, hash, ver, extra) {
  const raw = JSON.stringify({ s: salt, h: hash, v: ver || 0, ...(extra || {}) });
  await env.PROFILES.put(`pw:${email}`, raw);
  await env.PROFILES.put(`pwnew:${email}`, raw);
}

/** 当前生效的凭据（用于取密码版本号）：优先用最近一次设置的那份 */
async function readCredential(env, email) {
  const cands = await readCredentialCandidates(env, email);
  if (cands.length) return cands[0];
  /* 老账号兜底：凭据还在 user:* 里，迁移到新键（迁移失败也不影响本次验证） */
  const user = await kvGetJSON(env, `user:${email}`, null, true);
  if (user && user.passHash && user.passSalt) {
    const legacy = { salt: user.passSalt, hash: user.passHash, ver: user.pwdVersion || 0 };
    await writeCredential(env, email, legacy.salt, legacy.hash, legacy.ver);
    return legacy;
  }
  return null;
}

/**
 * 用给定密码验证账号，返回命中的凭据；不匹配返回 null。
 * 候选按「新→旧」依次尝试，保证刚改完密码时新密码一定能登进来。
 * 无论账号是否存在都至少做一次 PBKDF2，避免用响应耗时探测账号是否注册。
 */
async function verifyCredential(env, email, password) {
  const cands = await readCredentialCandidates(env, email);
  if (!cands.length) {
    const user = await kvGetJSON(env, `user:${email}`, null, true);
    if (user && user.passHash && user.passSalt) {
      const legacy = { salt: user.passSalt, hash: user.passHash, ver: user.pwdVersion || 0 };
      await writeCredential(env, email, legacy.salt, legacy.hash, legacy.ver);
      cands.push(legacy);
    }
  }
  let matched = null;
  let lastSalt = null;
  for (const c of cands) {
    /* 两份候选内容相同时（刚改完密码的常态）只算一次 PBKDF2，省一半耗时 */
    if (c.salt === lastSalt) continue;
    lastSalt = c.salt;
    const hit = await hashPassword(password, c.salt) === c.hash;
    if (hit && !matched) matched = c;
  }
  if (!cands.length) {
    /* 账号不存在：照样做一次等价的 PBKDF2，抹平耗时差异 */
    await hashPassword(password, "AAAAAAAAAAAAAAAAAAAAAA==");
  }
  return matched;
}

/* ---------------- 用户名（handle）：对外唯一的公开标识 ---------------- */

const HANDLE_RE = /^[a-z][a-z0-9_]{2,19}$/;

/** 保留名：避免和站内路由、官方身份撞车 */
const RESERVED_HANDLES = new Set([
  "admin", "administrator", "solhub", "official", "support", "help", "api", "www", "root",
  "login", "logout", "register", "signup", "me", "my", "settings", "profile", "world", "feed",
  "products", "product", "submit", "privacy", "terms", "about", "launches", "tools", "guanli",
  "search", "explore", "new", "null", "undefined", "system", "moderator", "staff", "solyoung_top",
]);

function isEmailLogin(id) {
  return String(id || "").includes("@");
}

function normalizeHandle(input) {
  return String(input || "").trim().replace(/^@+/, "").toLowerCase();
}

/** 由邮箱前缀推导一个可读的 handle（仅作候选，冲突时会追加数字） */
function handleFromEmail(email) {
  const local = String(email || "").split("@")[0].toLowerCase();
  let h = local.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(h)) h = `u${h}`;
  h = h.slice(0, 18).replace(/_+$/, "");
  if (h.length < 3) h = `${h}${Math.random().toString(36).slice(2, 3 + (3 - h.length))}`;
  return h.slice(0, 20);
}

/** 分配唯一 handle：优先用户指定的，其次邮箱前缀，冲突时加数字后缀。返回最终 handle。 */
async function allocateHandle(env, email, preferred) {
  let base = normalizeHandle(preferred);
  if (!HANDLE_RE.test(base) || (RESERVED_HANDLES.has(base) && email !== OFFICIAL_LOGIN)) {
    base = handleFromEmail(email);
  }
  if (RESERVED_HANDLES.has(base) && email !== OFFICIAL_LOGIN) base = `${base.slice(0, 18)}_`;
  let candidate = base;
  for (let i = 0; i < 40; i += 1) {
    const owner = await env.PROFILES.get(`handle:${candidate}`, { cacheTtl: 30 });
    if (!owner || owner === email) {
      await env.PROFILES.put(`handle:${candidate}`, email);
      return candidate;
    }
    candidate = `${base.slice(0, 16)}${i + 2}`;
  }
  candidate = `${base.slice(0, 12)}${Math.random().toString(36).slice(2, 7)}`;
  await env.PROFILES.put(`handle:${candidate}`, email);
  return candidate;
}

/** 老账号登录/访问时补一个 handle（只写一次，避免每次读都写 KV） */
async function ensureUserHandle(env, email, user) {
  if (user && HANDLE_RE.test(String(user.handle || ""))) return user.handle;
  const handle = await allocateHandle(env, email, "");
  /* 写之前重新读一次最新记录：调用方手里那份快照可能已经过期，
     直接写回会把后改的字段（头像、简介…）覆盖掉。 */
  const fresh = (await kvGetJSON(env, `user:${email}`, null, true)) || user || {};
  fresh.handle = handle;
  await env.PROFILES.put(`user:${email}`, JSON.stringify(fresh));
  await cacheWrite(env, `user:${email}`, JSON.stringify(fresh));
  return handle;
}

/** SID（内部：邮箱 / GitHub 用户名）→ PID（公开：handle / GitHub 用户名） */
async function pidOf(env, sid) {
  if (!sid) return "";
  if (!isEmailLogin(sid)) return sid;
  const user = await kvGetJSON(env, `user:${sid}`, null, true);
  return (user && user.handle) || handleFromEmail(sid);
}

/** PID（或历史链接里的邮箱）→ SID */
async function sidOf(env, pidOrSid) {
  const id = String(pidOrSid || "").trim();
  if (!id) return "";
  if (isEmailLogin(id)) return id.toLowerCase();
  const raw = id.replace(/^@+/, "");
  const owner = await env.PROFILES.get(`handle:${raw.toLowerCase()}`, { cacheTtl: 30 });
  if (owner) return owner;
  /* GitHub 账号：用户名本身就是公开标识，保持原样 */
  return raw;
}

/** 公开用户快照（入参是 PID，接受旧邮箱） */
/**
 * 判断账号是否真实存在。
 * 邮箱账号看 `user:<email>`，GitHub 账号看 `profile:<login>`（登录时已创建）。
 * 用于挡住「随便一个名字都能打开一个空白主页」的幽灵主页。
 */
async function accountExists(env, sid) {
  if (!sid) return false;
  if (isEmailLogin(sid)) return !!(await env.PROFILES.get(`user:${sid}`, { cacheTtl: 30 }));
  return !!(await env.PROFILES.get(`profile:${sid}`));
}

async function publicUser(env, pidOrSid) {
  const sid = await sidOf(env, pidOrSid);
  if (!sid) return { login: "", name: "", avatar: "", hasAvatar: false };
  if (isEmailLogin(sid)) {
    const u = await kvGetJSON(env, `user:${sid}`, null, true);
    const handle = (u && u.handle) || handleFromEmail(sid);
    return {
      login: handle,
      name: (u && u.displayName) || handle,
      avatar: (u && u.avatar) || "",
      hasAvatar: !!(u && (u.hasAvatar || u.avatar)),
      /* 联系方式是用户主动填写的公开信息，可以展示；邮箱则不在这里暴露 */
      contact: (u && u.contact) || "",
    };
  }
  const profile = await kvGetJSON(env, `profile:${sid}`, {});
  return {
    login: sid,
    name: profile.displayName || sid,
    avatar: profile.avatar || "",
    hasAvatar: !!(profile.hasAvatar || profile.avatar),
    contact: profile.contact || "",
  };
}

/**
 * 把一批记录里的作者标识从 SID 归一成 PID（就地修改）。
 * 历史帖子/评论可能还写着邮箱，这里统一兜住，返回值是映射函数。
 */
async function normalizeAuthors(env, items, field) {
  const emails = [...new Set(items.map((x) => x && x[field]).filter((v) => v && isEmailLogin(v)))];
  const map = new Map();
  if (emails.length) {
    const raws = await kvGetMany(env, emails.map((e) => `user:${e}`));
    emails.forEach((e, i) => {
      let u = {};
      try { u = JSON.parse(raws[i] || "{}"); } catch {}
      map.set(e, u.handle || handleFromEmail(e));
    });
  }
  const conv = (v) => map.get(v) || v;
  for (const item of items) {
    if (item && item[field]) item[field] = conv(item[field]);
  }
  return conv;
}

/** 改名后同步历史帖子与评论里的作者标识（后台执行，最多 200 条） */
async function republishAuthor(env, sid, handle, prevHandle) {
  const ids = await kvGetJSON(env, `feed:user:${sid}`, []);
  const raws = await kvGetMany(env, ids.slice(0, 200).map((id) => `post:${id}`));
  for (let i = 0; i < raws.length; i += 1) {
    if (!raws[i]) continue;
    let post;
    try { post = JSON.parse(raws[i]); } catch { continue; }
    if (post.author !== handle) {
      post.author = handle;
      await kvPutJSON(env, `post:${ids[i]}`, post);
    }
    const comments = await kvGetJSON(env, `post:${ids[i]}:comments`, []);
    let touched = false;
    for (const c of comments) {
      if (c.author === sid || (prevHandle && c.author === prevHandle)) {
        c.author = handle;
        touched = true;
      }
    }
    if (touched) await kvPutJSON(env, `post:${ids[i]}:comments`, comments);
  }
}

/* ---------------- 邮箱用户与会话（KV） ---------------- */

async function createSession(request, env, email, credOverride) {
  const id = crypto.randomUUID() + "-" + toB64(crypto.getRandomValues(new Uint8Array(12)));
  /* 会话同时记 handle 与 pwdVersion：
     - handle 用于「改邮箱后仍能定位到账号」（handle → email 映射会随改邮箱更新）
     - pwdVersion 用于「改密码后让旧会话全部失效」
     credOverride：调用方手里已经拿到最新凭据时直接传进来，
     避免这里再读一次 KV 拿到边缘缓存里的旧版本号（会导致新会话一建立就失效）。 */
  const rec = await kvGetJSON(env, `user:${email}`, null, true);
  const cred = credOverride || (await readCredential(env, email));
  const session = {
    email,
    handle: (rec && rec.handle) || "",
    pwdVersion: (cred && cred.ver) || 0,
    createdAt: new Date().toISOString(),
  };
  await env.PROFILES.put(`session:${id}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });
  return {
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(id)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${SESSION_TTL}`,
    token: id,
  };
}

async function getSessionUser(request, env) {
  const id = readCookie(request, SESSION_COOKIE) || readBearerSession(request);
  if (!id) return null;
  const raw = await env.PROFILES.get(`session:${id}`);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    let email = s.email || "";
    /* 优先用 handle 反查当前邮箱：用户改过邮箱时映射已更新，这里自动跟着走 */
    if (s.handle) {
      const mapped = await env.PROFILES.get(`handle:${s.handle}`, { cacheTtl: 30 });
      if (mapped) email = mapped;
    }
    let userRaw = email ? await env.PROFILES.get(`user:${email}`, { cacheTtl: 30 }) : null;
    /* 兜底：老会话只记了邮箱，改邮箱后走 alias 链找回 */
    let hops = 0;
    while (!userRaw && email && hops < 3) {
      const alias = await env.PROFILES.get(`alias:${email}`, { cacheTtl: 30 });
      if (!alias) break;
      email = alias;
      userRaw = await env.PROFILES.get(`user:${email}`, { cacheTtl: 30 });
      hops += 1;
    }
    if (!userRaw) return null;
    /* 被封禁的账号立即掉线（按匿名处理） */
    if (await env.PROFILES.get(`ban:${email}`)) return null;
    const user = JSON.parse(userRaw);
    /* 密码被重置过：旧会话一律失效。
       密码版本号以 pw:* 为准（改密码只写那个键，不会碰资料记录）；
       老账号还没有 pw:* 时，回落到 user:* 里的版本号。

       判定方向只能是「服务端版本更高 → 本会话已失效」，不能反过来：
       Workers Cache API 是机房本地的（实测 LHR/AMS 交替），读穿缓存可能拿到
       改密之前的旧版本号。若要求版本严格相等，改密后当前这台设备反而会在
       读到旧快照的机房被判失效，把人直接踢下线。
       只在「版本更高」时失效 = 失败安全：宁可让旧会话多活一会儿，
       也不误杀当前会话。KV 边缘缓存 60 秒内刷新后，旧会话随即失效。 */
    const sv = s.pwdVersion || 0;
    /* 密码版本：读 KV 边缘（30s TTL），不走读穿缓存 —— 后者机房本地且 TTL 一年，
       改密后其它机房可能长期拿着旧版本号。判定方向只能是「服务端版本更高 → 失效」，
       读到旧值就保守放过，宁可让旧会话多活一会儿，也不误杀当前设备。 */
    const latest = await readCredentialKey(env, `pwnew:${email}`);
    let uv;
    if (latest && typeof latest.v === "number") {
      uv = latest.v;
    } else {
      const cur = await readCredentialKey(env, `pw:${email}`);
      uv = cur && typeof cur.v === "number" ? cur.v : (user.pwdVersion || 0);
    }
    if (uv > sv) return null;
    return {
      email: user.email,
      handle: user.handle || "",
      displayName: user.displayName || "",
      bio: user.bio || "",
      location: user.location || "",
      website: user.website || "",
      contact: user.contact || "",
      emailPublic: !!user.emailPublic,
      emailVerified: !!user.emailVerified,
      avatar: user.avatar || "",
      hasAvatar: !!(user.hasAvatar || user.avatar),
      verified: !!user.verified,
    };
  } catch {
    return null;
  }
}

/* ---------------- 身份统一 ---------------- */
/* 只认邮箱会话。GitHub OAuth 通道已于 2026-11 下线：那条链路要 public_repo 权限，
   而前端早已没有 GitHub 登录入口，只剩一个能被任意人触发的授权跳转。 */

async function getIdentity(request, env) {
  const session = await getSessionUser(request, env);
  if (session) return { type: "email", login: session.email, user: session };
  return null;
}

/* ---------------- 世界（社交）：帖子 / 点赞 / 评论 / 关注 ---------------- */

const POST_MAX = 500;
const COMMENT_MAX = 300;
const FEED_CAP = 300;

/* ---------------- 资料读穿缓存（绕开 KV 最终一致性） ----------------
   Cloudflare KV 的读走边缘缓存（默认 60s，cacheTtl 下限 30s），
   写完之后立刻读常常拿到旧值 —— 表现就是「刚打开公开邮箱，页面还显示不公开」，
   也会让「刚收到的验证码立刻输却提示不正确」。
   这里在 KV 之上叠一层 Workers Cache API：同一数据中心内写入立即可见，
   跨机房最多等一次 KV 刷新（30s）。 */
const KV_CACHE_HOST = "https://solhub-kvcache.internal/";

function kvCacheRequest(key) {
  return new Request(KV_CACHE_HOST + encodeURIComponent(key));
}

/* 2026-11-02: 读穿缓存（caches.default）已弃用。
   实测 Workers Cache API 在边缘的读/写延迟极不稳定（偶发 18s+ 卡死），
   导致 /me、登录等认证接口间歇超时、前端报「网络错误」。
   改为直接读 KV（见 kvGetJSON）。这里保留空实现，避免改动大量调用点。 */
async function cacheRead(env, key) {
  return null;
}
async function cacheWrite(env, key, raw) {
  /* no-op: 读穿缓存已移除 */
}
async function cacheDrop(env, key) {
  /* no-op: 读穿缓存已移除 */
}

/* Cloudflare KV 是最终一致的，边缘缓存默认 60s。
   2026-11-02: 原先在 KV 之上叠了一层 Workers Cache API 读穿缓存，
   但该缓存边缘读/写延迟极不稳定（偶发 18s+ 卡死），是认证接口间歇超时的根因。
   现改为直接读 KV 并加 cacheTtl:30 边缘缓存：稳定且足够一致（最坏 30s 最终一致）。 */
async function kvGetJSON(env, key, fallback, fresh) {
  const raw = await env.PROFILES.get(key, { cacheTtl: 30 });
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
async function kvPutJSON(env, key, val) {
  await env.PROFILES.put(key, JSON.stringify(val));
}

/* ---------------- 限流（基于 Workers 内置 Cache API） ---------------- */

const RL_PREFIX = "https://rl.solhub.internal/";

/** 取客户端 IP。
 *  Cloudflare 部署时由 CF-Connecting-IP 给出；CloudBase 走 HTTP 网关，
 *  只能读 X-Forwarded-For —— 这里取**最右一跳**：最左边是客户端自己填的，
 *  攻击者随手就能伪造成任意值，拿它当限流键等于没有限流。
 *  （网关会把自己看到的对端地址追加在末尾，最右一跳才是它真实看到的地址。） */
function clientIp(request) {
  const cf = request.headers.get("CF-Connecting-IP") || "";
  if (cf.trim()) return cf.trim().slice(0, 64);
  const xff = String(request.headers.get("X-Forwarded-For") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const last = xff.length ? xff[xff.length - 1] : "";
  const real = String(request.headers.get("X-Real-IP") || "").trim();
  return (last || real).slice(0, 64) || "unknown";
}

/**
 * 读取限流计数（只读，不写入）。
 * 用 Cache API 而不是 KV：免费额度每天只有 1,000 次写入，
 * 若用 KV 记失败次数，一次暴力破解就能把发帖/评论的写入额度烧光（自我 DoS）。
 * Cache 按机房生效，挡住「针对单个账号的暴力破解」已经足够。
 */
async function rateLimitPeek(key) {
  try {
    const hit = await caches.default.match(RL_PREFIX + encodeURIComponent(key));
    if (!hit) return { count: 0, startedAt: 0 };
    const rec = await hit.json();
    return { count: rec && rec.n ? rec.n : 0, startedAt: rec && rec.t ? rec.t : 0 };
  } catch {
    return { count: 0, startedAt: 0 };
  }
}

/** 记一次（失败/使用）并返回当前计数 */
async function rateLimitHit(key, windowSec) {
  try {
    const url = RL_PREFIX + encodeURIComponent(key);
    const cache = caches.default;
    const hit = await cache.match(url);
    const now = Date.now();
    let n = 0;
    let t = now;
    if (hit) {
      try {
        const rec = await hit.json();
        if (rec && now - rec.t < windowSec * 1000) { n = rec.n || 0; t = rec.t; }
      } catch { /* 坏缓存忽略 */ }
    }
    n += 1;
    await cache.put(url, new Response(JSON.stringify({ n, t }), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${windowSec}` },
    }));
    return n;
  } catch {
    return 0;
  }
}

/** 清空某个计数（成功登录后调用） */
async function rateLimitClear(key) {
  try {
    await caches.default.delete(RL_PREFIX + encodeURIComponent(key));
  } catch { /* 忽略 */ }
}

/** 距离限流窗口结束还有多少秒 */
function retryAfterSec(startedAt, windowSec) {
  return Math.max(1, Math.ceil((startedAt + windowSec * 1000 - Date.now()) / 1000));
}

/* ---------------- SSRF 防护 ---------------- */

/** 本机/内网/云元数据地址：Worker 不应代为访问 */
const PRIVATE_HOST_RES = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.home$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^fc00:/i,
  /^fe80:/i,
  /^::$/,
];

/**
 * 校验待访问的 URL：只允许 http(s)，且不能指向本机/内网/元数据地址。
 * 返回 { ok: true, url } 或 { ok: false, error }。
 */
function assertPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return { ok: false, error: "URL 格式不正确" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "只支持 http(s) 链接" };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, error: "URL 缺少主机名" };
  if (PRIVATE_HOST_RES.some((re) => re.test(host))) {
    return { ok: false, error: "不能指向本机或内网地址" };
  }
  return { ok: true, url: u };
}

/* 站点可达性判定的统一口径：2xx/3xx 都算可达（HEAD 不再自动跟随重定向，
   3xx 由浏览器自己跳），403 常见于防盗链但站点确实存在，也放过。 */
function reachableStatus(code) {
  return code === 403 || (code >= 200 && code < 400);
}

/* ---------------- 邮件验证码（阿里云 DirectMail） ---------------- */

/**
 * 验证码用途。不同用途的验证码互相独立、互不通用：
 *   register  注册时验证该邮箱归属
 *   verify    已登录用户验证「当前邮箱」
 *   change    已登录用户验证「新邮箱」（通过后才允许切换）
 *   reset     找回密码
 */
/* 产品与工具分类的中文名，跟 src/data/product-categories.ts 保持一致。
   /catalog 要给小程序返回可直接展示的名字，而 Worker 读不了 TS。 */
const CATEGORY_NAMES = {
  "creator-space": "个人数字空间",
  "services": "设计与服务",
  "ai-tools": "AI 工具",
  "productivity": "效率工具",
  "creator-tools": "创作者工具",
  "fun-tools": "趣味工具",
  "growth-marketing": "增长营销",
  "design-tools": "设计工具",
};

const VCODE_PURPOSES = ["register", "verify", "change", "reset"];
const VCODE_TTL = 600;            // 验证码有效期 10 分钟
const VCODE_COOLDOWN = 60;        // 同一邮箱重发冷却（秒）
const VCODE_WINDOW_MAX = 3;       // 同一邮箱 10 分钟内最多发码次数
/* 全站每日 / 累计发码预算 —— 费用的第一道防线。
 *
 * 为什么必须放 KV，不能放 Cache API：
 *   Workers Cache API 是 data center local（官方文档明说数据不跨机房同步），
 *   本项目实测 request.cf.colo 在 LHR / AMS 之间跳变 —— 跨机房计数各算各的。
 *   拿它当限额用等于形同虚设：攻击者把请求分散到多个机房，日额度能被放大几十倍，
 *   直接把阿里云的免费额度烧穿并产生真金白银的账单。
 *   KV 全球收敛，才是权威计数。
 *
 * 阿里云侧的闸门（重要，别再找错地方）：
 *   官方明确「邮件推送无法设置每日发送上限额度」—— 控制台里没有这个选项。
 *   账号级唯一的闸门是「概览页 → 最高信誉等级限制」，1 级 = 500 封/天，这是地板。
 *   免费额度规则：每个主账户共 2000 封，每天最多免费发 200 封；超出按 ¥2/千 计费
 *   （一封验证码 ¥0.002）。所以真正让账单恒为 0 的是 Worker 侧的这两个数。
 */
const VCODE_DAILY_BUDGET = 150;     // 单日发码上限（留 25% 余量给 200 封/天免费额度）
const VCODE_TOTAL_BUDGET = 1800;    // 累计发码上限（留 10% 余量给 2000 封总免费额度）

/** 额度可被环境变量覆盖（联调时调小便于验证阈值；不设则用上面的默认值） */
function dailyBudget(env) { return Number(env.DM_DAILY_BUDGET) || VCODE_DAILY_BUDGET; }
function totalBudget(env) { return Number(env.DM_TOTAL_BUDGET) || VCODE_TOTAL_BUDGET; }

/**
 * RFC3986 百分号编码。
 * 规则与阿里云官方 SDK（@alicloud/openapi-core）的 encode() 完全一致：
 * encodeURIComponent 之后再把 ! ' ( ) * 补编码（~ 保持原样）。
 * 必须与服务端一致，否则签名会返回 SignatureDoesNotMatch。
 */
function percentEncode(str) {
  return encodeURIComponent(String(str == null ? "" : str))
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/**
 * 阿里云 RPC 风格签名（HMAC-SHA1）。
 * 密钥 = AccessKeySecret + "&"，StringToSign = METHOD&%2F&percentEncode(规范化查询串)。
 */
async function aliyunSignature(params, secret) {
  const names = Object.keys(params).filter((k) => k !== "Signature").sort();
  const canonical = names.map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${secret}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  let bin = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * 阿里云配额 / 限流类错误判定。
 * 命中后要做两件事：给用户友好提示，以及在 Worker 侧熔断（当天不再白跑阿里云）。
 * 签名 / 鉴权类错误要排除掉 —— 那是配置问题，不是额度问题，熔断只会掩盖它。
 */
function isQuotaError(code, message) {
  const s = `${code || ""} ${message || ""}`.toLowerCase();
  if (/invalidaccesskey|signaturedoesnotmatch|unauthorized|forbidden|nosuch|notfound|invalidaccount/.test(s)) return false;
  return /quota|limitexceeded|dailylimit|accountlimit|exceed|throttl|overload|toomany/.test(s);
}

/**
 * 通过阿里云 DirectMail 发送单封邮件（SingleSendMail）。
 * 失败时返回 { ok:false, error }，不会抛异常。
 */
async function sendMail(env, opts) {
  const akId = env.DM_ACCESS_KEY_ID;
  const akSecret = env.DM_ACCESS_KEY_SECRET;
  const sender = env.DM_SENDER;
  if (!akId || !akSecret || !sender) {
    return { ok: false, error: "邮件服务尚未配置，暂无法发送验证码" };
  }
  /* 干跑模式：不真正调用阿里云，但把后面的校验流程全部跑完 */
  if (env.DM_DRY_RUN === "1") return { ok: true, dryRun: true };

  const params = {
    AccessKeyId: akId,
    Action: "SingleSendMail",
    AccountName: sender,
    AddressType: "1",
    ReplyToAddress: "true",
    Subject: opts.subject,
    ToAddress: opts.to,
    HtmlBody: opts.html,
    TextBody: opts.text || "",
    FromAlias: env.DM_FROM_ALIAS || "SolHub",
    ClickTrace: "0",
    Format: "JSON",
    RegionId: env.DM_REGION_ID || "cn-hangzhou",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    Version: "2015-11-23",
  };
  if (env.DM_TAG) params.TagName = env.DM_TAG;

  try {
    const signature = await aliyunSignature(params, akSecret);
    const body =
      Object.keys(params).map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&") +
      `&Signature=${percentEncode(signature)}`;
    const res = await fetch("https://dm.aliyuncs.com/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
    if (!res.ok || data.Code) {
      const code = data.Code || `HTTP${res.status}`;
      const msg = data.Message || data.RequestId || text.slice(0, 200);
      /* 配额类错误（免费额度用尽 / 日额度触顶）：置位熔断，避免反复去撞阿里云。
         注意：阿里云控制台没有「每日发送量上限」这个设置，账号级唯一的闸门是
         「概览页 → 最高信誉等级限制」（1 级 = 500 封/天）。Worker 侧的每日/累计配额
         才是费用的主防线，这里只是别把错误码甩给用户看。 */
      if (isQuotaError(code, msg)) {
        try {
          await env.PROFILES.put("vcode:fuse", JSON.stringify({ until: Date.now() + 3600 * 1000, code }), {
            expirationTtl: 7200,
          });
        } catch { /* 忽略 */ }
        return { ok: false, quota: true, error: "验证码服务暂时受限，请稍后再试", detail: msg };
      }
      return { ok: false, error: `邮件发送失败（${code}）`, detail: msg };
    }
    return { ok: true, requestId: data.RequestId || "" };
  } catch (e) {
    return { ok: false, error: "邮件发送失败：网络异常，请稍后重试" };
  }
}

/** 验证码邮件正文（HTML + 纯文本双份，兼容各家客户端） */
function verificationMailHtml(code, purposeText, siteName) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 16px;font-size:20px">${siteName} 邮箱验证码</h2>
  <p style="margin:0 0 16px;line-height:1.7;color:#444">${purposeText}</p>
  <div style="margin:24px 0;padding:18px 20px;background:#f6f7f9;border-radius:10px;text-align:center">
    <span style="font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</span>
  </div>
  <p style="margin:0 0 8px;line-height:1.7;color:#666;font-size:13px">验证码 <strong>10 分钟</strong>内有效，仅可使用一次。若非本人操作，请忽略本邮件。</p>
  <p style="margin:0;line-height:1.7;color:#999;font-size:12px">${siteName} 只会用这个邮箱给你发送验证码与账户安全通知。</p>
</div>`;
}

/** 生成 6 位数字验证码（密码学随机） */
function newVerifyCode() {
  const buf = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(buf % 1000000).padStart(6, "0");
}

/**
 * 验证码的存储结构 —— 「码即键」。
 *
 *   vcode:<用途>:<邮箱>:<验证码>   一枚验证码一个键，TTL 10 分钟
 *   vcode:meta:<用途>:<邮箱>       { w 最近发码时间, s 窗口内次数, n 错误次数, l 锁定到 }
 *
 * 为什么不用「固定键存当前码」：
 *   Cloudflare KV 是最终一致的，写完立刻读可能读到旧值。
 *   如果把码存在固定键里，后一次发码会覆盖前一次，
 *   而覆盖是否发生取决于读没读到旧值 —— 结果就是
 *   「用户收到两封邮件，只有其中一封的码能用，注册直接失败」。
 *   实测中这个故障反复出现（连续两次联调结果不一致）。
 *
 * 把验证码本身放进键名之后：
 *   1. 多枚码天然并存、互不覆盖，用户手上任何一封邮件里的码都还有效；
 *   2. 校验 = 按输入的码精确 get，命中即通过，不需要任何读-改-写；
 *   3. 唯一性由 KV 保证（同一个码发两次也只是覆盖同一个键，值相同）。
 */
function vcodeKey(purpose, email, code) {
  return `vcode:${purpose}:${email}:${code}`;
}
function vcodeMetaKey(purpose, email) {
  return `vcode:meta:${purpose}:${email}`;
}

/**
 * 猜错次数与锁定（存在 meta 键里，和冷却/窗口计数合并，省 KV 写）。
 *
 * 为什么不能用 Cache API 计数：
 *   Cache 是 data center local，跨机房各算各的。实测连续猜错的提示在
 *   4,4,3,2,3,2,1,1 之间乱跳 —— 计数根本不单调，锁定永远不触发。
 *
 * 为什么锁定要单独用「置位时间 l」而不是直接看计数 n：
 *   KV 是最终一致，读-改-写会把更大的计数覆盖成更小的（偶发）。
 *   而 l 一旦置上就持续写回（后续猜错时保留原值），只在「发新码」时清零，
 *   所以锁定状态是稳定的，不会被回退抹掉。
 *
 * 安全边界不在这里 —— 在于「每次猜错都消耗 1 次 KV 写」：
 *   KV 免费版每天 1000 次写，等于把全站每天的猜码次数钉死在 1000 次，
 *   6 位码的命中率只有 0.1%/天。这道闸跟缓存无关，谁都绕不过。
 */
const VCODE_LOCK_AT = 3;        // 猜错达到该次数即锁定

async function takeVCode(env, purpose, email, input) {
  const code = String(input || "").trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "验证码不正确" };
  const metaKey = vcodeMetaKey(purpose, email);
  const meta = (await kvGetJSON(env, metaKey, null, true)) || {};
  const now = Date.now();
  /* 已锁定：只挡「继续猜码」，发码不受影响（发码是用户唯一的自救手段） */
  if (meta.l && now - meta.l < VCODE_TTL * 1000) {
    return { ok: false, error: "验证码尝试次数过多，请重新获取验证码" };
  }
  /* 码即键：按输入的码精确查找，命中即通过。
     必须实时读：验证码是刚写进去的，走边缘缓存会读到「不存在」，
     表现为「刚收到的码立刻输却提示不正确」。 */
  const key = vcodeKey(purpose, email, code);
  if (!(await env.PROFILES.get(key, { cacheTtl: 30 }))) {
    const n = (meta.n || 0) + 1;
    const l = meta.l || (n >= VCODE_LOCK_AT ? now : 0);
    await env.PROFILES.put(metaKey, JSON.stringify({ ...meta, n, l }), { expirationTtl: VCODE_TTL });
    return { ok: false, error: "验证码不正确" };
  }
  /* 命中：立即作废这一枚码（一次性使用） */
  await env.PROFILES.delete(key);
  return { ok: true };
}

/**
 * 跟随 alias 链，找出该邮箱当前对应的有效账号邮箱。
 * 用户改过邮箱后，旧邮箱记录会被删除，这里通过 alias:<old> → <new> 找回。
 * 返回空串表示这个邮箱既不是现有账号，也不是任何账号的旧地址。
 */
async function resolveCurrentEmail(env, email) {
  let cur = String(email || "").trim().toLowerCase();
  for (let i = 0; i < 3; i++) {
    if (!cur) return "";
    if (await env.PROFILES.get(`user:${cur}`, { cacheTtl: 30 })) return cur;
    const alias = await env.PROFILES.get(`alias:${cur}`, { cacheTtl: 30 });
    if (!alias) return "";
    cur = alias;
  }
  return "";
}

/** 用途 → 邮件里的一句话说明 */
function vcodePurposeText(purpose) {
  if (purpose === "register") return "欢迎加入 SolHub，请输入下面的验证码完成注册。";
  if (purpose === "verify") return "请输入下面的验证码确认你的邮箱归属。";
  if (purpose === "change") return "请输入下面的验证码以确认新邮箱归属，验证通过后邮箱才会切换。";
  return "请输入下面的验证码以重置你的 SolHub 密码。";
}

/**
 * 是否为联调请求：仅当 DM_DRY_RUN=1 且请求头带正确的联调密钥时成立。
 * 生产环境不设 DM_DRY_RUN，因此这条路径不存在；联调时可绕过「同 IP 限流」，
 * 免得调试过程中的计数把后续验证全部挡在门外。
 */
function isDevRequest(request, env) {
  return env.DM_DRY_RUN === "1" && !!env.DM_DEV_KEY && request.headers.get("X-Dev-Key") === env.DM_DEV_KEY;
}

/**
 * 占用一次发码配额（KV，全局权威计数）。
 *
 * 先占后发：并发下不会超发。发信失败时用 releaseVCodeQuota 退回。
 * 计数是「读-改-写」，KV 最终一致下偶尔会丢一两次增量 —— 对限额而言，
 * 丢增量意味着最多多放行几封，量级远小于预算本身，可以接受。
 */
async function claimVCodeQuota(env) {
  const today = new Date().toISOString().slice(0, 10);
  const q = (await kvGetJSON(env, "vcode:quota", null, true)) || {};
  const day = q.d === today ? (q.day || 0) : 0;   // 跨天自动归零
  const total = q.total || 0;
  if (day >= dailyBudget(env)) {
    return { ok: false, error: "今日验证码发送额度已用尽，请明天再试" };
  }
  if (total >= totalBudget(env)) {
    return { ok: false, error: "免费发信额度即将用尽，验证码发送已暂停，请联系管理员" };
  }
  await env.PROFILES.put(
    "vcode:quota",
    JSON.stringify({ d: today, day: day + 1, total: total + 1 }),
    { expirationTtl: 31536000 }, // 1 年不清理
  );
  return { ok: true };
}

/** 退回一次配额（发信失败时调用，避免临时故障白白吃掉当天额度） */
async function releaseVCodeQuota(env) {
  const today = new Date().toISOString().slice(0, 10);
  const q = (await kvGetJSON(env, "vcode:quota", null, true)) || {};
  const day = q.d === today ? Math.max(0, (q.day || 0) - 1) : 0;
  const total = Math.max(0, (q.total || 0) - 1);
  await env.PROFILES.put(
    "vcode:quota",
    JSON.stringify({ d: today, day, total }),
    { expirationTtl: 31536000 },
  );
}

/**
 * 下发一枚验证码：多重限流 → 写 KV → 发信 → 记账。
 *
 * 关键设计（都是踩过坑之后定下来的）：
 *  1. 每枚验证码单独占一个 KV 键（键里带码），多枚码互不覆盖，
 *     用户手上任何一封邮件里的码都还能用 —— 见 vcodeKey 的注释。
 *  2. 冷却 / 窗口次数记在 meta 键里。KV 最终一致会让这几个计数偶尔失效，
 *     但失效的后果只是「多发一封邮件」，而不是「用户的码被作废」，这是可接受的降级。
 *  3. 每日 / 累计配额放 KV（见 VCODE_DAILY_BUDGET 的注释），
 *     这才是费用的第一道防线；阿里云侧只有「最高信誉等级限制」这道 500 封/天的地板。
 *  4. 每发一封验证码消耗 3 次 KV 写（码键 + meta 键 + 配额键）。
 *     按每日 150 封的上限算 = 450 次写，加上发帖等业务写会逼近免费版 1000 次/天的上限，
 *     所以流量上来后应把验证码与配额迁到 Durable Objects（强一致 + 原子计数）。
 * 返回 { status, body }，由调用方直接 json() 输出。
 */
async function issueCode(request, env, purpose, target) {
  const devMode = isDevRequest(request, env);
  const now = Date.now();
  const metaKey = vcodeMetaKey(purpose, target);

  /* 1) 熔断标记：阿里云返回配额类错误后置位，当天不再白跑 */
  const fuse = await kvGetJSON(env, "vcode:fuse", null, true);
  if (!devMode && fuse && fuse.until && fuse.until > now) {
    return { status: 429, body: { error: "今日验证码发送额度已用尽，请明天再试" } };
  }

  /* 2) 全站每日 / 累计配额（KV 权威计数，全球收敛）
        阿里云侧没有「每日发送量上限」可设，账号级地板是 500 封/天，
        所以费用能不能压到 0 取决于这两行数。
        注意：配额在干跑模式下同样生效 —— 联调时可用 DM_DAILY_BUDGET 调小来验证阈值。 */
  const claim = await claimVCodeQuota(env);
  if (!claim.ok) {
    return { status: 429, body: { error: claim.error } };
  }
  let quotaClaimed = true;

  /* 3) 元数据：冷却 / 窗口次数（实时读：冷却窗口要能立刻生效） */
  const meta = (await kvGetJSON(env, metaKey, null, true)) || {};
  if (meta.w && now - meta.w < VCODE_COOLDOWN * 1000) {
    return { status: 429, body: { error: `请 ${retryAfterSec(meta.w, VCODE_COOLDOWN)} 秒后再获取验证码` } };
  }
  if ((meta.s || 0) >= VCODE_WINDOW_MAX) {
    return { status: 429, body: { error: `同一邮箱 10 分钟内最多获取 ${VCODE_WINDOW_MAX} 次验证码，请 ${retryAfterSec(meta.w || now, VCODE_TTL)} 秒后再试` } };
  }

  /* 4) 同一 IP 每小时最多 10 次（Cache：机房内粗粒度兜底，跨机房不共享，仅作辅助） */
  const ipKey = `vcode:ip:${clientIp(request).replace(/[^a-zA-Z0-9.:_-]/g, "")}`;
  const ip = await rateLimitPeek(ipKey);
  if (!devMode && ip.count >= 10) {
    return { status: 429, body: { error: `发码过于频繁，请 ${retryAfterSec(ip.startedAt, 3600)} 秒后再试` } };
  }

  /* 5) 落码：一枚码一个键，天然并存、互不覆盖 */
  const code = newVerifyCode();
  await env.PROFILES.put(vcodeKey(purpose, target, code), JSON.stringify({ t: now }), {
    expirationTtl: VCODE_TTL,
  });
  /* 6) 更新元数据：冷却起点 + 窗口次数，并清零猜错次数与锁定
        （重新发码 = 用户自救，给回新的 5 次机会） */
  await env.PROFILES.put(metaKey, JSON.stringify({
    w: now,
    s: (meta.s || 0) + 1,
    n: 0,
    l: 0,
  }), { expirationTtl: VCODE_TTL });

  const sent = await sendMail(env, {
    to: target,
    subject: `【SolHub】邮箱验证码 ${code}`,
    html: verificationMailHtml(code, vcodePurposeText(purpose), "SolHub"),
    text: `你的 SolHub 验证码是 ${code}，10 分钟内有效，仅可使用一次。${vcodePurposeText(purpose)}`,
  });
  if (!sent.ok) {
    /* 发信失败：撤掉这枚码 + 退回配额，让用户可以立即重试 */
    await env.PROFILES.delete(vcodeKey(purpose, target, code));
    if (quotaClaimed) await releaseVCodeQuota(env);
    if (sent.quota) {
      return { status: 429, body: { error: "验证码服务暂时受限，请稍后再试" } };
    }
    return { status: 502, body: { error: sent.error } };
  }
  await rateLimitHit(ipKey, 3600);
  /* 干跑模式：只有在同时提供正确的联调密钥时才回传验证码。
     生产环境不设 DM_DRY_RUN，因此这条路径根本不存在。 */
  return { status: 200, body: { ok: true, sent: true, cooldown: VCODE_COOLDOWN, ...(devMode ? { devCode: code } : {}) } };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 取用户展示信息快照（昵称/头像/认证）；login 为公开标识 PID，不含邮箱 */
async function displayOf(env, identity) {
  if (identity.type === "email") {
    const u = identity.user;
    return {
      login: u.handle || handleFromEmail(u.email),
      name: u.displayName || (u.handle || handleFromEmail(u.email)),
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

/** 兼容旧调用：按公开标识取作者快照 */
async function authorOf(env, pidOrSid) {
  return publicUser(env, pidOrSid);
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
/**
 * 社区产品/官方目录的缓存键。
 *
 * 设计要点：目录数据（社区提交 + 官方目录索引）在每次提交/改动后写入 KV，
 * 读取一律「KV 优先」。只有在 KV 还没灌过数据的情况下才回退到 GitHub 仓库文件
 * （需要 GITHUB_PAT），拿到后立刻写回 KV 缓存。
 * 这样即使 GITHUB_PAT 失效 / 过期 / 未配置，个人主页与「我的收录」依旧可用。
 */
const KV_COMMUNITY = "catalog:community:v1";
const KV_INDEX = "catalog:index:v1";

/** 从 GitHub 仓库读取一个 JSON 文件（内部工具，失败返回 null）。 */
async function githubJSON(env, path) {
  if (!env.GITHUB_PAT) return null;
  try {
    const res = await fetch(`${API}/repos/${REPO}/contents/${path}?ref=main`, {
      headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
    });
    const data = await res.json();
    if (!data.content) return null;
    return JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))));
  } catch {
    return null;
  }
}

/** 读取社区提交的产品：KV 优先，其次仓库文件（并写回 KV 缓存）。 */
async function readCommunity(env) {
  const cached = await kvGetJSON(env, KV_COMMUNITY, null);
  if (cached) return cached;
  const fromRepo = await githubJSON(env, "src/data/community.json");
  if (fromRepo) await kvPutJSON(env, KV_COMMUNITY, fromRepo);
  return fromRepo || [];
}

/** 读取官方目录索引（构建时由 products.ts 生成）：KV 优先，其次仓库文件。 */
async function readProductIndex(env) {
  const cached = await kvGetJSON(env, KV_INDEX, null);
  if (cached) return cached;
  const fromRepo = await githubJSON(env, "src/data/product-index.json");
  if (fromRepo) await kvPutJSON(env, KV_INDEX, fromRepo);
  return fromRepo || [];
}

/** 把仓库里的社区数据推回 GitHub（尽力而为：无 PAT 或失败都不抛错）。 */
/**
 * 把社区数据写回仓库，并带上失败原因。
 * 静态站的产品列表是构建期从 src/data/community.json 烘进去的，仓库没写成功
 * 就等于「用户在站内删了，产品页还在」——所以这里必须能说清为什么失败。
 */
async function pushCommunityToRepo(env, community, message) {
  if (!env.GITHUB_PAT) return { ok: false, error: "未配置 GITHUB_PAT" };
  try {
    const cur = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json?ref=main`, {
      headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
    });
    if (cur.status === 401) return { ok: false, error: "GITHUB_PAT 无效或已过期（401）" };
    if (cur.status === 403) return { ok: false, error: "GITHUB_PAT 权限不足（403）" };
    if (!cur.ok) return { ok: false, error: `读取仓库文件失败（${cur.status}）` };
    const curData = await cur.json();
    if (!curData.sha) return { ok: false, error: "仓库文件缺少 sha" };
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(community, null, 2))));
    const writeRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub", "Content-Type": "application/json" },
      body: JSON.stringify({ message, content, sha: curData.sha }),
    });
    const writeData = await writeRes.json().catch(() => ({}));
    if (!writeData.commit) {
      return { ok: false, error: writeData.message || `写入仓库失败（${writeRes.status}）` };
    }
    return { ok: true, commit: String(writeData.commit.sha || "").slice(0, 7) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

async function syncCommunityToRepo(env, community, message) {
  return (await pushCommunityToRepo(env, community, message)).ok;
}

/** 只读探测：用 GITHUB_PAT 能不能读到仓库的 community.json（运维自检用） */
async function probeCommunityRepo(env) {
  if (!env.GITHUB_PAT) return { ok: false, error: "未配置 GITHUB_PAT" };
  try {
    const res = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json?ref=main`, {
      headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
    });
    if (!res.ok) return { ok: false, status: res.status, error: `读取仓库文件失败（${res.status}）` };
    const data = await res.json();
    if (!data.content) return { ok: false, error: "仓库文件没有内容" };
    const arr = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))));
    return {
      ok: true,
      count: Array.isArray(arr) ? arr.length : 0,
      slugs: (Array.isArray(arr) ? arr : []).map((p) => p && p.slug).filter(Boolean),
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
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

/**
 * 托管工具 → 主页作品卡。
 * 上传即上线，所以也计入「作品」：href 是站内链接（前端按 locale 本地化），
 * 不走 ensureHttps；网站类作品的 websiteUrl 仍是外链。
 */
function hostedCard(t, imgBase) {
  const href = `/tools/?id=${t.id}`;
  return {
    slug: `tool-${t.id}`,
    name: t.name,
    shortDescription: t.description || "",
    icon: t.hasLogo ? `${imgBase}/hosted/logo/${t.id}` : "",
    websiteUrl: href,
    href,
    kind: "tool",
    category: t.category || "productivity",
    tags: Array.isArray(t.tags) ? t.tags.slice(0, 6) : [],
    verificationStatus: "pending",
    publishedAt: t.createdAt || "",
  };
}

/**
 * 某个 PID 名下的托管工具（按公开目录索引聚合，不额外读库）。
 * 索引只带 ownerPid，没有邮箱，可以直接用于公开主页。
 */
function hostedCardsOf(index, pid, imgBase) {
  if (!pid) return [];
  return index
    .filter((t) => t && t.id && !t.hidden && t.ownerPid && t.ownerPid === pid)
    .map((t) => hostedCard(t, imgBase));
}

/** 认领列表（容错：非数组或脏值一律忽略） */function claimedSlugsOf(user) {
  if (!user || !Array.isArray(user.productSlugs)) return [];
  return user.productSlugs.filter((s) => typeof s === "string" && s.length < 80).slice(0, 50);
}

/**
 * 官方目录里「开发者标识 = 该用户公开标识」的产品，视为该用户拥有的作品。
 * 这样目录中的作品会自动出现在其个人主页，无需额外维护 productSlugs。
 */
function ownedSlugsOf(index, login) {
  if (!login || !Array.isArray(index)) return [];
  return index.filter((p) => p && typeof p.slug === "string" && String(p.developerLogin || "") === login).map((p) => p.slug);
}

/** 该用户在个人主页上应展示的全部认领 slug（目录归属 + 手动认领，去重） */
function allClaimedSlugs(index, login, user) {
  return [...new Set([...ownedSlugsOf(index, login), ...claimedSlugsOf(user)])];
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

/**
 * 取一页信息流。offset 是 feed 数组下标（不是「已返回条数」），
 * nextOffset 会定位到「本页展示的最后一条」的下一位：
 * 被封禁作者被过滤掉时既不会重复，也不会把中间没展示的帖子跳过。
 * 碰到整批都被过滤的极端情况，最多再往下摸两批把这一页填满。
 */
async function feedPage(env, ids, viewer, limit, imgBase, offset = 0) {
  const start = Math.max(0, Math.min(Number(offset) || 0, ids.length));
  let cursor = start;
  let visible = [];
  for (let round = 0; round < 3 && cursor < ids.length; round += 1) {
    const batch = ids.slice(cursor, cursor + limit * 2);
    cursor += batch.length;
    const posts = (await Promise.all(batch.map((id) => hydratePost(env, id, viewer)))).filter(Boolean);
    if (posts.length) {
      /* 隐藏被封禁作者的内容（封禁键同时写了邮箱与 handle 两份，历史数据也能命中） */
      const authors = [...new Set(posts.map((p) => p.author))];
      const bans = await kvGetMany(env, authors.map((a) => `ban:${a}`));
      const banned = new Set(authors.filter((a, i) => bans[i]));
      visible = visible.concat(banned.size ? posts.filter((p) => !banned.has(p.author)) : posts);
    }
    if (visible.length >= limit) break;
  }

  const shown = visible.slice(0, limit);
  /* 对外统一用 handle 作为作者标识 */
  await normalizeAuthors(env, shown, "author");
  /* 头像改成短链接（见 avatarUrl 注释） */
  for (const p of shown) p.authorAvatar = avatarUrl(imgBase, p.author, p.authorAvatar);

  let nextOffset = cursor;
  if (shown.length) {
    const last = ids.indexOf(shown[shown.length - 1].id, start);
    if (last >= 0) nextOffset = last + 1;
  }
  return { posts: shown, nextOffset, hasMore: nextOffset < ids.length };
}

async function feedPosts(env, ids, viewer, limit, imgBase) {
  return (await feedPage(env, ids, viewer, limit, imgBase, 0)).posts;
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
async function searchUsers(env, q, limit, imgBase) {
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
    /* 对外只露出 handle / GitHub 用户名，邮箱不参与搜索、也不返回 */
    const login = isEmail
      ? (u.handle || handleFromEmail(u.email || (emailKeys[i] || "").slice(5)))
      : ghKeys[i - emailKeys.length];
    if (!login || seen.has(login)) return;
    const name = u.displayName || login;
    if (!hit(q, [name, login, u.bio, u.website, u.location])) return;
    seen.add(login);
    users.push({
      login,
      name,
      avatar: avatarUrl(imgBase, login, u.avatar, u.hasAvatar),
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
async function searchPosts(env, q, viewer, limit, imgBase) {
  const ids = (await kvGetJSON(env, "feed:global", [])).slice(0, SEARCH_POST_SCAN);
  if (!ids.length) return [];
  const raws = await kvGetMany(env, ids.map((id) => `post:${id}`));
  const matched = [];
  raws.forEach((raw, i) => {
    if (!raw) return;
    let p;
    try { p = JSON.parse(raw); } catch { return; }
    if (!hit(q, [p.text, p.linkUrl, p.authorName])) return;
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
  await normalizeAuthors(env, out, "author");
  for (const p of out) p.authorAvatar = avatarUrl(imgBase, p.author, p.authorAvatar);
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

/** 管理口令（env.ADMIN_KEY，wrangler secret，不写进仓库）。 */
function adminKeyOk(request, env) {
  const expected = String(env.ADMIN_KEY || "");
  if (!expected) return false;
  const got = String(request.headers.get("x-admin-key") || "");
  if (!got || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** 校验管理员身份（登录态白名单 + 管理口令）；通过返回 { identity } */
async function requireAdmin(request, env) {
  const identity = await getIdentity(request, env);
  if (!identity) return { error: json(request, { error: "未登录" }, 401) };
  if (!isAdminLogin(env, identity.login)) return { error: json(request, { error: "无权访问" }, 403) };
  if (!adminKeyOk(request, env)) {
    return { error: json(request, { error: "需要管理口令", needKey: true }, 401) };
  }
  return { identity };
}

/** 枚举全部账号（邮箱用户 + GitHub 用户），附封禁/认证/发帖数 */
async function listAllUsers(env, cap, imgBase) {
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
    const handle = isEmail ? (u.handle || handleFromEmail(login)) : login;
    accounts.push({
      login,
      handle,
      type: isEmail ? "email" : "github",
      name: u.displayName || (isEmail ? login.split("@")[0] : login),
      avatar: avatarUrl(imgBase, handle, u.avatar, u.hasAvatar),
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

/* ---------------- 官方账号自动发帖 ---------------- */

/** 官方账号登录名（真实账号，前端显示 @solhub） */
const OFFICIAL_LOGIN = "solhub@solyoung.top";

/** 官方账号的作者快照；账号不存在时返回 null（静默跳过发帖）。 */
async function officialAuthor(env) {
  const u = await kvGetJSON(env, `user:${OFFICIAL_LOGIN}`, null);
  if (!u) return null;
  return {
    sid: OFFICIAL_LOGIN,
    login: u.handle || "solhub",
    name: u.displayName || "SolHub 官方",
    avatar: u.avatar || "",
    verified: !!u.verified,
  };
}

/** 以官方账号发一条帖子（服务端直接写 KV，不需要密码）。 */
async function postAsOfficial(env, text, linkUrl = "") {
  if (!env.PROFILES) return null;
  const author = await officialAuthor(env);
  if (!author) return null;
  const id = newId();
  const post = {
    id,
    author: author.login,
    authorName: author.name,
    authorAvatar: author.avatar,
    authorVerified: author.verified,
    text: String(text || "").trim().slice(0, POST_MAX),
    linkUrl: String(linkUrl || "").trim().slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  if (!post.text && !post.linkUrl) return null;
  await Promise.all([
    kvPutJSON(env, `post:${id}`, post),
    kvPutJSON(env, `post:${id}:likes`, []),
    kvPutJSON(env, `post:${id}:comments`, []),
  ]);
  await Promise.all([pushFeed(env, "feed:global", id), pushFeed(env, `feed:user:${author.sid}`, id)]);
  return post;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 新用户上传产品后，官方账号发一条「新成员入列」。 */
async function announceNewProduct(env, product) {
  if (!product || !product.name) return null;
  if (product.submittedBy === OFFICIAL_LOGIN || product.submittedBy === "solhub") return null;
  const desc = String(product.shortDescription || "").trim().slice(0, 90);
  const dev = String(product.developerName || "").trim();
  const lines = [`新成员入列 ✦ ${product.name}${desc ? ` — ${desc}` : ""}`];
  if (dev) lines.push(`开发者：${dev}`);
  lines.push("点开看看，也欢迎在评论区聊聊你的用法。");
  return postAsOfficial(env, lines.join("\n"), product.websiteUrl || "");
}

/** 过滤出可宣传的产品：有 slug/name 且官网可访问 */
function isValidProduct(p) {
  return p && p.slug && p.name && /^https?:\/\//.test(String(p.websiteUrl || ""));
}

/**
 * 随机推荐一个产品并以官方账号发帖，附带产品链接。
 * 候选池优先用社区提交的产品（尊重「社区」属性）；当社区产品不足或全在冷却内时，
 * 自动用官方目录产品补充（排除演示产品），确保每天三次都能发出、且不单调。
 * 同一产品 1 天内不重复推荐（队列轮转 + 冷却兜底）。
 */
async function suggestCommunityProduct(env) {
  const [community, index] = await Promise.all([readCommunity(env), readProductIndex(env)]);
  const communityPool = (Array.isArray(community) ? community : []).filter(isValidProduct);
  const catalogPool = (Array.isArray(index) ? index : [])
    .filter(isValidProduct)
    .filter((p) => !p.isDemo); // 演示产品不宣传
  if (!communityPool.length && !catalogPool.length) return null;

  const COOLDOWN = 24 * 60 * 60 * 1000; // 1 天：同一产品一天内不重复推荐
  const now = Date.now();

  // 标记每个产品最近一次推荐时间
  const tag = async (pool) => {
    const lasts = await kvGetMany(env, pool.map((p) => `official:last:${p.slug}`));
    return pool.map((p, i) => ({ p, last: Number(lasts[i] || 0) }));
  };
  const [cTagged, kTagged] = await Promise.all([tag(communityPool), tag(catalogPool)]);
  const recentCommunity = cTagged.filter((x) => !x.last || now - x.last > COOLDOWN).map((x) => x.p);
  const recentCatalog = kTagged.filter((x) => !x.last || now - x.last > COOLDOWN).map((x) => x.p);

  // 候选池优先级：社区近期未推 > 目录近期未推 > 社区全量 > 目录全量（兜底，保证每天三次都能发）
  const pool =
    recentCommunity.length ? recentCommunity
    : recentCatalog.length ? recentCatalog
    : communityPool.length ? communityPool
    : catalogPool;

  const slugs = pool.map((p) => p.slug);
  let queue = await kvGetJSON(env, "official:queue", []);
  if (!Array.isArray(queue)) queue = [];
  queue = queue.filter((s) => slugs.includes(s));
  if (!queue.length) queue = shuffle(slugs);

  const slug = queue.shift();
  await kvPutJSON(env, "official:queue", queue);
  const p = pool.find((x) => x.slug === slug);
  if (!p) return null;

  const name = p.name;
  const desc = String(p.shortDescription || p.description || "").trim().slice(0, 90);
  const dev = String(p.developerName || p.author || "").trim();
  const templates = [
    `今日推荐 ✦ ${name}${desc ? ` — ${desc}` : ""}`,
    `逛逛社区 ✦ ${name}${desc ? `\n${desc}` : ""}`,
    `发现一个小玩意 ✦ ${name}${desc ? ` — ${desc}` : ""}`,
    `社区里有人在做这个 ✦ ${name}${desc ? `\n${desc}` : ""}`,
  ];
  const text = templates[Math.floor(Math.random() * templates.length)] + (dev ? `\nby ${dev}` : "");
  const post = await postAsOfficial(env, text, p.websiteUrl);
  if (post) await env.PROFILES.put(`official:last:${p.slug}`, String(now), { expirationTtl: 30 * 24 * 3600 });
  return post;
}

/** 每天最多三次推荐（自动化一天触发三次：北京 9:00 / 16:00 / 0:00）。 */
async function suggestWithDailyQuota(env, force = false) {
  // 用北京时间日期做配额键：保证「北京一天三次」落在同一天，避免跨 UTC 边界被拆成两个日期导致发不满
  const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const key = `official:quota:${day}`;
  const used = Number((await env.PROFILES.get(key)) || 0);
  if (!force && used >= 3) return { skipped: "daily quota reached" };
  const post = await suggestCommunityProduct(env);
  if (!post) return { skipped: "no eligible product (all in cooldown or none uploaded)" };
  if (!force) await env.PROFILES.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return { ok: true, post };
}

/* ---------------- 创作者名录（带实例内缓存） ----------------
   /creators 是目前最重的读接口：要枚举全部账号、批量读记录、再逐个合并产品数。
   实测只有 3 个账号时热态就要 400~550ms，人一多会线性变差。

   名录本身不需要实时 —— 新注册的人晚一分钟出现在列表里完全可以接受。所以加一层
   60 秒实例内缓存：命中时零 KV 读、零产品合并，直接返回。
   缓存里存的是「未过滤的全量列表」，q / filter / 分页都在缓存之上做，
   不同搜索词不会把缓存打散成很多份。
   写入路径（改资料、认证、封禁、提交产品）会主动 dropCreatorsCache() 让它立刻失效；
   其它实例最多晚 60 秒，这是可接受的代价。 */

const CREATORS_TTL_MS = 60 * 1000;
/* 一次最多枚举多少账号。此前是 500 且没有分页，第 501 个账号会静默不出现在名录里。 */
const CREATORS_SCAN = 2000;

let creatorsCache = null; // { at: number, list: Array }

function dropCreatorsCache() {
  creatorsCache = null;
}

/* ---------------- 热点（实例内缓存） ----------------
   写入侧是 solhub-hot 云函数（15 分钟一轮），读取侧是本进程。
   缓存 60 秒意味着最坏情况下读者比抓取结果晚 1 分钟看到，这对「热点」完全够用，
   而 KV 读次数从「每个访客每次轮询一次」降到「每个实例每分钟一次」。 */

const HOT_KEY = "hot:v1";
const HOT_TTL_MS = 60 * 1000;
const EMPTY_HOT = { fetchedAt: null, items: [] };

let hotCache = null; // { at: number, data: { fetchedAt, items } }

async function readHotFeed(env) {
  const now = Date.now();
  if (hotCache && now - hotCache.at < HOT_TTL_MS) return hotCache.data;

  let data = EMPTY_HOT;
  const raw = await env.PROFILES.get(HOT_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) {
        /* 库里可能躺着还没翻完的英文条目（云函数每轮限时限量翻译），
           它们在页面上不该出现 —— 一个中文站的热点流里混英文标题很出戏。
           旧数据没有 lang 字段，一律当中文。 */
        data = {
          fetchedAt: parsed.fetchedAt || null,
          items: parsed.items.filter((it) => it && (!it.lang || it.lang === "zh")),
        };
      }
    } catch {
      /* 解析失败就按空处理：宁可不显示，也不要在页面上渲染半条坏数据 */
    }
  }
  hotCache = { at: now, data };
  return data;
}

/** 全量构建一次名录（含封禁过滤）。只在缓存过期时执行。 */
async function buildCreatorsList(env, imgBase) {
  const [emailKeys, ghKeys, community, index, hostedIndex] = await Promise.all([
    listKeys(env, "user:", CREATORS_SCAN),
    listKeys(env, "profile:", 500),
    readCommunity(env),
    readProductIndex(env),
    hostedIndexRead(env),
  ]);
  const raws = await kvGetMany(env, [...emailKeys, ...ghKeys]);
  const all = [];
  const seen = new Set();
  raws.forEach((raw, i) => {
    if (!raw) return;
    let u;
    try { u = JSON.parse(raw); } catch { return; }
    const isEmail = i < emailKeys.length;
    /* 对外只露 handle / GitHub 用户名，邮箱不参与展示 */
    const login = isEmail
      ? (u.handle || handleFromEmail(u.email || (emailKeys[i] || "").slice(5)))
      : ghKeys[i - emailKeys.length];
    if (!login || seen.has(login)) return;
    seen.add(login);
    const name = u.displayName || login;
    const products = mergeProducts(productsOf(community, login), allClaimedSlugs(index, login, u), index);
    /* 托管工具也算作品，否则官方号（只有工具）在名录里显示 0 件、沉到最底 */
    const toolCount = hostedCardsOf(hostedIndex, login, imgBase).length;
    all.push({
      login,
      name,
      /* 头像外置后这里只发短链接，列表 JSON 里不再有图片字节 */
      avatar: avatarUrl(imgBase, login, u.avatar, u.hasAvatar),
      bio: u.bio || "",
      website: u.website || "",
      location: u.location || "",
      joinedAt: u.createdAt || "",
      verified: !!u.verified,
      /* 蓝V：官方账号（solhub / solhub_editor），与创作者的黄V分开 */
      official: !!u.official,
      productCount: products.length + toolCount,
    });
  });

  /* 列表按「有作品优先 → 认证优先 → 先加入优先」排，空白账号沉底 */
  all.sort((a, b) =>
    b.productCount - a.productCount ||
    Number(b.verified) - Number(a.verified) ||
    String(a.joinedAt).localeCompare(String(b.joinedAt)),
  );

  /* 封禁过滤放在缓存里做：封禁是全局状态、极少变，
     挪进缓存后每次请求就不用再批量查 ban:* 了。 */
  const bans = await kvGetMany(env, all.map((x) => `ban:${x.login}`));
  return all.filter((_, i) => !bans[i]);
}

async function creatorsList(env, imgBase) {
  const now = Date.now();
  if (creatorsCache && now - creatorsCache.at < CREATORS_TTL_MS) return creatorsCache.list;
  const list = await buildCreatorsList(env, imgBase);
  creatorsCache = { at: now, list };
  return list;
}

/* ---------------- 主路由 ---------------- */

/* 托管工具 ID：8 位小写字母数字，用于 /tools/?id= 与 /hosted/<id> */
function hostedToolId() {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/* 托管工具公开目录索引 hosted:index:v1 —— 数组形式，只存元信息（无 html、无 owner）。
   上限 500 条，超出丢最旧的；产品页列表只读这一个键。 */
const CLICKS_KEY = "stats:clicks:v1";
/** 单目标去重窗口：同一访客 10 分钟内重复点击只计一次 */
const CLICK_DEDUPE_MS = 10 * 60 * 1000;
/** 最多记多少个目标，超出按点击数砍尾部 */
const CLICKS_MAX = 400;

/* ---------------- 积分与邀请（v1） ----------------
   存储（全部落在 kv，键名带前缀方便按人清理）：
     ref:code:<CODE>     → 邀请人 sid（反查用，唯一占用）
     ref:sid:<sid>       → { code } 缓存，避免每次重算
     ref:claim:<sid>     → 被邀请人的领取标记（一人一生一次，天然去重）
     ref:invited:<sid>   → 邀请人已拉到的人 [{ login, at }]
     wallet:<sid>        → { balance, spent, earned }
     wallet:ledger:<sid> → 明细数组（新的在前，最多 LEDGER_MAX 条）

   为什么码是「算出来的」而不是随机发：同一个账号无论从哪儿重算都是同一个码，
   不需要额外发码流程，也不会因为清缓存换浏览器就变成另一个码。 */
const INVITE_POINTS = 100;
const LEDGER_MAX = 200;
/** Crockford base32：去掉 I/L/O/U，避免和 1/0 看混 */
const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REF_CODE_RE = /^SH-[0-9A-Z]{6}$/;

const walletKey = (sid) => `wallet:${sid}`;
const ledgerKey = (sid) => `wallet:ledger:${sid}`;
const claimKey = (sid) => `ref:claim:${sid}`;
const invitedKey = (sid) => `ref:invited:${sid}`;
const codeIndexKey = (code) => `ref:code:${code}`;
const codeOfSidKey = (sid) => `ref:sid:${sid}`;

/** sid → 邀请码：FNV-1a 32 位取 6 位 base32；salt 用于撞码时错位重算 */
function refCodeFromSid(sid, salt) {
  let h = 2166136261;
  const text = `${sid}#${salt || 0}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let v = h >>> 0;
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += REF_ALPHABET[v % 32];
    v = Math.floor(v / 32);
  }
  return "SH-" + out;
}

/** 取（必要时占用）某个账号的邀请码；同一个账号永远返回同一个码 */
async function refCodeOf(env, sid) {
  if (!sid) return "";
  const cached = await kvGetJSON(env, codeOfSidKey(sid), null, true);
  if (cached && cached.code) return cached.code;
  for (let salt = 0; salt < 8; salt++) {
    const code = refCodeFromSid(sid, salt);
    const owner = await env.PROFILES.get(codeIndexKey(code), { cacheTtl: 30 });
    if (owner === sid) {
      await kvPutJSON(env, codeOfSidKey(sid), { code });
      return code;
    }
    if (!owner) {
      await env.PROFILES.put(codeIndexKey(code), sid);
      await kvPutJSON(env, codeOfSidKey(sid), { code });
      return code;
    }
    /* 已被别人占用：换 salt 再来，最多 8 次（概率极低） */
  }
  return "";
}

/** 钱包快照：balance 当前余额，available 可用（预留给冻结/提现），earned 累计获得 */
async function walletSnapshot(env, sid) {
  const w = (await kvGetJSON(env, walletKey(sid), null, true)) || {};
  const balance = Number(w.balance) || 0;
  const spent = Number(w.spent) || 0;
  const earned = Number(w.earned) || balance;
  /* 目前没有冻结/提现，可用即余额；spent 先留着，接入消费后从 available 里扣 */
  return { balance, available: Math.max(0, balance), spent, earned };
}

/** 加/减积分并写一条明细。amount 为负数时是消费。 */
async function addPoints(env, sid, amount, entry) {
  const w = (await kvGetJSON(env, walletKey(sid), null, true)) || {};
  const delta = Number(amount) || 0;
  const balance = (Number(w.balance) || 0) + delta;
  const earned = (Number(w.earned) || 0) + Math.max(0, delta);
  const next = { balance, spent: Number(w.spent) || 0, earned, updatedAt: new Date().toISOString() };
  await kvPutJSON(env, walletKey(sid), next);
  const ledger = (await kvGetJSON(env, ledgerKey(sid), [])) || [];
  ledger.unshift({
    id: newId(),
    at: next.updatedAt,
    amount: delta,
    ...entry,
  });
  await kvPutJSON(env, ledgerKey(sid), ledger.slice(0, LEDGER_MAX));
  return next;
}

/**
 * 结算一次邀请：被邀请人注册成功后调用。
 * - 码无效 / 邀请人不存在 / 自己邀自己 → 静默忽略（注册不能因为推荐失败而失败）
 * - 同一个被邀请人只发一次（ref:claim:<sid> 是幂等标记）
 */
async function settleReferral(env, rawCode, inviteeSid, inviteeLogin) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!REF_CODE_RE.test(code)) return { ok: false, reason: "bad-code" };
  const inviterSid = await env.PROFILES.get(codeIndexKey(code), { cacheTtl: 30 });
  if (!inviterSid) return { ok: false, reason: "no-inviter" };
  if (inviterSid === inviteeSid) return { ok: false, reason: "self" };
  if (await env.PROFILES.get(claimKey(inviteeSid), { cacheTtl: 30 })) {
    return { ok: false, reason: "already-claimed" };
  }
  await env.PROFILES.put(
    claimKey(inviteeSid),
    JSON.stringify({ code, inviter: inviterSid, at: new Date().toISOString() }),
  );
  const inviter = await kvGetJSON(env, `user:${inviterSid}`, null, true);
  const inviterLogin = (inviter && inviter.handle) || handleFromEmail(inviterSid);
  await addPoints(env, inviterSid, INVITE_POINTS, {
    type: "invite",
    note: `邀请 @${inviteeLogin} 注册`,
    ref: inviteeSid,
  });
  const invited = (await kvGetJSON(env, invitedKey(inviterSid), [])) || [];
  invited.unshift({ login: inviteeLogin, at: new Date().toISOString() });
  await kvPutJSON(env, invitedKey(inviterSid), invited.slice(0, 200));
  return { ok: true, inviterSid, inviterLogin, points: INVITE_POINTS };
}


/** 32 位摘要（FNV-1a + base36）：去重键里存 IP 的摘要而不是原文，
    够区分不同访客，也无法反推回地址。 */
function shortHash(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const HOSTED_INDEX_KEY = "hosted:index:v1";
const HOSTED_INDEX_MAX = 500;

function hostedMeta(rec) {
  return {
    id: rec.id,
    name: rec.name,
    description: rec.description || "",
    category: rec.category || "productivity",
    tags: Array.isArray(rec.tags) ? rec.tags : [],
    createdAt: rec.createdAt || "",
    hidden: !!rec.hidden,
    /* 官方工具：署名 + 是否有图标（列表按需拼 /hosted/logo/<id>，不塞 base64） */
    author: rec.author || "",
    hasLogo: !!rec.logo,
    /* 归属用 PID（公开标识）而不是 owner（邮箱登录名）：主页要按人聚合作品 */
    ownerPid: rec.ownerPid || "",
    ownerType: rec.ownerType || "user",
  };
}

/** 图标只接受 data URI 形式的图片，且限制体积（60KB 以内，存 kv 不撑爆） */
function normalizeHostedLogo(v) {
  const s = String(v || "").trim();
  if (!s || s.length > 80 * 1024) return "";
  return /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : "";
}

async function hostedIndexRead(env) {
  const list = (await kvGetJSON(env, HOSTED_INDEX_KEY, [])) || [];
  return Array.isArray(list) ? list : [];
}

async function hostedIndexAdd(env, rec) {
  const list = (await hostedIndexRead(env)).filter((t) => t && t.id !== rec.id);
  list.unshift(hostedMeta(rec));
  await kvPutJSON(env, HOSTED_INDEX_KEY, list.slice(0, HOSTED_INDEX_MAX));
}

async function hostedIndexRemove(env, id) {
  const list = (await hostedIndexRead(env)).filter((t) => t && t.id !== id);
  await kvPutJSON(env, HOSTED_INDEX_KEY, list);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    /** 列表接口里把头像换成可缓存的短链接时用的 API 基址 */
    const imgBase = apiBaseOf(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsFor(request) });
    }

    /* CSRF 兜底：浏览器跨站发起的写请求一定带 Origin，白名单外直接拒。
       会话 Cookie 是 SameSite=None（跨站要用），单靠 CORS 只挡「读响应」、
       挡不住「请求本身被发出去」，这里在入口补一道。
       非浏览器（curl / 脚本）不带 Origin，那类请求本来也没有受害者 Cookie。 */
    if (request.method !== "GET" && request.method !== "HEAD") {
      const origin = request.headers.get("Origin");
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return json(request, { error: "bad origin" }, 403);
      }
    }

    /* ---------- 邮箱验证码 ---------- */
    if (url.pathname === "/auth/send-code" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const purpose = String(body.purpose || "register");
      if (!EMAIL_RE.test(email)) return json(request, { error: "邮箱格式不正确" }, 400);
      if (!VCODE_PURPOSES.includes(purpose)) return json(request, { error: "无效的验证码用途" }, 400);

      let target = email;
      if (purpose === "verify" || purpose === "change") {
        const identity = await getIdentity(request, env);
        if (!identity || identity.type !== "email") return json(request, { error: "请先登录" }, 401);
        if (purpose === "verify") target = identity.user.email;
        if (purpose === "change") {
          if (email === identity.user.email) return json(request, { error: "新邮箱与当前邮箱相同" }, 400);
          if (await env.PROFILES.get(`user:${email}`, { cacheTtl: 30 })) return json(request, { error: "该邮箱已被注册" }, 409);
        }
      }
      if (purpose === "register" && (await env.PROFILES.get(`user:${email}`, { cacheTtl: 30 }))) {
        return json(request, { error: "该邮箱已注册，请直接登录" }, 409);
      }
      const out = await issueCode(request, env, purpose, target);
      return json(request, out.body, out.status);
    }

    /* 验证「当前邮箱」归属（已登录用户） */
    if (url.pathname === "/auth/verify-email" && request.method === "POST") {
      const identity = await getIdentity(request, env);
      if (!identity || identity.type !== "email") return json(request, { error: "请先登录" }, 401);
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const code = String(body.code || "").trim();
      const email = identity.user.email;
      const v = await takeVCode(env, "verify", email, code);
      if (!v.ok) return json(request, { error: v.error }, 400);
      const key = `user:${email}`;
      const user = await kvGetJSON(env, key, null, true);
      if (!user) return json(request, { error: "用户不存在" }, 404);
      user.emailVerified = true;
      await env.PROFILES.put(key, JSON.stringify(user));
      await cacheWrite(env, key, JSON.stringify(user));
      return json(request, { ok: true, emailVerified: true });
    }

    /* 修改邮箱：必须先验证新邮箱，通过后才切换 */
    if (url.pathname === "/auth/change-email" && request.method === "POST") {
      const identity = await getIdentity(request, env);
      if (!identity || identity.type !== "email") return json(request, { error: "请先登录" }, 401);
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const newEmail = String(body.newEmail || "").trim().toLowerCase();
      const code = String(body.code || "").trim();
      const oldEmail = identity.user.email;
      if (!EMAIL_RE.test(newEmail)) return json(request, { error: "邮箱格式不正确" }, 400);
      if (newEmail === oldEmail) return json(request, { error: "新邮箱与当前邮箱相同" }, 400);
      if (await env.PROFILES.get(`user:${newEmail}`, { cacheTtl: 30 })) return json(request, { error: "该邮箱已被注册" }, 409);
      const v = await takeVCode(env, "change", newEmail, code);
      if (!v.ok) return json(request, { error: v.error }, 400);

      const oldKey = `user:${oldEmail}`;
      const user = await kvGetJSON(env, oldKey, null, true);
      if (!user) return json(request, { error: "用户不存在" }, 404);
      user.email = newEmail;
      user.emailVerified = true;
      user.emailPublic = false; /* 换了邮箱先收回公开状态，需要用户重新开启 */
      await env.PROFILES.put(`user:${newEmail}`, JSON.stringify(user));
      await cacheWrite(env, `user:${newEmail}`, JSON.stringify(user));
      await env.PROFILES.delete(oldKey);
      await cacheDrop(env, oldKey);
      /* 密码凭据也要跟着搬到新邮箱，否则换完邮箱就登不上了 */
      for (const ck of ["pw", "pwnew"]) {
        const movedCred = await kvGetJSON(env, `${ck}:${oldEmail}`, null, true);
        if (movedCred && movedCred.h) {
          await env.PROFILES.put(`${ck}:${newEmail}`, JSON.stringify(movedCred));
          await cacheWrite(env, `${ck}:${newEmail}`, JSON.stringify(movedCred));
          await env.PROFILES.delete(`${ck}:${oldEmail}`);
          await cacheDrop(env, `${ck}:${oldEmail}`);
        }
      }
      if (!user.passSalt || !user.passHash) {
        /* 新式凭据已搬完，无需再迁移老字段 */
      } else {
        /* 老账号凭据还在 user:* 里，随记录一起搬 */
        await writeCredential(env, newEmail, user.passSalt, user.passHash, user.pwdVersion || 0);
      }
      /* 别名：让改邮箱前签发的旧会话仍能定位到账号 */
      await env.PROFILES.put(`alias:${oldEmail}`, newEmail);
      if (user.handle) await env.PROFILES.put(`handle:${user.handle}`, newEmail);
      /* 头像外置键是按邮箱（SID）命名的，改邮箱时必须一起搬，否则头像会突然消失 */
      const movedAvatar = await env.PROFILES.get(avatarKey(oldEmail));
      if (movedAvatar) {
        await env.PROFILES.put(avatarKey(newEmail), movedAvatar);
        await env.PROFILES.delete(avatarKey(oldEmail));
      }
      const ban = await env.PROFILES.get(`ban:${oldEmail}`);
      if (ban) {
        await env.PROFILES.put(`ban:${newEmail}`, ban);
        await env.PROFILES.delete(`ban:${oldEmail}`);
      }
      /* 通知旧邮箱（best-effort：提醒本人邮箱已被更换，不影响切换结果） */
      const notice = sendMail(env, {
        to: oldEmail,
        subject: "【SolHub】你的账号邮箱已变更",
        html: `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
          <h2 style="margin:0 0 16px;font-size:20px">SolHub 账号邮箱已变更</h2>
          <p style="margin:0 0 12px;line-height:1.7;color:#444">你的 SolHub 账号登录邮箱已从 <strong>${oldEmail}</strong> 变更为 <strong>${newEmail}</strong>。</p>
          <p style="margin:0;line-height:1.7;color:#666;font-size:13px">如果这不是你本人的操作，请立即重置密码：${SITE_BASE}/forgot-password/</p>
        </div>`,
        text: `你的 SolHub 账号登录邮箱已变更为 ${newEmail}。若非本人操作，请立即重置密码。`,
      }).catch(() => ({}));
      if (ctx && ctx.waitUntil) ctx.waitUntil(notice);
      return json(request, { ok: true, email: newEmail, emailVerified: true });
    }

    /* 找回密码：无论账号是否存在都返回同样的结果，避免账号枚举 */
    if (url.pathname === "/auth/forgot-password" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return json(request, { ok: true, message: "如果该邮箱已注册，我们会发送验证码，请查收（含垃圾箱）" });
      }
      /* 若这个邮箱是某个账号的旧地址（用户改过邮箱），验证码发到当前的新邮箱 */
      const current = await resolveCurrentEmail(env, email);
      if (current) {
        const out = await issueCode(request, env, "reset", current);
        if (out.status !== 200) return json(request, out.body, out.status);
      }
      return json(request, { ok: true, message: "如果该邮箱已注册，我们会发送验证码，请查收（含垃圾箱）" });
    }

    /* 重置密码：校验验证码 → 改密 → 旧会话全部失效 → 给用户一个新会话 */
    if (url.pathname === "/auth/reset-password" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const code = String(body.code || "").trim();
      const newPassword = String(body.newPassword || "");
      if (!EMAIL_RE.test(email)) return json(request, { error: "邮箱格式不正确" }, 400);
      if (newPassword.length < 8) return json(request, { error: "密码至少 8 位" }, 400);
      const current = await resolveCurrentEmail(env, email);
      if (!current) return json(request, { error: "验证码不正确或已过期" }, 400);
      const key = `user:${current}`;
      const user = await kvGetJSON(env, key, null);
      if (!user) return json(request, { error: "验证码不正确或已过期" }, 400);
      const v = await takeVCode(env, "reset", current, code);
      if (!v.ok) return json(request, { error: v.error }, 400);
      const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      const passHash = await hashPassword(newPassword, salt);
      /* 只写凭据键，不整条重写资料记录 —— 否则 KV 边缘缓存里的旧记录
         会把头像、简介等后写进去的字段覆盖掉。 */
      const prev = await readCredential(env, current);
      const ver = ((prev && prev.ver) || 0) + 1;
      await writeCredential(env, current, salt, passHash, ver);
      const { cookie, token } = await createSession(request, env, current, { salt, hash: passHash, ver });
      return json(request, { ok: true, message: "密码已重置，请用新密码登录", token }, 200, cookie);
    }

    /* 修改密码（登录态）：校验当前密码 → 换新盐/哈希 → pwdVersion +1 让其它设备会话失效 → 给当前设备发新会话 */
    if (url.pathname === "/auth/change-password" && request.method === "POST") {
      const identity = await getIdentity(request, env);
      if (!identity || identity.type !== "email") return json(request, { error: "请先登录" }, 401);
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 8) return json(request, { error: "密码至少 8 位" }, 400);
      if (newPassword.length > 200) return json(request, { error: "密码过长" }, 400);
      const email = identity.user.email;
      const key = `user:${email}`;
      const user = await kvGetJSON(env, key, null, true);
      if (!user) return json(request, { error: "用户不存在" }, 404);
      /* 校验当前密码：同样按「新→旧」依次尝试，
         免得边缘缓存里的旧凭据把「用新密码改密」这条路也堵住。 */
      const cred = await verifyCredential(env, email, currentPassword);
      if (!cred) {
        const hasAny = (await readCredentialCandidates(env, email)).length > 0;
        return json(
          request,
          { error: hasAny ? "当前密码不正确" : "该账号不是用密码登录的，无法在此修改密码" },
          hasAny ? 403 : 400,
        );
      }
      if (currentPassword === newPassword) return json(request, { error: "新密码不能与当前密码相同" }, 400);
      const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      const passHash = await hashPassword(newPassword, salt);
      /* 密码版本号 +1：其它设备的旧会话版本对不上，自动失效。
         只写凭据键 —— 绝不整条重写资料记录，否则 KV 边缘缓存里的旧记录
         会把头像、简介等后写进去的字段覆盖掉。 */
      const ver = (cred.ver || 0) + 1;
      await writeCredential(env, email, salt, passHash, ver);
      const { cookie, token } = await createSession(request, env, email, { salt, hash: passHash, ver });
      return json(request, { ok: true, message: "密码已修改，其它设备需要重新登录", token }, 200, cookie);
    }

    /* 注销账号（自助）：校验密码 → 清掉账号、资料、帖子、关注关系与社区提交 */
    if (url.pathname === "/auth/delete-account" && request.method === "POST") {
      const identity = await getIdentity(request, env);
      if (!identity || identity.type !== "email") return json(request, { error: "请先登录" }, 401);
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const password = String(body.password || "");
      const email = identity.user.email;
      const key = `user:${email}`;
      const user = await kvGetJSON(env, key, null, true);
      if (!user) return json(request, { error: "用户不存在" }, 404);
      const cred = await verifyCredential(env, email, password);
      if (!cred) {
        const hasAny = (await readCredentialCandidates(env, email)).length > 0;
        return json(
          request,
          { error: hasAny ? "密码不正确" : "该账号不是用密码登录的，无法自助注销" },
          hasAny ? 403 : 400,
        );
      }
      /* 管理员账号不允许自助注销，避免把唯一的管理员入口删掉 */
      if (isAdminLogin(env, email) || (user.handle && isAdminLogin(env, user.handle))) {
        return json(request, { error: "管理员账号不能自助注销，请先移交管理员身份" }, 400);
      }

      const handle = user.handle || "";

      /* 1) 帖子：连同点赞/评论一起删，并从全局信息流里摘掉 */
      const ids = await kvGetJSON(env, `feed:user:${email}`, []);
      for (const id of ids.slice(0, 500)) {
        await env.PROFILES.delete(`post:${id}`);
        await env.PROFILES.delete(`post:${id}:likes`);
        await env.PROFILES.delete(`post:${id}:comments`);
        await removeFromFeed(env, "feed:global", id);
      }

      /* 2) 社区提交：把该用户收录的产品移出目录并回写仓库 */
      const community = await readCommunity(env);
      if (Array.isArray(community) && community.length) {
        const kept = community.filter((p) => p && p.submittedBy !== handle && p.submittedBy !== email);
        if (kept.length !== community.length) {
          await kvPutJSON(env, KV_COMMUNITY, kept);
          if (ctx && ctx.waitUntil) {
            ctx.waitUntil(syncCommunityToRepo(env, kept, `chore: 移除已注销用户 ${handle || email} 的提交`).catch(() => {}));
          }
        }
      }

      /* 3) 别名链：旧邮箱指向本账号的指针要一起清掉，否则会留下悬空映射 */
      const aliasKeys = await listKeys(env, "alias:", 300);
      for (const ak of aliasKeys) {
        const target = await env.PROFILES.get(ak, { cacheTtl: 30 });
        if (target === email) {
          await env.PROFILES.delete(ak);
          await cacheDrop(env, ak);
        }
      }

      /* 4) 关注关系：从别人的关注/粉丝列表里摘掉自己 */
      const socialKeys = await listKeys(env, "following:", 300);
      const socialKeys2 = await listKeys(env, "followers:", 300);
      for (const sk of [...socialKeys, ...socialKeys2]) {
        const list = await kvGetJSON(env, sk, []);
        if (!Array.isArray(list) || !list.length) continue;
        const kept = list.filter((x) => x !== handle && x !== email);
        if (kept.length !== list.length) await kvPutJSON(env, sk, kept);
      }

      /* 5) 账号本体与附属键 */
      await Promise.all([
        env.PROFILES.delete(key),
        env.PROFILES.delete(`pw:${email}`),
        env.PROFILES.delete(`pwnew:${email}`),
        env.PROFILES.delete(`feed:user:${email}`),
        env.PROFILES.delete(`following:${email}`),
        env.PROFILES.delete(`followers:${email}`),
        env.PROFILES.delete(`ban:${email}`),
        env.PROFILES.delete(avatarKey(email)),
        env.PROFILES.delete(`post:gap:${email}`),
        env.PROFILES.delete(`post:day:${email}`),
        handle ? env.PROFILES.delete(`handle:${handle}`) : null,
        handle ? env.PROFILES.delete(`ban:${handle}`) : null,
        handle ? env.PROFILES.delete(`profile:${handle}`) : null,
      ].filter(Boolean));
      /* 读穿缓存也要清：否则「删了却还能读到旧记录」 */
      await cacheDrop(env, key);
      await cacheDrop(env, `pw:${email}`);
      await cacheDrop(env, `pwnew:${email}`);
      if (handle) await cacheDrop(env, `handle:${handle}`);

      dropCreatorsCache();
      return json(request, { ok: true, deletedPosts: ids.length });
    }

    /* ---------- 邮箱注册 ---------- */
    if (url.pathname === "/auth/register" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = String(body.displayName || "").trim().slice(0, 40);
      const code = String(body.code || "").trim();
      const wanted = normalizeHandle(body.handle);
      if (!EMAIL_RE.test(email)) return json(request, { error: "邮箱格式不正确" }, 400);
      if (password.length < 8) return json(request, { error: "密码至少 8 位" }, 400);
      if (wanted && !HANDLE_RE.test(wanted)) {
        return json(request, { error: "用户名需 3–20 位，字母开头，只能是小写字母、数字或下划线" }, 400);
      }
      if (wanted && RESERVED_HANDLES.has(wanted)) return json(request, { error: "该用户名不可用" }, 409);
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);

      /* 限流：同一 IP 每小时最多注册 5 个账号，挡住批量注册/刷号。
         只统计「成功注册」——输错验证码不计数，否则用户手滑输错几次就被锁一小时。
         （要刷号也得先拿到邮箱验证码，成本远高于此处的计数。） */
      const regKey = `register:ip:${clientIp(request).replace(/[^a-zA-Z0-9.:_-]/g, "")}`;
      const reg = await rateLimitPeek(regKey);
      if (!isDevRequest(request, env) && reg.count >= 5) {
        return json(request, { error: `注册过于频繁，请 ${retryAfterSec(reg.startedAt, 3600)} 秒后再试` }, 429);
      }

      const key = `user:${email}`;
      if (await env.PROFILES.get(key, { cacheTtl: 30 })) {
        return json(request, { error: "该邮箱已注册，请直接登录" }, 409);
      }
      if (wanted && (await env.PROFILES.get(`handle:${wanted}`, { cacheTtl: 30 }))) {
        return json(request, { error: "该用户名已被使用，换一个试试" }, 409);
      }

      /* 邮箱验证：**默认可选**。
         用户可以先注册完事，之后在「个人中心 → 邮箱安全」随时补验；
         但填了验证码就必须填对（错码直接拒绝，不静默放行），
         否则「填了码却没验上」会让用户以为自己验证成功了。
         env.REQUIRE_EMAIL_VERIFY=1 可强制「注册即验证」（运营需要时再开）。 */
      const requireVerify = env.REQUIRE_EMAIL_VERIFY === "1";
      let emailVerified = false;
      if (requireVerify || code) {
        if (!code) return json(request, { error: "请输入邮箱验证码" }, 400);
        const v = await takeVCode(env, "register", email, code);
        if (!v.ok) return json(request, { error: v.error }, 400);
        emailVerified = true;
      }

      const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      const passHash = await hashPassword(password, salt);
      const handle = await allocateHandle(env, email, wanted);
      await env.PROFILES.put(key, JSON.stringify({
        email, handle, displayName,
        emailVerified,
        createdAt: new Date().toISOString(),
      }));
      /* 密码凭据单独存一个键：改密码时只写它，不会把资料字段覆盖掉 */
      await writeCredential(env, email, salt, passHash, 0);
      await rateLimitHit(regKey, 3600);

      /* 邀请奖：注册成功后结算给邀请人（+100）。失败一律静默 ——
         推荐关系出问题不能让人注册不进来。 */
      let referral = null;
      try {
        const settled = await settleReferral(env, body.ref, email, handle);
        if (settled && settled.ok) {
          referral = { points: settled.points, inviter: settled.inviterLogin };
          const rec = await kvGetJSON(env, key, null, true);
          if (rec) await env.PROFILES.put(key, JSON.stringify({ ...rec, refBy: settled.inviterLogin, refCode: String(body.ref || "").trim().toUpperCase() }));
        }
      } catch { /* 忽略 */ }

      const { cookie, token } = await createSession(request, env, email, { salt, hash: passHash, ver: 0 });
      return json(request, { ok: true, token, referral, user: { login: handle, handle, email, displayName, emailVerified } }, 200, cookie);
    }

    /* ---------- 邮箱登录 ---------- */
    if (url.pathname === "/auth/login" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);

      /* 限流：单账号 15 分钟 8 次失败、单 IP 15 分钟 40 次失败，挡住暴力破解 */
      const acctKey = `login:acct:${email}`;
      const ipKey = `login:ip:${clientIp(request)}`;
      const acct = await rateLimitPeek(acctKey);
      if (acct.count >= 8) {
        return json(request, { error: `密码尝试次数过多，请 ${retryAfterSec(acct.startedAt, 900)} 秒后再试` }, 429);
      }
      const ipState = await rateLimitPeek(ipKey);
      if (ipState.count >= 40) {
        return json(request, { error: `请求过于频繁，请 ${retryAfterSec(ipState.startedAt, 900)} 秒后再试` }, 429);
      }

      const raw = await env.PROFILES.get(`user:${email}`, { cacheTtl: 30 });
      const user = raw ? JSON.parse(raw) : null;
      /* 密码凭据独立存放；验证依次尝试「最近一次设置 → 当前 → 老账号兜底」，
         保证刚改完密码时新密码一定能登进来（KV 边缘缓存可能还留着旧凭据）。 */
      const cred = await verifyCredential(env, email, password);
      if (!user || !cred) {
        /* 这个邮箱曾经是某个账号的登录邮箱（用户改过邮箱）：核对密码后给出明确提示。
           只有密码正确才提示「邮箱已变更」，因此不会泄露账号是否存在。 */
        if (!user) {
          const current = await resolveCurrentEmail(env, email);
          if (current) {
            const movedCred = await verifyCredential(env, current, password);
            if (movedCred) {
              return json(request, { error: "该邮箱已不再用于登录，请使用新邮箱登录", movedTo: current }, 409);
            }
          }
        }
        await rateLimitHit(acctKey, 900);
        await rateLimitHit(ipKey, 900);
        return json(request, { error: "邮箱或密码错误" }, 401);
      }
      const ban = await banOf(env, email);
      if (ban) {
        return json(request, { error: ban.reason ? `账号已被封禁：${ban.reason}` : "账号已被封禁，如有疑问请联系管理员。" }, 403);
      }
      await rateLimitClear(acctKey);
      const { cookie, token } = await createSession(request, env, email);
      await ensureUserHandle(env, email, user);
      return json(request, { ok: true, token, user: { login: user.handle || handleFromEmail(email), handle: user.handle || "", email, displayName: user.displayName || "" } }, 200, cookie);
    }

    /* ---------- 退出登录 ---------- */
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      const id = readCookie(request, SESSION_COOKIE) || readBearerSession(request);
      if (id && env.PROFILES) await env.PROFILES.delete(`session:${id}`);
      const clear = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      return json(request, { ok: true }, 200, clear);
    }

    /* ---------- 当前用户 ---------- */
    if (url.pathname === "/me") {
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { authenticated: false }, 401);
      if (identity.type === "email") {
        const email = identity.user.email;
        /* 会话记录已包含 handle（createSession 时写入），无需再读 user:* 来算 handle，
           省掉一次慢 KV 读，/me 现在只做 1 次会话读，登录态拉取更快更稳。 */
        const handle = identity.user.handle || handleFromEmail(email);
        const admin = isAdminLogin(env, email);
        const me = { ...identity.user, handle, login: handle, email, authType: "email", isAdmin: admin };
        /* 头像外置后前端拿到的仍是可用的短链接（头像本身不再进 JSON） */
        me.avatar = avatarUrl(imgBase, handle, me.avatar, me.hasAvatar);
        return json(request, { authenticated: true, isAdmin: admin, user: me });
      }
    }

    /* ---------- 个人资料（GET / PUT） ---------- */
    if (url.pathname === "/profile") {
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "not authenticated" }, 401);

      if (request.method === "GET") {
        if (identity.type === "email") {
          const u = identity.user;
          const rec = await kvGetJSON(env, `user:${u.email}`, null, true);
          const handle = rec ? await ensureUserHandle(env, u.email, rec) : (u.handle || handleFromEmail(u.email));
          return json(request, {
            login: handle,
            handle,
            email: u.email,
            displayName: u.displayName,
            bio: u.bio,
            location: u.location,
            website: u.website,
            contact: (rec && rec.contact) || "",
            emailPublic: !!(rec && rec.emailPublic),
            emailVerified: !!(rec && rec.emailVerified),
            /* 外置后这里回短链接：前端拿它直接当 <img src>，不用再等一次 data URL */
            avatar: avatarUrl(imgBase, handle, rec && rec.avatar, rec && rec.hasAvatar),
          });
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
          /* 联系方式：用户自愿公开的联络方式（微信 / Telegram / 备用邮箱等），可留空 */
          contact: String(body.contact || "").slice(0, 200),
        };
        /* 头像：客户端压缩后的 data URL。上限 200KB（字符串长度，约 150KB 原图）。
           下面不再写进 user:*，而是落到独立的 avatar:<sid> 键，记录里只留 hasAvatar。
           nextAvatar：undefined = 本次不修改、"" = 删除、data URL = 设置。 */
        let nextAvatar;
        if (typeof body.avatar === "string") {
          if (body.avatar === "") {
            nextAvatar = "";
          } else if (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(body.avatar) && body.avatar.length <= 200000) {
            nextAvatar = body.avatar;
          } else if (body.avatar.length > 200000) {
            return json(request, { error: "头像文件太大，请换一张更小的图片" }, 413);
          }
        }
        /* 用户名（handle）：仅邮箱用户可改，全局唯一，改动后历史帖子同步改名 */
        let nextHandle = "";
        if (identity.type === "email" && typeof body.handle === "string") {
          const wanted = normalizeHandle(body.handle);
          const current = normalizeHandle(identity.user.handle || "");
          if (wanted && wanted !== current) {
            if (!HANDLE_RE.test(wanted)) {
              return json(request, { error: "用户名需 3–20 位，字母开头，只能是小写字母、数字或下划线" }, 400);
            }
            if (RESERVED_HANDLES.has(wanted)) return json(request, { error: "该用户名不可用" }, 409);
            const owner = await env.PROFILES.get(`handle:${wanted}`, { cacheTtl: 30 });
            if (owner && owner !== identity.user.email) return json(request, { error: "该用户名已被使用，换一个试试" }, 409);
            nextHandle = wanted;
          }
        }
        if (identity.type === "email") {
          const key = `user:${identity.login}`;
          const raw = await env.PROFILES.get(key, { cacheTtl: 30 });
          if (!raw) return json(request, { error: "user not found" }, 404);
          const user = JSON.parse(raw);
          Object.assign(user, allowed);
          /* 邮箱是否公开：默认关闭，只有用户主动开启才会出现在公开资料里。
             未验证过的邮箱不允许公开——否则任何人都能用别人的邮箱冒充身份。 */
          const wantPublic = body.emailPublic === true;
          if (wantPublic && !user.emailVerified) {
            return json(request, { error: "请先完成邮箱验证，再公开邮箱地址" }, 400);
          }
          user.emailPublic = wantPublic;
          if (nextHandle) {
            const prevHandle = normalizeHandle(user.handle || "");
            if (prevHandle) await env.PROFILES.delete(`handle:${prevHandle}`);
            await env.PROFILES.put(`handle:${nextHandle}`, user.email);
            user.handle = nextHandle;
            if (ctx && ctx.waitUntil) ctx.waitUntil(republishAuthor(env, user.email, nextHandle, prevHandle).catch(() => {}));
          }
          if (!user.handle) user.handle = await allocateHandle(env, user.email, "");
          /* 头像：写独立键，记录里只留标记，避免 user:* 又变回 6KB */
          if (nextAvatar !== undefined) {
            await writeAvatarRaw(env, identity.login, nextAvatar);
            delete user.avatar;
            user.hasAvatar = !!nextAvatar;
          }
          await env.PROFILES.put(key, JSON.stringify(user));
          await cacheWrite(env, key, JSON.stringify(user));
          dropCreatorsCache();
          return json(request, { ok: true, ...allowed, handle: user.handle, emailPublic: user.emailPublic });
        }
        /* GitHub 账号没有站内邮箱，不提供「公开邮箱」开关 */
        if (env.PROFILES) {
          const key = `profile:${identity.login}`;
          /* 老代码直接覆盖整条记录，会把 GitHub 头像字段一起抹掉；这里改成合并 */
          const prev = await kvGetJSON(env, key, {});
          const next = { ...prev, ...allowed };
          if (nextAvatar !== undefined) {
            await writeAvatarRaw(env, identity.login, nextAvatar);
            delete next.avatar;
            next.hasAvatar = !!nextAvatar;
          }
          await env.PROFILES.put(key, JSON.stringify(next));
          dropCreatorsCache();
        }
        return json(request, { ok: true, ...allowed });
      }
    }

    /* ---------- URL 可达性检测 ---------- */
    if (url.pathname === "/check-url" && request.method === "POST") {
      /* 必须登录：这个接口会让 Worker 代访任意地址，未鉴权等于开放代理 */
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "请先登录" }, 401);
      const body = await request.json();
      const targetUrl = String(body.url || "");
      if (!targetUrl) return json(request, { ok: false, error: "缺少 URL" }, 400);
      /* 限流：同一账号每分钟最多 20 次，避免被当作探测/代理工具 */
      const rlKey = `checkurl:${identity.login}`;
      const rl = await rateLimitPeek(rlKey);
      if (rl.count >= 20) {
        return json(request, { ok: false, error: `请求过于频繁，请 ${retryAfterSec(rl.startedAt, 60)} 秒后再试` }, 429);
      }
      await rateLimitHit(rlKey, 60);
      /* 只允许公网 http(s)，禁止内网/本机/元数据地址（SSRF） */
      const guard = assertPublicUrl(targetUrl);
      if (!guard.ok) return json(request, { ok: false, error: guard.error }, 400);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(guard.url.toString(), {
          method: "HEAD", redirect: "manual", signal: ctrl.signal,
          headers: { "User-Agent": "SolHub/1.0" },
        });
        clearTimeout(t);
        if (reachableStatus(res.status)) {
          return json(request, { ok: true, status: res.status });
        }
        return json(request, { ok: false, status: res.status, error: `网站返回 ${res.status}` });
      } catch {
        return json(request, { ok: false, error: "网站无法访问，请检查 URL 是否正确" });
      }
    }

    /* ---------- 托管工具（用户上传自包含 HTML，站内沙箱托管） ----------
       存储：PG kv，键 hosted:tool:<id>（无过期）；hosted:user:<login> 是该用户
       的工具索引（只存元信息，不含 html，避免列表请求拖着 1MB 跑）。
       托管页 GET /hosted/<id> 直接输出 text/html，响应带 CSP sandbox 且**不含
       allow-same-origin** —— 工具页运行在不透明 origin 上，拿不到 SolHub 的
       Cookie / localStorage，也发不了同源请求，与主站完全隔离。
       规则（2026-11-17 用户拍板）：要登录 + 上传即上线；是否收录进产品目录
       仍走人工核验，与本页 URL 无关。 */
    if (url.pathname === "/hosted/submit" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      /* 官方工具用管理口令发布：不必登录，owner 固定 solhub（ownerType=official）；
         带 body.id 时覆盖已有记录，方便脚本反复发布同一件工具而不产生新 id。 */
      const admin = adminKeyOk(request, env);
      const identity = admin ? { login: "solhub", type: "official" } : await getIdentity(request, env);
      if (!identity) return json(request, { error: "请先登录" }, 401);
      /* 限流：同一账号每小时最多 10 次（含失败），挡脚本刷库；管理员不限 */
      if (!admin) {
        const rlKey = `hostedsub:${identity.login}`;
        const rl = await rateLimitPeek(rlKey);
        if (rl.count >= 10) {
          return json(request, { ok: false, error: `提交过于频繁，请 ${retryAfterSec(rl.startedAt, 3600)} 秒后再试` }, 429);
        }
        await rateLimitHit(rlKey, 3600);
      }
      const body = await request.json().catch(() => null);
      if (!body) return json(request, { ok: false, error: "请求格式错误" }, 400);
      const name = String(body.name || "").trim().slice(0, 60);
      const description = String(body.description || "").trim().slice(0, 300);
      const html = String(body.html || "");
      if (!name) return json(request, { ok: false, error: "缺少工具名称" }, 400);
      if (!html.trim()) return json(request, { ok: false, error: "缺少 HTML 内容" }, 400);
      /* 1MB 上限（字符数 ≈ 字节数，中文标签场景偏保守但安全） */
      if (html.length > 1024 * 1024) return json(request, { ok: false, error: "HTML 超过 1MB 上限，请精简后重试" }, 413);
      /* 分类 / 标签 / 官网：产品页一级筛选「在线工具」需要，缺省给 productivity */
      const category = String(body.category || "").trim().slice(0, 40) || "productivity";
      const tags = Array.isArray(body.tags)
        ? body.tags.map((t) => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 8)
        : String(body.tags || "")
            .split(/[,，、]/)
            .map((t) => t.trim().slice(0, 24))
            .filter(Boolean)
            .slice(0, 8);
      const websiteUrl = String(body.websiteUrl || "").trim().slice(0, 300);
      const listKey = `hosted:user:${identity.login}`;
      const mine = admin ? [] : ((await kvGetJSON(env, listKey, [])) || []);
      if (!admin && mine.length >= 20) {
        return json(request, { ok: false, error: "每个账号最多托管 20 个工具，请先删除不需要的" }, 403);
      }
      /* 管理员可指定 id 覆盖（更新已有工具），否则新生成 */
      const idWanted = admin ? String(body.id || "").trim() : "";
      let id = /^[a-z0-9]{4,16}$/.test(idWanted) ? idWanted : "";
      const prev = id ? await kvGetJSON(env, `hosted:tool:${id}`, null) : null;
      if (!id) {
        for (let i = 0; i < 5; i++) {
          id = hostedToolId();
          if (!(await env.PROFILES.get(`hosted:tool:${id}`))) break;
          id = "";
        }
      }
      if (!id) return json(request, { ok: false, error: "生成 ID 失败，请重试" }, 500);
      const rec = {
        id,
        name,
        description,
        category,
        tags,
        websiteUrl,
        owner: identity.login,
        /* 公开归属标识：邮箱账号记 handle，GitHub 账号记用户名 —— 主页按它聚合作品，
           因此索引里可以带 ownerPid，但绝不会带邮箱本身。 */
        ownerPid: await pidOf(env, identity.login),
        ownerType: identity.type,
        createdAt: (prev && prev.createdAt) || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        html,
      };
      /* Logo 与署名只对管理员开放，普通用户提交不受影响（避免冒充官方） */
      if (admin) {
        const logo = normalizeHostedLogo(body.logo);
        if (logo) rec.logo = logo;
        else if (prev && prev.logo) rec.logo = prev.logo;
        rec.author = String(body.author || "").trim().slice(0, 40) || (prev && prev.author) || "SolHub 官方";
      }
      await kvPutJSON(env, `hosted:tool:${id}`, rec);
      if (!admin) {
        mine.unshift({ id, name, description, category, tags, createdAt: rec.createdAt });
        await kvPutJSON(env, listKey, mine);
      }
      /* 公开目录索引：产品页「在线工具」直接读它，避免遍历 kv。
         只放元信息，且**不含 owner**（邮箱登录名不能出现在公开列表里）。 */
      await hostedIndexAdd(env, rec);
      /* 创作者名录 60 秒实例缓存里存着作品数，新工具上线要立刻反映 */
      dropCreatorsCache();
      const notifyTo = admin ? "" : env.HOSTED_NOTIFY_EMAIL || "";
      if (notifyTo) {
        try {
          await sendMail(env, {
            to: notifyTo,
            subject: `[SolHub] 新托管工具：${name}`,
            text: `${identity.login} 上传了托管工具「${name}」(${id})，访问 https://solhub.solyoung.top/tools/?id=${id}`,
            html: `<p>${identity.login} 上传了托管工具「${name}」(<code>${id}</code>)。</p><p><a href="https://solhub.solyoung.top/tools/?id=${id}">打开托管页</a></p>`,
          });
        } catch { /* 通知失败不阻塞 */ }
      }
      return json(request, { ok: true, id, path: `/tools/?id=${id}` });
    }

    /* 公开社区目录：GET /community —— 返回完整的社区产品对象。
       产品列表页是构建期烘死的（src/data/community.json），仓库同步一旦失败，
       站内删掉的产品还会挂在列表里、新提交的又上不了线。前端挂载后用这份
       实时数据整体替掉「社区那部分」，删除/新增都立刻生效。 */
    if (url.pathname === "/community" && request.method === "GET") {
      const community = await readCommunity(env);
      const products = community
        .filter((p) => p && p.slug && !p.hidden)
        .map((p) => ({
          id: p.id || p.slug,
          slug: p.slug,
          name: p.name || p.slug,
          icon: p.icon || "",
          shortDescription: p.shortDescription || "",
          description: p.description || "",
          shortDescriptionEn: p.shortDescriptionEn || "",
          descriptionEn: p.descriptionEn || "",
          websiteUrl: p.websiteUrl || "",
          category: p.category || "other",
          tags: Array.isArray(p.tags) ? p.tags : [],
          developerName: p.developerName || "SolHub",
          developerLogin: p.developerLogin || p.submittedBy || "",
          publishedAt: p.publishedAt || "",
          launchBatch: p.launchBatch || "Community",
          verificationStatus: p.verificationStatus || "pending",
          verificationMethod: p.verificationMethod || "",
          verifiedAt: p.verifiedAt || "",
          ...(typeof p.rankPosition === "number" ? { rankPosition: p.rankPosition } : {}),
          ...(p.kind === "site" || p.kind === "tool" ? { kind: p.kind } : {}),
          isDemo: !!p.isDemo,
          /* 提交者用 handle/PID（公开标识），和主页、详情页用的是同一个值 */
          submittedBy: p.submittedBy || "",
        }));
      return json(request, { ok: true, products });
    }

    /* ---------- 公开目录（小程序 / 第三方客户端） ---------- */
    /* 网站的产品列表是构建期烘进去的（products.ts + community.json），运行时真源
       就是这三处：官方目录 KV、社区提交 KV、托管工具索引。小程序要做到「和网站
       同步」只能读同一份，而不是各自维护一份快照。只返回卡片需要的字段。 */
    if (url.pathname === "/catalog" && request.method === "GET") {
      const [index, community, hosted] = await Promise.all([
        readProductIndex(env),
        readCommunity(env),
        hostedIndexRead(env),
      ]);
      const abs = (u) => {
        const v = String(u || "").trim();
        if (!v) return "";
        if (/^https?:\/\//i.test(v)) return v;
        return SITE_BASE + (v.startsWith("/") ? v : `/${v}`);
      };
      const seen = new Set();
      const out = [];
      const push = (item) => {
        if (!item || !item.slug || seen.has(item.slug)) return;
        seen.add(item.slug);
        out.push({ ...item, sort_rank: out.length });
      };
      const card = (p, kind) => ({
        slug: p.slug,
        name: p.name || p.slug,
        short_desc: p.shortDescription || "",
        description: p.description || "",
        url: abs(p.websiteUrl),
        icon: abs(p.icon),
        category: p.category || "other",
        category_name: CATEGORY_NAMES[p.category] || p.category || "其他",
        tags: Array.isArray(p.tags) ? p.tags.slice(0, 6) : [],
        kind,
        verification_status: p.verificationStatus || "",
        /* 小程序详情页要区分「作者」与「收录方」：收录的是别人做的网站时，
           作者名不能拿去链到收录方主页，两者分开给 */
        developer: p.developerName || "",
        curator: p.submittedBy && p.submittedBy !== p.developerLogin ? p.submittedBy : "",
      });

      for (const p of index) {
        if (!p || !p.slug) continue;
        push(card(p, "site"));
      }
      for (const p of community) {
        if (!p || !p.slug || p.hidden) continue;
        push(card(p, "site"));
      }
      for (const t of hosted) {
        if (!t || !t.id || t.hidden) continue;
        push({
          slug: `tool-${t.id}`,
          name: t.name || t.id,
          short_desc: t.description || "",
          description: "",
          url: `${SITE_BASE}/tools/?id=${encodeURIComponent(t.id)}`,
          icon: t.hasLogo ? `${imgBase}/hosted/logo/${encodeURIComponent(t.id)}` : "",
          category: t.category || "productivity",
          category_name: CATEGORY_NAMES[t.category] || "效率工具",
          tags: Array.isArray(t.tags) ? t.tags.slice(0, 6) : [],
          kind: "tool",
          verification_status: "verified",
        });
      }
      return json(request, { ok: true, count: out.length, products: out });
    }

    /* 公开托管工具目录：GET /hosted/list?category=&limit=&offset=
       产品页「在线工具」用，无需登录。只返回元信息，不含 html / owner。 */
    if (url.pathname === "/hosted/list" && request.method === "GET") {
      const all = await hostedIndexRead(env);
      const cat = String(url.searchParams.get("category") || "").trim();
      const limitRaw = parseInt(url.searchParams.get("limit") || "60", 10);
      const offsetRaw = parseInt(url.searchParams.get("offset") || "0", 10);
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 60, 1), 100);
      const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);
      let list = all.filter((t) => t && t.id && !t.hidden);
      if (cat && cat !== "all") list = list.filter((t) => t.category === cat);
      list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      const page = list.slice(offset, offset + limit);
      return json(request, {
        ok: true,
        total: list.length,
        hasMore: offset + page.length < list.length,
        tools: page.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description || "",
          category: t.category || "productivity",
          tags: Array.isArray(t.tags) ? t.tags : [],
          createdAt: t.createdAt || "",
          author: t.author || "",
          logoUrl: t.hasLogo ? `${imgBase}/hosted/logo/${t.id}` : "",
        })),
      });
    }

    /* 我托管的工具：GET /hosted/mine（登录，返回元信息列表）。
       必须放在通用 /hosted/<id> 路由之前 —— "mine" 本身就是合法 id 格式。 */
    if (url.pathname === "/hosted/mine" && request.method === "GET") {
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "请先登录" }, 401);
      const mine = (await kvGetJSON(env, `hosted:user:${identity.login}`, [])) || [];
      return json(request, { ok: true, tools: mine });
    }

    /* 工具图标：GET /hosted/logo/<id> —— 直接发图片字节。
       库里存的是 data URI，这里解码成二进制；没有图标返回 404，前端回落通用占位图。 */
    {
      const m = url.pathname.match(/^\/hosted\/logo\/([a-z0-9]{4,16})$/);
      if (m && request.method === "GET") {
        const rec = await kvGetJSON(env, `hosted:tool:${m[1]}`, null);
        const lm =
          rec && typeof rec.logo === "string"
            ? rec.logo.match(/^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/)
            : null;
        if (!lm) {
          return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        const bin = atob(lm[2]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, {
          status: 200,
          headers: {
            ...corsFor(request),
            "Content-Type": lm[1],
            "Cache-Control": "public, max-age=604800",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      }
    }

    /* 只改图标（管理员）：POST /admin/hosted/<id>/logo
       用于给早期上传、还没有图标的工具补 Logo —— 不动 owner，
       原来的上传者依然能在「我」页删除自己的工具。 */
    {
      const m = url.pathname.match(/^\/admin\/hosted\/([a-z0-9]{4,16})\/logo$/);
      if (m && request.method === "POST") {
        if (!adminKeyOk(request, env)) return json(request, { error: "需要管理口令", needKey: true }, 401);
        const rec = await kvGetJSON(env, `hosted:tool:${m[1]}`, null);
        if (!rec) return json(request, { ok: false, error: "工具不存在" }, 404);
        const body = await request.json().catch(() => ({}));
        const logo = normalizeHostedLogo(body.logo);
        if (!logo) return json(request, { ok: false, error: "图标格式不支持或体积过大" }, 400);
        rec.logo = logo;
        await kvPutJSON(env, `hosted:tool:${rec.id}`, rec);
        await hostedIndexAdd(env, rec);
        return json(request, { ok: true, id: rec.id });
      }
    }

    /* 社区数据 ↔ 仓库 同步自检：GET /admin/sync-status
       返回 PAT 是否配置、能否读到仓库文件、KV 与仓库的条目差异。 */
    if (url.pathname === "/admin/sync-status" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      if (!adminKeyOk(request, env)) return json(request, { error: "需要管理口令", needKey: true }, 401);
      const kvCommunity = await kvGetJSON(env, KV_COMMUNITY, []);
      const probe = await probeCommunityRepo(env);
      return json(request, {
        ok: true,
        hasPat: !!env.GITHUB_PAT,
        repo: REPO,
        kvCount: Array.isArray(kvCommunity) ? kvCommunity.length : 0,
        kvSlugs: (Array.isArray(kvCommunity) ? kvCommunity : []).map((p) => p && p.slug).filter(Boolean),
        repoRead: probe,
      });
    }

    /* 强推一次社区数据到仓库：POST /admin/sync-community
       用于「站内已删但静态页还挂着」的事后修复，不需要重新登录或等别人触发。 */
    if (url.pathname === "/admin/sync-community" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      if (!adminKeyOk(request, env)) return json(request, { error: "需要管理口令", needKey: true }, 401);
      const community = await readCommunity(env);
      const res = await pushCommunityToRepo(env, community, "chore: 同步社区产品目录（运维手动触发）");
      return json(request, { ...res, count: community.length });
    }

    /* 重建托管目录索引（管理员）：POST /admin/hosted/reindex
       用途：早期索引条目没有 ownerPid（主页/名录按人聚合作品需要），这里按
       hosted:tool:<id> 里的 owner 重新算一遍 PID 并整体重写索引。幂等，可反复跑。 */
    if (url.pathname === "/admin/hosted/reindex" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      if (!adminKeyOk(request, env)) return json(request, { error: "需要管理口令", needKey: true }, 401);
      const list = await hostedIndexRead(env);
      const next = [];
      let fixed = 0;
      for (const t of list) {
        if (!t || !t.id) continue;
        const rec = await kvGetJSON(env, `hosted:tool:${t.id}`, null);
        if (!rec) continue; /* 索引里残留但记录已删 → 顺手清掉 */
        if (!rec.ownerPid && rec.owner) {
          rec.ownerPid = await pidOf(env, rec.owner);
          await kvPutJSON(env, `hosted:tool:${rec.id}`, rec);
          fixed++;
        }
        next.push(hostedMeta(rec));
      }
      await kvPutJSON(env, HOSTED_INDEX_KEY, next.slice(0, HOSTED_INDEX_MAX));
      dropCreatorsCache();
      return json(request, { ok: true, total: next.length, fixed });
    }

    /* 单个托管工具的元信息：GET /hosted/meta/<id>
       详情页 /tools/?id= 用。只回元信息，**不含 html 与邮箱登录名**：
       owner 只有在 GitHub 登录时（ownerType==="github"）才作为 handle 公开，
       邮箱登录的账号一律不透露。 */
    {
      const m = url.pathname.match(/^\/hosted\/meta\/([a-z0-9]{4,16})$/);
      if (m && request.method === "GET") {
        const rec = await kvGetJSON(env, `hosted:tool:${m[1]}`, null);
        if (!rec || rec.hidden) return json(request, { ok: false, error: "工具不存在" }, 404);
        return json(request, {
          ok: true,
          tool: {
            id: rec.id,
            name: rec.name,
            description: rec.description || "",
            category: rec.category || "productivity",
            tags: Array.isArray(rec.tags) ? rec.tags : [],
            createdAt: rec.createdAt || "",
            websiteUrl: /^https?:\/\//i.test(rec.websiteUrl || "") ? rec.websiteUrl : "",
            ownerHandle: rec.ownerType === "github" ? String(rec.owner || "") : "",
            author: rec.author || (rec.ownerType === "official" ? "SolHub 官方" : ""),
            logoUrl: rec.logo ? `${imgBase}/hosted/logo/${rec.id}` : "",
          },
        });
      }
    }

    /* 工具本体：GET /hosted/<id>，输出原始 HTML（沙箱响应头） */
    {
      const m = url.pathname.match(/^\/hosted\/([a-z0-9]{4,16})$/);
      if (m && request.method === "GET") {
        const rec = await kvGetJSON(env, `hosted:tool:${m[1]}`, null);
        if (!rec || typeof rec.html !== "string" || !rec.html.trim()) {
          return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        return new Response(rec.html, {
          status: 200,
          headers: {
            ...corsFor(request),
            "Content-Type": "text/html; charset=utf-8",
            /* 网关会默认加 content-disposition: attachment（iframe 里会变成
               下载而不是渲染），必须显式 inline 覆盖。 */
            "Content-Disposition": "inline",
            /* 不含 allow-same-origin：不透明 origin，读不到主站 Cookie/存储 */
            "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
          },
        });
      }
    }

    /* 删除自己的托管工具：DELETE /hosted/<id> */
    {
      const m = url.pathname.match(/^\/hosted\/([a-z0-9]{4,16})$/);
      if (m && request.method === "DELETE") {
        const identity = await getIdentity(request, env);
        if (!identity) return json(request, { error: "请先登录" }, 401);
        const rec = await kvGetJSON(env, `hosted:tool:${m[1]}`, null);
        if (!rec) return json(request, { ok: false, error: "工具不存在" }, 404);
        if (rec.owner !== identity.login) return json(request, { ok: false, error: "只能删除自己上传的工具" }, 403);
        await env.PROFILES.delete(`hosted:tool:${m[1]}`);
        const listKey = `hosted:user:${identity.login}`;
        const mine = ((await kvGetJSON(env, listKey, [])) || []).filter((t) => t.id !== m[1]);
        await kvPutJSON(env, listKey, mine);
        await hostedIndexRemove(env, m[1]);
        dropCreatorsCache();
        return json(request, { ok: true });
      }
    }

    /* ---------- 提交产品（登录用户自动收录到 community.json） ---------- */
    if (url.pathname === "/publish" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "请先登录" }, 401);

      /* 提交限流：同一账号 1 小时最多 6 个。
         产品目录是「整块读-改-写」，不限流的话一个账号脚本连刷几十条
         会把目录撑爆，还会连带覆盖别人同时提交的内容。 */
      const pubKey = `publish:hour:${identity.login}`;
      const pubState = await rateLimitPeek(pubKey);
      if (pubState.count >= 6) {
        return json(
          request,
          { error: `提交太频繁，请 ${retryAfterSec(pubState.startedAt, 3600)} 秒后再试` },
          429,
        );
      }

      let data;
      try { data = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const name = String(data.name || "").slice(0, 80);
      const websiteUrl = String(data.websiteUrl || "");
      if (!name) return json(request, { error: "产品名称不能为空" }, 400);
      if (!websiteUrl || !/^https?:\/\//.test(websiteUrl)) return json(request, { error: "官网 URL 不能为空且需以 http(s):// 开头" }, 400);
      /* 只允许公网地址，防止拿本站当内网跳板（SSRF） */
      const pubGuard = assertPublicUrl(websiteUrl);
      if (!pubGuard.ok) return json(request, { error: pubGuard.error }, 400);

      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const checkRes = await fetch(pubGuard.url.toString(), {
          method: "HEAD", redirect: "manual", signal: ctrl.signal,
          headers: { "User-Agent": "SolHub/1.0" },
        });
        clearTimeout(t);
        if (!reachableStatus(checkRes.status)) {
          return json(request, { error: `网站 ${websiteUrl} 返回 ${checkRes.status}，无法收录` }, 400);
        }
      } catch {
        return json(request, { error: `无法访问 ${websiteUrl}，请确认网站可以正常打开` }, 400);
      }

      const community = await readCommunity(env);

      /* 同一个网站只收一次：按「域名 + 路径」归一化比对（忽略 www. 前缀、
         末尾斜杠、大小写、query 与 fragment）。否则同一产品可以换个写法反复提交。 */
      const normSite = (u) => {
        try {
          const x = new URL(String(u || ""));
          const host = x.hostname.toLowerCase().replace(/^www\./, "");
          const path = x.pathname.replace(/\/+$/, "").toLowerCase();
          return `${host}${path}`;
        } catch {
          return "";
        }
      };
      const targetSite = normSite(websiteUrl);
      if (targetSite) {
        const dup = community.find((p) => p && normSite(p.websiteUrl) === targetSite);
        if (dup) {
          return json(
            request,
            { error: `这个网站已经被收录过了（${dup.name}），可以在「我的收录」里编辑它`, duplicated: true },
            409,
          );
        }
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Date.now().toString(36);
      const who = await displayOf(env, identity);
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
        developerName: String(data.developerName || who.name).slice(0, 80),
        publishedAt: new Date().toISOString().slice(0, 10),
        launchBatch: "Community",
        verificationStatus: "verified",
        verificationMethod: "官网链接自动检测可访问，已自动收录上线",
        verifiedAt: new Date().toISOString().slice(0, 10),
        isDemo: false,
        submittedBy: who.login,
      };
      community.push(newProduct);

      /* 主存储：写回 KV，产品立刻出现在个人主页与「我的收录」 */
      await kvPutJSON(env, KV_COMMUNITY, community);
      await rateLimitHit(pubKey, 3600);

      /* 提交产品自动点亮黄V：邮箱账号须已通过邮箱验证（未点亮过才写，幂等）。
         满足即视为创作者身份可信，登录态、头像、作品同属一人。 */
      let verifiedGranted = false;
      try {
        if (identity.type === "email") {
          const ukey = `user:${identity.login}`;
          const u = await kvGetJSON(env, ukey, null, true);
          if (u && u.emailVerified && !u.verified) {
            u.verified = true;
            u.verifiedAt = new Date().toISOString().slice(0, 10);
            const next = JSON.stringify(u);
            await env.PROFILES.put(ukey, next);
            await cacheWrite(env, ukey, next);
            verifiedGranted = true;
            dropCreatorsCache();
          }
        }
      } catch { /* 徽章点亮失败不影响提交结果，下次提交会再补 */

      }

      /* 尽力同步到仓库（供静态站构建期目录；PAT 缺失或失败不影响提交结果） */
      const synced = await syncCommunityToRepo(env, community, `community: add ${name} by @${who.login}`);
      /* 官方账号自动播报新品（后台执行，不影响提交结果） */
      if (ctx && ctx.waitUntil) ctx.waitUntil(announceNewProduct(env, newProduct).catch(() => {}));
      else announceNewProduct(env, newProduct).catch(() => {});
      return json(request, {
        ok: true,
        product: newProduct,
        synced,
        verifiedGranted,
        message: verifiedGranted
          ? "链接检测通过，产品已收录上线；你的认证徽章也已自动点亮"
          : "链接检测通过，产品已自动收录上线",
      });
    }

    /* ---------- 我的收录产品 ---------- */
    if (url.pathname === "/my-products" && request.method === "GET") {
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "not authenticated" }, 401);
      const myPid = await pidOf(env, identity.login);
      const [community, index, mine] = await Promise.all([
        readCommunity(env),
        readProductIndex(env),
        kvGetJSON(env, `user:${identity.login}`, null),
      ]);
      const claimed = mergeProducts(
        productsOf(community, myPid),
        allClaimedSlugs(index, myPid, mine),
        index,
      );
      return json(request, { products: claimed });
    }

    if (url.pathname.startsWith("/my-products/")) {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "not authenticated" }, 401);
      const slug = url.pathname.split("/")[2];

      const community = await readCommunity(env);
      const myPid = await pidOf(env, identity.login);
      const idx = community.findIndex(
        (p) => p.slug === slug && (p.submittedBy === myPid || p.submittedBy === identity.login),
      );
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
            const nextGuard = assertPublicUrl(nextUrl);
            if (!nextGuard.ok) return json(request, { error: nextGuard.error }, 400);
            try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 5000);
              const checkRes = await fetch(nextGuard.url.toString(), {
                method: "HEAD", redirect: "manual", signal: ctrl.signal,
                headers: { "User-Agent": "SolHub/1.0" },
              });
              clearTimeout(t);
              if (!reachableStatus(checkRes.status)) {
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

      /* 主存储：写回 KV（保证个人主页 / 我的收录立即可见） */
      await kvPutJSON(env, KV_COMMUNITY, community);
      /* 尽力同步到仓库（供静态站构建期目录；PAT 缺失或失败不影响结果） */
      const synced = await pushCommunityToRepo(
        env,
        community,
        `${request.method === "DELETE" ? "remove" : "update"} community product ${slug} by @${myPid}`,
      );
      dropCreatorsCache();
      return json(request, { ok: true, synced: synced.ok, syncError: synced.error || "" });
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

    /* 官方账号：手动播报某个社区产品（补发 / 测试用） */
    if (url.pathname === "/admin/official/announce" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const gate = await requireAdmin(request, env);
      if (gate.error) return gate.error;
      let body = {};
      try { body = await request.json(); } catch {}
      const slug = String(body.slug || "").trim();
      const community = await readCommunity(env);
      const product = (Array.isArray(community) ? community : []).find((p) => p.slug === slug);
      if (!product) return json(request, { error: "产品不存在" }, 404);
      const post = await announceNewProduct(env, { ...product, submittedBy: "" });
      if (!post) return json(request, { error: "发帖失败" }, 500);
      return json(request, { ok: true, post });
    }

    /* 官方账号：手动触发一条社区产品推荐（便于测试） */
    if (url.pathname === "/admin/official/suggest" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const gate = await requireAdmin(request, env);
      if (gate.error) return gate.error;
      const res = await suggestWithDailyQuota(env, true);
      if (!res.ok) return json(request, { ok: false, reason: res.skipped }, 200);
      return json(request, { ok: true, post: res.post });
    }

    if (url.pathname === "/admin/users" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const gate = await requireAdmin(request, env);
      if (gate.error) return gate.error;

      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      let users = await listAllUsers(env, 500, imgBase);
      if (q) {
        users = users.filter((u) =>
          u.name.toLowerCase().includes(q) ||
          u.login.toLowerCase().includes(q) ||
          String(u.handle || "").toLowerCase().includes(q) ||
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
          const pid = await pidOf(env, login);
          await Promise.all([
            env.PROFILES.delete(`feed:user:${login}`),
            env.PROFILES.delete(key),
            env.PROFILES.delete(`pw:${login}`),
            env.PROFILES.delete(`pwnew:${login}`),
            env.PROFILES.delete(`ban:${login}`),
            pid && pid !== login ? env.PROFILES.delete(`ban:${pid}`) : null,
            pid && pid !== login ? env.PROFILES.delete(`handle:${pid}`) : null,
            env.PROFILES.delete(`following:${login}`),
            env.PROFILES.delete(`followers:${login}`),
          ].filter(Boolean));
          return json(request, { ok: true, deletedPosts: ids.length });
        }

        if (request.method !== "POST") return json(request, { error: "method not allowed" }, 405);
        let body = {};
        try { body = await request.json(); } catch {}

        if (action === "ban") {
          if (isAdminLogin(env, login)) return json(request, { error: "不能封禁管理员账号" }, 400);
          /* 封禁键写两份：SID（登录态拦截）+ PID（信息流过滤历史帖子） */
          const pid = await pidOf(env, login);
          const banKeys = pid && pid !== login ? [...new Set([login, pid])] : [login];
          if (body.banned) {
            for (const key2 of banKeys) {
              await env.PROFILES.put(
                `ban:${key2}`,
                JSON.stringify({ bannedAt: new Date().toISOString(), reason: String(body.reason || "").slice(0, 200), by: gate.identity.login }),
              );
            }
          } else {
            for (const key2 of banKeys) await env.PROFILES.delete(`ban:${key2}`);
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
          try { JSON.parse(raw); } catch { return json(request, { error: "用户数据损坏" }, 500); }
          const next = String(body.password || "").trim() || (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6));
          if (next.length < 8) return json(request, { error: "密码至少 8 位" }, 400);
          const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
          const passHash = await hashPassword(next, salt);
          /* 凭据独立存放：管理员改密同样不整条重写资料记录 */
          const prev = await readCredential(env, login);
          await writeCredential(env, login, salt, passHash, ((prev && prev.ver) || 0) + 1, {
            passwordResetAt: new Date().toISOString(),
          });
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
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
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
          const idx = community.findIndex((p) => p.slug === slug);
          if (idx === -1) return json(request, { error: "产品不存在" }, 404);
          community[idx].verificationStatus = verified ? "verified" : "pending";
          community[idx].verifiedAt = verified ? stamp : "";
          community[idx].verifiedBy = verified ? gate.identity.login : "";
          /* 主存储写 KV，仓库同步尽力而为 */
          await kvPutJSON(env, KV_COMMUNITY, community);
          const synced = await syncCommunityToRepo(
            env,
            community,
            `admin: ${verified ? "verify" : "unverify"} community product ${slug}`,
          );
          return json(request, { ok: true, verified, source: "community", synced });
        }

        await env.PROFILES.put(
          `product:override:${slug}`,
          JSON.stringify({ verified, verifiedAt: stamp, verifiedBy: gate.identity.login }),
        );
        return json(request, { ok: true, verified, source: "catalog" });
      }
    }


    /* ---------- 头像（单独出图，可被浏览器与 CDN 缓存） ----------
       列表接口里的 authorAvatar / avatar 现在只回 /avatar/<login> 这样的短链接，
       真正的字节在这里发。带 ETag + 1 小时缓存，同一张头像一次会话只下一次。 */
    if (url.pathname.startsWith("/avatar/") && request.method === "GET") {
      const baseHeaders = { ...corsFor(request) };
      if (!env.PROFILES) return new Response(null, { status: 404, headers: baseHeaders });
      const login = decodeURIComponent(url.pathname.slice("/avatar/".length)).replace(/^@+/, "").trim();
      let raw = "";
      if (login) {
        const sid = await sidOf(env, login);
        if (sid) {
          const rec = isEmailLogin(sid)
            ? await kvGetJSON(env, `user:${sid}`, null, true)
            : await kvGetJSON(env, `profile:${sid}`, null);
          raw = await readAvatarRaw(env, sid, rec);
        }
      }
      if (!raw) return new Response(null, { status: 404, headers: baseHeaders });
      /* GitHub 头像等外链，直接跳转 */
      if (/^https?:\/\//i.test(raw)) {
        return new Response(null, { status: 302, headers: { ...baseHeaders, Location: raw } });
      }
      const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(raw);
      if (!m) return new Response(null, { status: 404, headers: baseHeaders });
      let bytes;
      try { bytes = fromB64(m[2]); } catch { return new Response(null, { status: 404, headers: baseHeaders }); }
      const headers = {
        ...baseHeaders,
        "Content-Type": m[1],
        /* 历史数据里可能残留 image/svg+xml：SVG 能带脚本，直接打开这个地址就会
           在 API 域下执行（同域能带 Cookie 发请求）。这里禁掉嗅探并套一层
           sandbox，即使被存了 SVG 也跑不了脚本。 */
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "public, max-age=3600",
        ETag: `W/"${bytes.length}"`,
      };
      const inm = request.headers.get("If-None-Match") || "";
      if (inm && inm === headers.ETag) return new Response(null, { status: 304, headers });
      return new Response(bytes, { status: 200, headers });
    }

    /* ---------- 热点（/hot） ----------
       数据由 solhub-hot 云函数每 15 分钟抓一轮、写进 kv:hot:v1，这里只读。
       站内不做「请求时现抓」：一轮抓取要 5~20 秒，放请求链路上就是把读者挂在
       白屏上，还等于把人家媒体站当自家缓存用。

       60 秒实例缓存：抓取节奏是 15 分钟一次，读者看到 60 秒前的榜单毫无感知，
       但能把这期间几十上百次请求压成一次 KV 读。分类过滤与分页都在缓存之上做。 */
    if (url.pathname === "/hot" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const cat = String(url.searchParams.get("cat") || "all");
      const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || 60) || 60), 200);
      const since = String(url.searchParams.get("since") || "");
      const q = String(url.searchParams.get("q") || "").trim();

      const feed = await readHotFeed(env);
      const counts = { all: feed.items.length, ai: 0, product: 0, tech: 0, finance: 0, world: 0 };
      for (const it of feed.items) if (counts[it.category] !== undefined) counts[it.category] += 1;

      let items = cat === "all" ? feed.items : feed.items.filter((it) => it.category === cat);
      if (since) {
        const t = Date.parse(since);
        if (Number.isFinite(t)) items = items.filter((it) => Date.parse(it.publishedAt) > t);
      }
      /* 搜索放在 since 之后、切片之前：先过滤再分页，否则 372 条里只有最新的
         200 条能被搜到，读者搜一条上周的标题会得到「没有结果」。
         按关键词匹配的规则在 worker/hot-search.js，前后端只有这一份。 */
      if (q) items = searchHotItems(items, q);
      const total = items.length;
      const page = items.slice(0, limit);

      return json(request, {
        fetchedAt: feed.fetchedAt,
        counts,
        total,
        /* hasMore 按「筛选后的总数」算，轮询只需要 newest 与客户端已有列表比对，不看它 */
        hasMore: page.length < items.length,
        items: page,
      });
    }

    /* ---------- 创作者名录 ----------
       数据源与 /users/<pid> 完全一致：邮箱账号（user:<email>）+ GitHub 账号（profile:<gh>）。
       产品数按「社区提交 + 目录归属 + 手动认领」合并去重后统计，与个人主页显示的数量一致。
       只用于列表展示，不返回邮箱、会话、封禁原因等私有字段。 */
    if (url.pathname === "/creators" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const qRaw = String(url.searchParams.get("q") || "").trim().slice(0, 60).toLowerCase();
      const filter = String(url.searchParams.get("filter") || "all");
      const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || 100) || 100), 200);
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);

      const base = await creatorsList(env, imgBase);

      /* 命中搜索的才需要检查封禁 —— 封禁已在缓存构建时过滤掉了，这里不再重复查 */
      let list = base;
      if (qRaw) list = list.filter((c) => hit(qRaw, [c.name, c.login, c.bio, c.website, c.location]));

      const counts = {
        all: list.length,
        verified: list.filter((x) => x.verified).length,
        products: list.filter((x) => x.productCount > 0).length,
      };
      if (filter === "verified") list = list.filter((x) => x.verified);
      else if (filter === "products") list = list.filter((x) => x.productCount > 0);

      /* 分页：offset 是本页在「筛选后列表」里的下标，够翻到最后一个账号 */
      const page = list.slice(offset, offset + limit);
      return json(request, {
        total: counts.all,
        counts,
        creators: page,
        hasMore: offset + page.length < list.length,
        nextOffset: offset + page.length,
      });
    }

    /* ---------- 点击量：产品页「按点击量排名」的唯一数据源 ----------
       只记「打开官网 / 全屏使用」这类真实意向点击，不记列表曝光。
       去重与计数写在同一个键里（一次写，不用 Cache API —— 那套在 CloudBase
       上没有 caches 对象，等于不生效）：d 里放「目标 + IP 摘要」的最近点击时间，
       10 分钟内重复点击直接返回 counted:false。IP 不落库，只存摘要。 */
    if (url.pathname === "/stats/clicks" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { clicks: {} });
      const rec = await kvGetJSON(env, CLICKS_KEY, null);
      const counts = rec && typeof rec === "object" && rec.c && typeof rec.c === "object" ? rec.c : {};
      return json(request, { clicks: counts });
    }

    if (url.pathname === "/stats/click" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { ok: false, error: "storage not configured" }, 500);
      const body = await request.json().catch(() => null);
      const slug = String((body && body.slug) || "").trim().toLowerCase().slice(0, 64);
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(slug)) {
        return json(request, { ok: false, error: "slug 不合法" }, 400);
      }
      const now = Date.now();
      const rec = await kvGetJSON(env, CLICKS_KEY, null);
      const counts = rec && rec.c && typeof rec.c === "object" ? { ...rec.c } : {};
      const seen = rec && rec.d && typeof rec.d === "object" ? { ...rec.d } : {};

      /* 去重键优先用前端生成的访客标识（localStorage 里的随机 id）：
         走 CloudBase 网关时 X-Forwarded-For 最右一跳是网关自己，按 IP 去重
         会把不同访客算成同一个、也可能把同一访客算成两个，两者都不对。 */
      const visitor = String((body && body.vid) || "").trim().slice(0, 64);
      const stamp = `${slug}:${shortHash(visitor || clientIp(request))}`;
      if (seen[stamp] && now - Number(seen[stamp]) < CLICK_DEDUPE_MS) {
        return json(request, { ok: true, counted: false, count: Number(counts[slug]) || 0 });
      }
      seen[stamp] = now;
      counts[slug] = (Number(counts[slug]) || 0) + 1;

      /* 去重表只保留窗口内的记录；计数表只留头部，避免这个键无上限膨胀 */
      const dedupe = {};
      for (const [k, v] of Object.entries(seen)) {
        if (now - Number(v) < CLICK_DEDUPE_MS) dedupe[k] = v;
      }
      let top = counts;
      const entries = Object.entries(counts);
      if (entries.length > CLICKS_MAX) {
        entries.sort((a, b) => b[1] - a[1]);
        top = Object.fromEntries(entries.slice(0, CLICKS_MAX));
      }
      await kvPutJSON(env, CLICKS_KEY, { c: top, d: dedupe });
      return json(request, { ok: true, counted: true, count: top[slug] });
    }

    /* ---------- 邀请码解析（公开）：join 页显示「你是由 @x 邀请的」 ---------- */
    if (url.pathname === "/ref/resolve" && request.method === "GET") {
      const code = String(url.searchParams.get("code") || "").trim().toUpperCase();
      if (!REF_CODE_RE.test(code)) return json(request, { ok: false, error: "邀请码格式不对" }, 400);
      if (!env.PROFILES) return json(request, { ok: false }, 500);
      const sid = await env.PROFILES.get(codeIndexKey(code), { cacheTtl: 30 });
      if (!sid) return json(request, { ok: false, error: "邀请码不存在" }, 404);
      const u = await publicUser(env, sid);
      return json(request, {
        ok: true,
        inviter: {
          login: u.login,
          name: u.name,
          avatar: avatarUrl(imgBase, u.login, u.avatar, u.hasAvatar),
        },
      });
    }

    /* ---------- 我的钱包（需要登录）：余额 / 邀请码 / 已邀请 / 明细 ---------- */
    if (url.pathname === "/wallet" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "请先登录" }, 401);
      const sid = identity.sid || identity.login;
      const code = await refCodeOf(env, sid);
      const [snap, ledger, invited] = await Promise.all([
        walletSnapshot(env, sid),
        kvGetJSON(env, ledgerKey(sid), []) || [],
        kvGetJSON(env, invitedKey(sid), []) || [],
      ]);
      return json(request, {
        ok: true,
        ...snap,
        code,
        link: code ? `${SITE_BASE}/join/?ref=${code}` : "",
        invitePoints: INVITE_POINTS,
        invitedCount: invited.length,
        invited: invited.slice(0, 20),
        ledger: Array.isArray(ledger) ? ledger.slice(0, 50) : [],
      });
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
        searchUsers(env, q, limit, imgBase),
        searchPosts(env, q, viewer, limit, imgBase),
      ]);
      return json(request, { query: qRaw, users, posts });
    }

    /* ---------- 世界：信息流 ---------- */
    if (url.pathname === "/world" && request.method === "GET") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const identity = await getIdentity(request, env);
      const viewer = identity ? identity.login : null; // SID：仅内部使用
      const viewerPid = viewer ? await pidOf(env, viewer) : null;
      const tab = url.searchParams.get("tab") || "latest";
      const author = url.searchParams.get("author") || "";
      const limit = Math.min(Number(url.searchParams.get("limit") || 30) || 30, 50);
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);

      let ids = [];
      if (author) {
        /* author 传的是 handle（兼容旧链接里的邮箱） */
        const authorSid = await sidOf(env, author);
        ids = await kvGetJSON(env, `feed:user:${authorSid}`, []);
      } else if (tab === "following" && viewer) {
        const following = await kvGetJSON(env, `following:${viewer}`, []);
        const all = (await kvGetJSON(env, "feed:global", [])).slice(0, 120);
        const recs = (await Promise.all(all.map((id) => kvGetJSON(env, `post:${id}`, null)))).filter(Boolean);
        await normalizeAuthors(env, recs, "author");
        /* 「关注」页先攒够 60 条候选，这样它也能翻页，不只是第一屏 30 条 */
        const want = Math.max(limit, 60);
        recs.forEach((p) => {
          if (ids.length >= want) return;
          if (following.includes(p.author) || p.author === viewerPid) ids.push(p.id);
        });
      } else {
        ids = await kvGetJSON(env, "feed:global", []);
      }

      const page = await feedPage(env, ids, viewer, limit, imgBase, offset);
      return json(request, {
        posts: page.posts,
        viewer: viewerPid,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
      });
    }

    /* ---------- 世界：发帖 ---------- */
    if (url.pathname === "/world/posts" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const identity = await getIdentity(request, env);
      if (!identity) return json(request, { error: "请先登录后再发布" }, 401);
      const blocked = await blockedIfBanned(request, env, identity.login);
      if (blocked) return blocked;

      /* 频率限制：同一账号 30 秒一条、每天最多 30 条。
         用 Cache API 计数，不消耗 KV 每天 1000 次的写入额度。 */
      const gapKey = `post:gap:${identity.login}`;
      const dayKey = `post:day:${identity.login}`;
      const gap = await rateLimitPeek(gapKey);
      if (gap.count >= 1) {
        return json(request, { error: `发布太频繁，请 ${retryAfterSec(gap.startedAt, 30)} 秒后再试` }, 429);
      }
      const day = await rateLimitPeek(dayKey);
      if (day.count >= 30) {
        return json(request, { error: "今日发帖已达上限（30 条），明天再来吧" }, 429);
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
      ]);
      await Promise.all([rateLimitHit(gapKey, 30), rateLimitHit(dayKey, 86400)]);
      await Promise.all([
        pushFeed(env, "feed:global", id),
        pushFeed(env, `feed:user:${identity.login}`, id),
      ]);
      return json(request, {
        ok: true,
        post: {
          ...post,
          authorAvatar: avatarUrl(imgBase, post.author, post.authorAvatar),
          likeCount: 0,
          likedByMe: false,
          commentCount: 0,
        },
      });
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
        if (!identity) return json(request, { error: "只能删除自己的帖子" }, 403);
        const viewerPid = await pidOf(env, identity.login);
        if (post.author !== viewerPid && post.author !== identity.login) {
          return json(request, { error: "只能删除自己的帖子" }, 403);
        }
        await env.PROFILES.delete(`post:${id}`);
        await env.PROFILES.delete(`post:${id}:likes`);
        await env.PROFILES.delete(`post:${id}:comments`);
        await removeFromFeed(env, "feed:global", id);
        await removeFromFeed(env, `feed:user:${identity.login}`, id);
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
          await normalizeAuthors(env, comments, "author");
          for (const c of comments) c.authorAvatar = avatarUrl(imgBase, c.author, c.authorAvatar);
          return json(request, { comments });
        }
        if (request.method === "POST") {
          if (!identity) return json(request, { error: "登录后才能评论" }, 401);
          const blocked = await blockedIfBanned(request, env, identity.login);
          if (blocked) return blocked;
          /* 评论限流：同一账号 10 秒一条（Cache 计数，不占 KV 写入额度） */
          const rlKey = `comment:gap:${identity.login}`;
          const rlState = await rateLimitPeek(rlKey);
          if (rlState.count >= 1) {
            return json(request, { error: `评论太频繁，请 ${retryAfterSec(rlState.startedAt, 10)} 秒后再试` }, 429);
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
          await rateLimitHit(rlKey, 10);
          return json(request, {
            ok: true,
            comment: { ...comment, authorAvatar: avatarUrl(imgBase, comment.author, comment.authorAvatar) },
            commentCount: comments.length,
          });
        }
      }
    }

    /* ---------- 世界：用户公开主页 / 关注 ---------- */
    if (url.pathname.startsWith("/users/")) {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      const parts = url.pathname.split("/").filter(Boolean); // users <pid> [follow|following|followers]
      const rawTarget = decodeURIComponent(parts[1] || "");
      const action = parts[2] || "";
      const identity = await getIdentity(request, env);
      const viewer = identity ? identity.login : null; // SID
      const viewerPid = viewer ? await pidOf(env, viewer) : null;
      const targetSid = rawTarget ? await sidOf(env, rawTarget) : "";
      if (!targetSid) return json(request, { error: "用户不存在" }, 404);
      /* 账号必须真实存在，否则任意字符串都会生成一个空白"幽灵主页" */
      if (!(await accountExists(env, targetSid))) {
        return json(request, { error: "用户不存在" }, 404);
      }
      const targetPid = await pidOf(env, targetSid);

      if (action === "follow" && request.method === "POST") {
        if (!identity) return json(request, { error: "登录后才能关注" }, 401);
        const blocked = await blockedIfBanned(request, env, identity.login);
        if (blocked) return blocked;
        if (viewer === targetSid) return json(request, { error: "不能关注自己" }, 400);
        /* 关注关系按 SID 存键（内部），列表里存 PID（公开） */
        const nowFollowing = await toggleInList(env, `following:${viewer}`, targetPid);
        await toggleInList(env, `followers:${targetSid}`, viewerPid);
        const followers = await kvGetJSON(env, `followers:${targetSid}`, []);
        return json(request, { ok: true, following: nowFollowing, followerCount: followers.length });
      }

      if (action === "following" || action === "followers") {
        const list = await kvGetJSON(env, `${action}:${targetSid}`, []);
        const users = [];
        for (const pid of list.slice(0, 100)) {
          const u = await publicUser(env, pid);
          users.push({ ...u, avatar: avatarUrl(imgBase, u.login, u.avatar, u.hasAvatar) });
        }
        return json(request, { users });
      }

      if (action === "") {
        const [followers, following, postIds, myFollowing, community, user, index, ban, hostedIndex] = await Promise.all([
          kvGetJSON(env, `followers:${targetSid}`, []),
          kvGetJSON(env, `following:${targetSid}`, []),
          kvGetJSON(env, `feed:user:${targetSid}`, []),
          viewer ? kvGetJSON(env, `following:${viewer}`, []) : Promise.resolve([]),
          readCommunity(env),
          kvGetJSON(env, `user:${targetSid}`, null, true),
          readProductIndex(env),
          banOf(env, targetSid),
          /* 有作品的人不多，索引只读一次；工具由 ownerPid 归户，和产品一起算「作品」 */
          hostedIndexRead(env),
        ]);
        const author = await publicUser(env, targetPid);
        const page = await feedPage(env, postIds, viewer, 20, imgBase, 0);
        const posts = page.posts;
        const mine = mergeProducts(productsOf(community, targetPid), allClaimedSlugs(index, targetPid, user), index);
        const overrides = await readProductOverrides(env, mine.map((p) => p.slug));
        /* 作品 = 收录/认领的产品 + 上传的托管工具（官网作品数也是这个口径） */
        const products = [...mine.map((p) => applyOverride(p, overrides)), ...hostedCardsOf(hostedIndex, targetPid, imgBase)];
        return json(request, {
          user: {
            ...author,
            avatar: avatarUrl(imgBase, author.login, author.avatar, author.hasAvatar),
            bio: user?.bio || "",
            location: user?.location || "",
            website: user?.website || "",
            contact: user?.contact || author.contact || "",
            /* 邮箱默认不公开；只有用户本人开启「公开邮箱」且邮箱已验证后才展示 */
            email: user?.emailPublic && user?.emailVerified ? (user.email || "") : "",
            emailVerified: !!user?.emailVerified,
            joinedAt: user?.createdAt || "",
            verified: !!user?.verified,
            official: !!user?.official,
            banned: !!ban,
          },
          followerCount: followers.length,
          followingCount: following.length,
          postCount: postIds.length,
          productCount: products.length,
          isFollowing: myFollowing.includes(targetPid),
          isSelf: viewer === targetSid,
          posts,
          /* 主页也分页：postCount 可能远超首屏 20 条，前端按 offset 续拉 */
          postsHasMore: page.hasMore,
          postsNextOffset: page.nextOffset,
          products,
        });
      }
    }

    /* ---------- 运维：重置某账号头像（存量头像压缩迁移用） ----------
       只改 user:<email> 的 avatar 一个字段，value 必须是合法的图片 data URL，
       并且 base64 长度要是 4 的倍数（截断/多字符会在这里被挡住，不会写坏数据）。 */
    if (url.pathname === "/admin/set-avatar" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      if (!adminKeyOk(request, env)) return json(request, { error: "需要管理口令", needKey: true }, 401);
      let body = {};
      try { body = await request.json(); } catch { return json(request, { error: "invalid json" }, 400); }
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return json(request, { error: "items 不能为空" }, 400);
      const done = [];
      for (const item of items.slice(0, 50)) {
        const email = String(item.email || "").trim().toLowerCase();
        const avatar = String(item.avatar || "");
        if (!EMAIL_RE.test(email)) return json(request, { error: `邮箱格式不正确：${email}` }, 400);
        const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(avatar);
        if (!m) return json(request, { error: `头像不是合法的图片 data URL：${email}` }, 400);
        if (m[2].length % 4 !== 0) return json(request, { error: `头像 base64 长度异常（${m[2].length}）：${email}` }, 400);
        if (avatar.length > 40000) return json(request, { error: `头像过大（${avatar.length}）：${email}` }, 413);
        const key = `user:${email}`;
        const user = await kvGetJSON(env, key, null, true);
        if (!user) return json(request, { error: `账号不存在：${email}` }, 404);
        /* 写独立键，记录里只留 hasAvatar —— 与 PUT /profile 走同一条路径 */
        await writeAvatarRaw(env, email, avatar);
        delete user.avatar;
        user.hasAvatar = true;
        const next = JSON.stringify(user);
        await env.PROFILES.put(key, next);
        await cacheWrite(env, key, next);
        dropCreatorsCache();
        done.push({ email, bytes: Math.floor((m[2].length * 3) / 4) });
      }
      return json(request, { ok: true, updated: done });
    }

    /* ---------- 运维：把存量内联头像搬到 avatar:<sid> ----------
       一次性迁移。对每个 user:* 记录：
         avatar 是 data URL  → 写 avatar:<email>，记录里改成 hasAvatar: true
         avatar 是外链/为空  → 不动（外链本身就是短字符串，没必要搬）
       dryRun 只统计不写库，便于先看影响面。 */
    if (url.pathname === "/admin/externalize-avatars" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      if (!adminKeyOk(request, env)) return json(request, { error: "需要管理口令", needKey: true }, 401);
      let body = {};
      try { body = await request.json(); } catch {}
      const dryRun = body.dryRun !== false; /* 默认只看不写 */
      const cap = Math.min(Math.max(1, Number(body.cap || 500) || 500), 2000);

      const keys = await listKeys(env, "user:", cap);
      const raws = await kvGetMany(env, keys);
      const report = { dryRun, scanned: keys.length, moved: 0, kept: 0, empty: 0, freedBytes: 0, bytes: [] };

      for (let i = 0; i < keys.length; i += 1) {
        const raw = raws[i];
        if (!raw) continue;
        let u;
        try { u = JSON.parse(raw); } catch { continue; }
        const email = String(u.email || keys[i].slice(5) || "").toLowerCase();
        const av = String(u.avatar || "");
        if (!av) { report.empty += 1; continue; }
        if (!/^data:image\//i.test(av)) { report.kept += 1; continue; }
        if (!dryRun) {
          await writeAvatarRaw(env, email, av);
          delete u.avatar;
          u.hasAvatar = true;
          await env.PROFILES.put(keys[i], JSON.stringify(u));
        }
        report.moved += 1;
        report.freedBytes += av.length;
        if (report.bytes.length < 10) report.bytes.push({ login: u.handle || email, avatarChars: av.length });
      }
      if (!dryRun) dropCreatorsCache();
      return json(request, { ok: true, ...report });
    }

    /* ---------- 运维：指定某账号的用户名（保留名可在此豁免） ---------- */
    if (url.pathname === "/admin/set-handle" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      if (!adminKeyOk(request, env)) return json(request, { error: "需要管理口令", needKey: true }, 401);
      let body = {};
      try { body = await request.json(); } catch {}
      const email = String(body.email || "").trim().toLowerCase();
      const wanted = normalizeHandle(body.handle);
      if (!EMAIL_RE.test(email)) return json(request, { error: "邮箱不正确" }, 400);
      if (!HANDLE_RE.test(wanted)) {
        return json(request, { error: "用户名需 3–20 位，字母开头，只能是小写字母、数字或下划线" }, 400);
      }
      const raw = await env.PROFILES.get(`user:${email}`);
      if (!raw) return json(request, { error: "账号不存在" }, 404);
      const owner = await env.PROFILES.get(`handle:${wanted}`);
      if (owner && owner !== email) return json(request, { error: "该用户名已被占用" }, 409);
      let user;
      try { user = JSON.parse(raw); } catch { return json(request, { error: "用户数据损坏" }, 500); }
      const prev = normalizeHandle(user.handle || "");
      if (prev && prev !== wanted) await env.PROFILES.delete(`handle:${prev}`);
      await env.PROFILES.put(`handle:${wanted}`, email);
      user.handle = wanted;
      await env.PROFILES.put(`user:${email}`, JSON.stringify(user));
      await cacheWrite(env, `user:${email}`, JSON.stringify(user));
      dropCreatorsCache();
      await republishAuthor(env, email, wanted, prev);
      return json(request, { ok: true, email, handle: wanted, previous: prev });
    }

    /* ---------- 一次性数据迁移：给存量账号补 handle，把公开标识里的邮箱换掉 ---------- */
    if (url.pathname === "/admin/migrate-handles" && request.method === "POST") {
      if (!env.PROFILES) return json(request, { error: "storage not configured" }, 500);
      if (!adminKeyOk(request, env)) return json(request, { error: "需要管理口令", needKey: true }, 401);

      const userKeys = await listKeys(env, "user:", 500);
      const raws = await kvGetMany(env, userKeys);
      const handles = new Map(); // email → handle
      const report = { users: [], posts: 0, comments: 0, follows: 0 };

      for (let i = 0; i < userKeys.length; i += 1) {
        if (!raws[i]) continue;
        let u;
        try { u = JSON.parse(raws[i]); } catch { continue; }
        const email = u.email || userKeys[i].slice(5);
        const before = u.handle || "";
        const handle = await ensureUserHandle(env, email, u);
        handles.set(email, handle);
        report.users.push({ email, before, handle });
      }

      /* 帖子与评论里的作者标识 */
      const ids = await kvGetJSON(env, "feed:global", []);
      const postRaws = await kvGetMany(env, ids.map((id) => `post:${id}`));
      for (let i = 0; i < postRaws.length; i += 1) {
        if (!postRaws[i]) continue;
        let post;
        try { post = JSON.parse(postRaws[i]); } catch { continue; }
        const next = handles.get(post.author);
        if (next && next !== post.author) {
          post.author = next;
          await kvPutJSON(env, `post:${ids[i]}`, post);
          report.posts += 1;
        }
        const comments = await kvGetJSON(env, `post:${ids[i]}:comments`, []);
        let touched = false;
        for (const c of comments) {
          const h = handles.get(c.author);
          if (h && h !== c.author) { c.author = h; touched = true; }
        }
        if (touched) {
          await kvPutJSON(env, `post:${ids[i]}:comments`, comments);
          report.comments += 1;
        }
      }

      /* 关注/粉丝列表（键按 SID，值改成 PID） */
      for (const [email, handle] of handles) {
        for (const kind of ["following", "followers"]) {
          const list = await kvGetJSON(env, `${kind}:${email}`, []);
          if (!list.length) continue;
          const mapped = list.map((v) => handles.get(v) || v);
          if (JSON.stringify(mapped) !== JSON.stringify(list)) {
            await kvPutJSON(env, `${kind}:${email}`, mapped);
            report.follows += 1;
          }
        }
      }
      return json(request, { ok: true, ...report });
    }

    return json(request, { error: "not found" }, 404);
  },

  /** 定时任务：每天两次（UTC 02:00 / 12:00 = 北京时间 10:00 / 20:00）随机推荐一个社区产品 */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(suggestWithDailyQuota(env).catch(() => {}));
  },
};
