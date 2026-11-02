/**
 * Workers Cache API 兼容层（进程内实现）
 * ==========================================
 *
 * 认证服务用 Cache API 做限流计数（登录失败次数、发码次数）。
 * 之所以不用 KV：KV 免费版每天只有 1,000 次写入，一次暴力破解就能把写入额度
 * 烧光，变成自我 DoS。
 *
 * 为什么不继续用 Cloudflare 的 Cache API：
 *   1. 它是「机房本地」的 —— 同一请求序列落在不同 colo 时计数各算各的，限流静默失效；
 *   2. 实测边缘读/写延迟极不稳定（曾出现 18s+ 卡死），直接导致 /me、登录等
 *      接口间歇超时，前端报「网络错误」。
 *
 * 迁移到 CloudBase 后改用进程内 Map：
 *   - 延迟是微秒级，不会再有卡死；
 *   - 同一实例内计数一致，限流比原来更准。
 *
 * 已知限制：实例可能被回收，计数随之清零。限流本来就是「尽力而为」的粗粒度
 * 防线（真正的硬防线在阿里云控制台的日发送量上限），这与 Cloudflare 时代
 * 「跨机房各算各的」的语义相比反而更严格。
 */

/** @type {Map<string, { body: string, status: number, headers: Record<string,string>, expiresAt: number }>} */
const store = new Map();

function keyOf(url) {
  if (typeof url === "string") return url;
  if (url && typeof url.url === "string") return url.url;
  return String(url);
}

/** 从 Cache-Control 里取 max-age，缺省 60 秒 */
function ttlOf(response) {
  const cc = (response.headers && response.headers.get("cache-control")) || "";
  const m = /max-age=(\d+)/.exec(cc);
  return m ? Number(m[1]) : 60;
}

const defaultCache = {
  /** 命中返回一个新的 Response（body 可重复读），未命中返回 undefined */
  async match(url) {
    const k = keyOf(url);
    const hit = store.get(k);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      store.delete(k);
      return undefined;
    }
    return new Response(hit.body, { status: hit.status, headers: hit.headers });
  },

  /** 写入缓存（响应体在此处被读掉，之后 match 返回的是副本） */
  async put(url, response) {
    const k = keyOf(url);
    const body = await response.text();
    const headers = {};
    for (const [hk, hv] of response.headers) headers[hk] = hv;
    store.set(k, {
      body,
      status: response.status,
      headers,
      expiresAt: Date.now() + ttlOf(response) * 1000,
    });
  },

  /** 删除缓存条目 */
  async delete(url) {
    return store.delete(keyOf(url));
  },
};

/** 定期清掉过期条目，避免长驻实例的内存无限增长 */
function startJanitor() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k);
    }
  }, 60_000);
  if (typeof timer.unref === "function") timer.unref();
}

/** 把 caches.default 挂到全局，供 core（Worker 业务代码）直接调用 */
function installCaches() {
  if (!globalThis.caches || typeof globalThis.caches !== "object") globalThis.caches = {};
  globalThis.caches.default = defaultCache;
  startJanitor();
  return globalThis.caches;
}

module.exports = { installCaches };
