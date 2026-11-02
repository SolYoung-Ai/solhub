/**
 * Cloudflare Workers KV 兼容层 → CloudBase PostgreSQL
 * =====================================================
 *
 * 认证服务的全部状态（用户资料、密码凭据、会话、验证码、关注列表…）原先存在
 * Cloudflare KV 里。KV 有两个致命问题：
 *   1. 全球最终一致：写完数秒内其它节点可能读到旧值，验证码这种「读-改-写」逻辑
 *      会直接把注册流程卡死；
 *   2. 免费版每天只有 1,000 次写入，写额度被限流打满后全站不可写。
 *
 * 换成 PostgreSQL 后两个问题都不存在：单库强一致、写入额度充足。
 *
 * 本文件提供与 Workers KV 完全同形的 API（get / put / delete / list），
 * 上层业务代码（core.js）一行都不用改。
 *
 * 语义映射：
 *   KV get(key)                        → SELECT value WHERE key = ? AND 未过期
 *   KV put(key, value)                 → INSERT ... ON CONFLICT(key) DO UPDATE
 *   KV put(key, value, {expirationTtl})→ 同上，并写入 expires_at = now() + ttl
 *   KV delete(key)                     → DELETE WHERE key = ?
 *   KV list({prefix, limit, cursor})   → WHERE key >= prefix AND key < prefix+'\uffff'
 *
 * 注意两点与 CF KV 的差异，都是有意为之：
 *   1. 强一致。CF KV 的 {cacheTtl} 参数在这里被忽略（读到的永远是最新值）。
 *      这正是迁移要解决的问题 —— 原先 30~60 秒的最终一致窗口被彻底消除。
 *   2. list 的排序。CF KV 按 key 的 UTF-8 字节序排；PostgreSQL 的 text 排序受
 *      collation 影响。认证服务只用 list 做「按前缀扫描」用于搜索，不依赖跨前缀的
 *      全局顺序，因此改用 LIKE '前缀%' 取前缀区间 —— 它能命中 text_pattern_ops
 *      索引，且是字节序语义，不受 collation 干扰（范围比较 gte/lt 受影响，故不用）。
 */

const tcb = require("@cloudbase/node-sdk");

/* ------------------------------------------------------------------ 客户端 */

let clientPromise = null;

function client() {
  if (!clientPromise) {
    const env = process.env.TCB_ENV || process.env.CLOUDBASE_ENV || "";
    const accessKey = process.env.CLOUDBASE_APIKEY || "";
    if (!env) throw new Error("[kv] 缺少环境 ID（TCB_ENV）");
    if (!accessKey) throw new Error("[kv] 缺少 API Key（CLOUDBASE_APIKEY）");
    const app = tcb.init({ env, accessKey });
    clientPromise = Promise.resolve(app.rdb());
  }
  return clientPromise;
}

/** 统一把 SDK 返回体里的 error 转成异常 */
function unwrap(res, what) {
  if (res && res.error) {
    const detail = res.error.message || res.error.code || "unknown error";
    const err = new Error(`[kv] ${what} 失败：${detail}`);
    err.cause = res.error;
    throw err;
  }
  return res;
}

/** 过期判定：expires_at 非空且已到期即视为不存在 */
function isExpired(row) {
  if (!row || !row.expires_at) return false;
  const t = new Date(row.expires_at).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

/** 未过期条件（postgREST 的 or 语法），用 UTC ISO 串避免 URL 里的 `+` 被解成空格 */
function notExpiredFilter() {
  return `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`;
}

/* --------------------------------------------------------------- 单键读写 */

async function rawGet(key) {
  const db = await client();
  const res = await db
    .from("kv")
    .select("value,expires_at")
    .eq("key", key)
    .or(notExpiredFilter());
  unwrap(res, `get ${key}`);
  const row = res.data && res.data[0];
  if (!row || isExpired(row)) return null;
  return row.value;
}

async function rawGetMany(keys) {
  const db = await client();
  const res = await db
    .from("kv")
    .select("key,value,expires_at")
    .in("key", keys)
    .or(notExpiredFilter());
  unwrap(res, `getMany(${keys.length})`);
  const map = new Map();
  for (const row of res.data || []) map.set(row.key, row);
  return map;
}

/* ----------------------------------------------------------- 读批量（微批） */

/*
 * Worker 里有一处「一次并发读 40 个键」的模式（搜索用户时批量拉 user:* / profile:*）。
 * 逐个发 40 次 HTTP 请求没必要，这里在同一个微任务批次里把它们合并成一次
 * IN 查询。合并失败自动退回逐个读，任何情况下都不会因为批处理而丢数据。
 */

/** 可以安全放进 postgREST IN 过滤器的 key 字符集（避开 , ( ) % + / = 等敏感字符） */
const SAFE_KEY = /^[A-Za-z0-9_.:@\-]{1,180}$/;

let pending = [];
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    void flush();
  });
}

async function flush() {
  const batch = pending;
  pending = [];
  if (!batch.length) return;

  const safe = [];
  const unsafe = [];
  for (const item of batch) {
    (SAFE_KEY.test(item.key) ? safe : unsafe).push(item);
  }

  for (let i = 0; i < safe.length; i += 100) {
    const chunk = safe.slice(i, i + 100);
    let map = null;
    try {
      map = chunk.length === 1 ? null : await rawGetMany(chunk.map((c) => c.key));
    } catch {
      /* 批量失败退回逐个读 */
      map = null;
    }
    for (const item of chunk) {
      try {
        if (map) {
          const row = map.get(item.key);
          item.resolve(row && !isExpired(row) ? row.value : null);
        } else {
          item.resolve(await rawGet(item.key));
        }
      } catch (err) {
        item.reject(err);
      }
    }
  }

  for (const item of unsafe) {
    try {
      item.resolve(await rawGet(item.key));
    } catch (err) {
      item.reject(err);
    }
  }
}

/* ------------------------------------------------------------- 对外 KV API */

function createKV() {
  return {
    /**
     * 读一个键。兼容 Workers KV 签名 get(key, { cacheTtl }) —— cacheTtl 在这里
     * 被忽略：PostgreSQL 强一致，没有「边缘缓存旧值」这回事。
     */
    async get(key) {
      return new Promise((resolve, reject) => {
        pending.push({ key, resolve, reject });
        scheduleFlush();
      });
    },

    /**
     * 写一个键。兼容 Workers KV 签名 put(key, value, { expirationTtl | expiration })。
     * expirationTtl 是「从现在起多少秒后过期」，与 CF KV 一致。
     */
    async put(key, value, opts = {}) {
      const db = await client();
      const ttl = Number(opts && opts.expirationTtl) || 0;
      const abs = Number(opts && opts.expiration) || 0;
      let expiresAt = null;
      if (ttl > 0) expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      else if (abs > 0) expiresAt = new Date(abs * 1000).toISOString();

      const res = await db
        .from("kv")
        .upsert(
          {
            key: String(key),
            value: String(value),
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" },
        );
      unwrap(res, `put ${key}`);
    },

    /** 删一个键 */
    async delete(key) {
      const db = await client();
      const res = await db.from("kv").delete().eq("key", key);
      unwrap(res, `delete ${key}`);
    },

    /**
     * 列出某个前缀下的键。返回 { keys: [{ name }], list_complete, cursor }，
     * 与 Workers KV 的形状一致。cursor 用「上一页最后一个 key」表示，
     * 配合范围扫描可以稳定翻页。
     */
    async list(opts = {}) {
      const db = await client();
      const prefix = String((opts && opts.prefix) || "");
      const limit = Math.max(1, Math.min(1000, Number(opts && opts.limit) || 1000));
      const cursor = opts && opts.cursor ? String(opts.cursor) : "";

      /* postgREST 的 like 用 * 当通配符（转成 SQL 的 %）。前缀里的 _ 与 %
         要转义成字面量，否则会把 user_x: 也算进 user: 前缀里。 */
      const pattern = `${prefix.replace(/([_%])/g, "\\$1")}*`;

      let q = db.from("kv").select("key");
      if (prefix) q = q.like("key", pattern);
      if (cursor) q = q.gt("key", cursor);
      q = q.or(notExpiredFilter()).order("key", { ascending: true }).limit(limit + 1);

      const res = await q;
      unwrap(res, `list ${prefix}`);
      const rows = res.data || [];
      const more = rows.length > limit;
      const page = more ? rows.slice(0, limit) : rows;
      const out = { keys: page.map((r) => ({ name: r.key })), list_complete: !more };
      if (more && page.length) out.cursor = page[page.length - 1].key;
      return out;
    },
  };
}

module.exports = { createKV };
