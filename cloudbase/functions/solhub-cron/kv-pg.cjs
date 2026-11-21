/*
 * ⚠️ 本文件由 scripts/sync-cloudbase-fn.mjs 从 cloudbase/functions/solhub-auth/ 复制，
 *    请勿直接编辑；改存储层请改 solhub-auth/ 下的源文件再执行同步脚本。
 */
/**
 * Cloudflare Workers KV 兼容层 → CloudBase PostgreSQL
 * =====================================================
 *
 * 【驱动之一】本文件是 PostgreSQL 驱动（`KV_DRIVER=pg`，默认值），由 kv.cjs
 * 统一选择后导出。换存储引擎时只换驱动文件，业务代码（core.cjs）一行不改。
 *
 * 为什么会有两个驱动：PostgreSQL 实例是「按 0.2 核常驻」计费的，哪怕一天没
 * 有请求也在扣资源点（一个月约 4.9 万点），而全站状态只有 0.4MB。文档型
 * 数据库按调用次数计费、不常驻 CPU，同样的数据一个月只要一两千点。
 * `KV_DRIVER=nosql` 切到 kv-nosql.cjs 即可，见 cloudbase/README-kv-driver.md。
 *
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

/* ==================================================================
 * 表级操作（备份 / 恢复 / 过期清理用）
 * ------------------------------------------------------------------
 * 上面的 createKV() 只有「单键 CRUD + 前缀扫描」，够业务用；但备份任务要
 * 全量导出、按天写快照、按天删快照，这些是表级动作，KV 接口表达不了。
 *
 * 之所以把它们也放进驱动里、由 kv.cjs 统一分发，是为了让 backup.cjs 只写
 * 一遍流程：换库（PG → 文档型）时不用改备份逻辑，也不会漏掉某个分支。
 * ================================================================== */

/** 单页行数：postgREST 单次返回有条数上限，分页拉全量 */
const PAGE = 500;
/** 单表行数硬上限，防止异常膨胀把函数打挂 */
const MAX_ROWS = 20000;
/** 写库时每批条数 */
const CHUNK = 100;
/** kv 表的列 */
const KV_COLS = "key,value,expires_at,updated_at";

/** 按主键翻页导出全表。不用 offset 翻页 —— 导出期间有写入时 offset 会漏行 */
async function dumpAll({ page = PAGE, maxRows = MAX_ROWS } = {}) {
  const db = await client();
  const rows = [];
  let cursor = "";
  for (let i = 0; i < Math.ceil(maxRows / page) + 2; i += 1) {
    let q = db.from("kv").select(KV_COLS).order("key", { ascending: true }).limit(page);
    if (cursor) q = q.gt("key", cursor);
    const res = unwrap(await q, `导出 kv（第 ${i + 1} 页）`);
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < page) break;
    cursor = batch[batch.length - 1].key;
    if (rows.length >= maxRows) {
      console.warn(`[kv-pg] kv 行数达到上限 ${maxRows}，后续行未导出`);
      break;
    }
  }
  return rows;
}

/**
 * 写入某一天的快照。先删当天再批量插入 —— 等价于幂等 upsert，
 * 但不用赌 postgREST 多列 on_conflict 的写法，同一天反复跑结果一致。
 */
async function writeSnapshot(takenOn, rows) {
  const db = await client();
  unwrap(await db.from("kv_backup").delete().eq("taken_on", takenOn), "清理当天旧快照");

  const takenAt = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      taken_on: takenOn,
      key: r.key,
      value: r.value,
      expires_at: r.expires_at || null,
      taken_at: takenAt,
    }));
    unwrap(await db.from("kv_backup").insert(chunk), `写入快照第 ${i / CHUNK + 1} 批`);
    written += chunk.length;
  }
  return written;
}

/** 读出某一天的快照（按 key 翻页） */
async function readSnapshot(takenOn, { page = PAGE, maxRows = MAX_ROWS } = {}) {
  const db = await client();
  const rows = [];
  let cursor = "";
  for (let i = 0; i < Math.ceil(maxRows / page) + 2; i += 1) {
    let q = db
      .from("kv_backup")
      .select("key,value,expires_at")
      .eq("taken_on", takenOn)
      .order("key", { ascending: true })
      .limit(page);
    if (cursor) q = q.gt("key", cursor);
    const res = unwrap(await q, `读取快照 ${takenOn}（第 ${i + 1} 页）`);
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < page) break;
    cursor = batch[batch.length - 1].key;
  }
  return rows;
}

/** 清理超出保留期的旧快照，返回截止日期 */
async function pruneSnapshots(cutoff) {
  const db = await client();
  unwrap(await db.from("kv_backup").delete().lt("taken_on", cutoff), "清理过期快照");
  return cutoff;
}

/** 批量覆盖写入（恢复用） */
async function upsertMany(rows) {
  const db = await client();
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      key: r.key,
      value: r.value,
      expires_at: r.expires_at || null,
      updated_at: new Date().toISOString(),
    }));
    unwrap(await db.from("kv").upsert(chunk, { onConflict: "key" }), `恢复第 ${i / CHUNK + 1} 批`);
    written += chunk.length;
  }
  return written;
}

/** 批量删除（清理过期键用） */
async function deleteMany(keys) {
  const db = await client();
  let deleted = 0;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    try {
      unwrap(await db.from("kv").delete().in("key", chunk), `删除第 ${i / CHUNK + 1} 批`);
      deleted += chunk.length;
    } catch (err) {
      /* 批量删失败就退回逐个删，宁可慢也不能留一半 */
      console.warn(`[kv-pg] 批量删除失败，退回逐个删除：${err && err.message}`);
      for (const k of chunk) {
        unwrap(await db.from("kv").delete().eq("key", k), `删除 ${k}`);
        deleted += 1;
      }
    }
  }
  return deleted;
}

/** 扫描已过期的键（不含业务数据：业务键 expires_at 为 NULL） */
async function scanExpired({ max = 5000, page = PAGE } = {}) {
  const db = await client();
  const nowIso = new Date().toISOString();
  const rows = [];
  let cursor = "";
  for (let i = 0; i < Math.ceil(max / page) + 2; i += 1) {
    let q = db
      .from("kv")
      .select("key,expires_at")
      .lt("expires_at", nowIso)
      .order("key", { ascending: true })
      .limit(page);
    if (cursor) q = q.gt("key", cursor);
    const res = unwrap(await q, `扫描过期键（第 ${i + 1} 页）`);
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < page || rows.length >= max) break;
    cursor = batch[batch.length - 1].key;
  }
  return rows;
}

async function putMeta(key, obj) {
  const db = await client();
  unwrap(
    await db.from("kv").upsert(
      { key, value: JSON.stringify(obj), expires_at: null, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    ),
    `写 ${key}`,
  );
}

async function getMeta(key) {
  const db = await client();
  const res = unwrap(await db.from("kv").select("value").eq("key", key), `读 ${key}`);
  const row = res.data && res.data[0];
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

function createStore() {
  return {
    driver: "pg",
    dumpAll,
    writeSnapshot,
    readSnapshot,
    pruneSnapshots,
    upsertMany,
    deleteMany,
    scanExpired,
    putMeta,
    getMeta,
  };
}

module.exports = { createKV, createStore };
