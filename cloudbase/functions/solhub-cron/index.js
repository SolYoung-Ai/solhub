/**
 * SolHub 每日官方推荐 —— CloudBase Event Function（定时触发）
 * =====================================================
 *
 * 原来这件事是 Cloudflare Worker 的 cron 触发器做的（每天两次，随机推一个社区产品）。
 * 迁到 CloudBase 后 HTTP 函数不支持 timer 触发器，所以单独用这个 Event 函数承担。
 *
 * 与 Worker 的 scheduled() 完全同一份业务代码（core.cjs 里原封不动搬过来了），
 * 这里只做两件事：
 *   1. 把 Worker 的 env / ctx 协议补齐（env.PROFILES 指向 PG，ctx.waitUntil 收集任务）；
 *   2. 把 waitUntil 收集到的异步任务等完再返回 —— SCF 在函数返回后可能冻结容器，
 *      不等完的话推荐帖可能写到一半就被冻住。
 */

const { webcrypto } = require("node:crypto");
const core = require("./core.cjs");
const { createKV } = require("./kv.cjs");
const { installCaches } = require("./caches.cjs");

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

installCaches();

const env = { ...process.env, PROFILES: createKV() };

/** 收集 waitUntil 的异步任务，函数返回前统一等待完成 */
const pending = [];
const ctx = {
  waitUntil(promise) {
    try {
      pending.push(Promise.resolve(promise));
    } catch {
      /* ignore */
    }
  },
};

exports.main = async (event, context) => {
  const startedAt = Date.now();
  console.log(
    `[solhub-cron] 定时触发 type=${(event && event.Type) || "unknown"} at=${new Date().toISOString()}`,
  );
  try {
    await core.scheduled(event || {}, env, ctx);
    await Promise.all(pending);
    console.log(`[solhub-cron] 完成，耗时 ${Date.now() - startedAt}ms`);
    return { ok: true };
  } catch (err) {
    console.error("[solhub-cron] 执行失败:", err && err.stack ? err.stack : err);
    return { ok: false, error: String((err && err.message) || err) };
  }
};
