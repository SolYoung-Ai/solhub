/**
 * SolHub 认证服务 —— CloudBase HTTP Function 适配层
 * ===================================================
 *
 * 业务逻辑原封不动地放在 core.cjs（与 Cloudflare Worker 共用同一份源码），
 * 本文件只负责把「Cloudflare Workers 的 fetch(request, env, ctx)」协议
 * 翻译成「Node 原生 http 服务」，以及反过来。
 *
 * 为什么需要这一层：
 *   - Cloudflare Worker 跑在 workerd 沙箱里，入口是 export default { fetch }；
 *     CloudBase HTTP Function 跑在标准 Node 里，入口是一个监听 9000 端口的 http 服务。
 *   - Worker 的 KV（env.PROFILES）换成 PostgreSQL 实现（见 kv.cjs），
 *     Worker 的 Cache API（caches.default）换成进程内实现（见 caches.cjs）。
 *   - 业务代码本身（core.cjs）一行都不用改。
 *
 * CORS 归属（重要）：
 *   本函数挂在 CloudBase HTTP 网关上。网关的「跨域设置」若开启，会按环境的安全
 *   域名白名单自动补 Access-Control-Allow-Origin；但本环境是体验版套餐，加不了
 *   自定义安全域名，所以网关那条路走不通 —— 路由上关掉跨域校验（enableSafeDomain
 *   =false），由函数自己发 CORS 头（CORS_MODE=self）。
 *   Worker 代码里的 corsFor() 本来就会按 Origin 白名单回显具体来源并带上
 *   Allow-Credentials，语义与原来完全一致。
 *   若将来把环境升级成可配置安全域名的套餐，可把 CORS_MODE 改回 gateway，
 *   由网关统一注入，函数这边自动剥掉 CORS 头（避免出现 "<origin>,*" 这种非法值）。
 *
 * 定时任务：
 *   定时推荐由独立的 Event 函数 solhub-cron 承担（HTTP 函数不支持 timer 触发器），
 *   这里只保留识别逻辑以防万一收到定时事件 POST。
 */

const http = require("node:http");
const { URL } = require("node:url");
const { webcrypto } = require("node:crypto");
const core = require("./core.cjs");
const { createKV } = require("./kv.cjs");
const { installCaches } = require("./caches.cjs");

/* core 里的密码哈希用了 WebCrypto（PBKDF2-SHA256），Node 18 的全局 crypto
   在个别小版本上不完整，这里用 node:crypto 的 webcrypto 兜底。 */
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

installCaches();

const PORT = Number(process.env.PORT || 9000);
/** 网关把函数挂在某个路径前缀下，这里剥掉前缀，让 core 看到的仍是 /me、/auth/... */
const MOUNT = String(process.env.MOUNT_PATH || "/api").replace(/\/+$/, "");
/** gateway = 交给网关处理 CORS；self = 函数自己设 CORS（本环境实际用法） */
const CORS_MODE = String(process.env.CORS_MODE || "gateway");

const CORS_HEADERS = new Set([
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "access-control-max-age",
]);

const kv = createKV();

/** Worker 的 env：所有环境变量 + PROFILES 绑定 */
const env = { ...process.env, PROFILES: kv };

/** Worker 的 ctx：waitUntil 只是「别等我」的语义，这里直接吞掉异常即可 */
const ctx = {
  waitUntil(promise) {
    try {
      Promise.resolve(promise).catch(() => {});
    } catch {
      /* ignore */
    }
  },
};

/* ------------------------------------------------------------ 请求体读取 */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* ------------------------------------------------------- Node → Web Request */

function buildHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(nodeHeaders || {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else {
      headers.set(k, String(v));
    }
  }
  return headers;
}

function fullUrl(req, url, pathname) {
  const proto = req.headers["x-forwarded-proto"] || (req.socket && req.socket.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "127.0.0.1";
  return new URL(`${pathname}${url.search}`, `${proto}://${host}`).toString();
}

function stripMount(pathname) {
  if (!MOUNT) return pathname;
  if (pathname === MOUNT) return "/";
  if (pathname.startsWith(`${MOUNT}/`)) return pathname.slice(MOUNT.length);
  return pathname;
}

/* --------------------------------------------------- Web Response → Node res */

function setCookiesOf(headers) {
  if (typeof headers.getSetCookie === "function") {
    const list = headers.getSetCookie();
    if (list && list.length) return list;
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

async function writeResponse(res, response) {
  const headers = {};
  const cookies = setCookiesOf(response.headers);
  for (const [k, v] of response.headers) {
    const lk = k.toLowerCase();
    if (lk === "set-cookie") continue;
    if (CORS_MODE === "gateway" && CORS_HEADERS.has(lk)) continue;
    headers[k] = v;
  }
  if (cookies.length) headers["set-cookie"] = cookies;

  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  res.writeHead(response.status, headers);
  if (body && body.length) res.end(body);
  else res.end();
}

/* ------------------------------------------------------------ 定时事件识别 */

function parseTimerEvent(buf) {
  if (!buf || !buf.length) return null;
  let parsed;
  try {
    parsed = JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.Type === "Timer" || parsed.TriggerName || parsed.TriggerTime) return parsed;
  return null;
}

/* ------------------------------------------------------------------ 服务 */

const server = http.createServer(async (req, res) => {
  try {
    const rawUrl = req.url || "/";
    const url = new URL(rawUrl, "http://127.0.0.1");
    const method = (req.method || "GET").toUpperCase();
    const pathname = stripMount(url.pathname);

    const bodyBuf =
      method === "GET" || method === "HEAD" ? Buffer.alloc(0) : await readBody(req);

    const timerEvent = parseTimerEvent(bodyBuf);

    const request = new Request(fullUrl(req, url, pathname), {
      method,
      headers: buildHeaders(req.headers),
      body: method === "GET" || method === "HEAD" ? undefined : bodyBuf,
    });

    /* 定时触发器：转交 Worker 的 scheduled handler（正式 cron 走 solhub-cron） */
    if (timerEvent) {
      await core.scheduled(timerEvent, env, ctx);
      res.writeHead(204, { "Content-Type": "application/json" });
      res.end();
      return;
    }

    const response = await core.fetch(request, env, ctx);
    await writeResponse(res, response);
  } catch (err) {
    console.error("[solhub-auth] 处理失败:", err && err.stack ? err.stack : err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`[solhub-auth] listening on :${PORT} (mount=${MOUNT || "/"}, cors=${CORS_MODE})`);
});
