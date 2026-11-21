/**
 * Cloudflare Workers KV 兼容层 → CloudBase 文档型数据库（NoSQL）
 * ==============================================================
 *
 * 【驱动之二】`KV_DRIVER=nosql` 时由 kv.cjs 选中。API 与 kv-pg.cjs 完全同形，
 * 业务代码（core.cjs）与备份流程（backup.cjs）都不需要知道底层是哪种库。
 *
 * 为什么要这个驱动：
 *   PostgreSQL 实例按「0.2 核常驻」计费，一个月约 4.9 万点，而全站状态只有
 *   0.4MB、一天几千次读写。文档型数据库按调用次数计费（200 点/万次）、
 *   容量几乎为零，同样的负载一个月只要一两千点。
 *
 * 语义映射（与 Workers KV 对齐）：
 *   get(key)                          → doc(enc(key)).get()，过期视为不存在
 *   put(key, value, {expirationTtl})  → doc(enc(key)).set({...})，写 expires_at
 *   delete(key)                       → doc(enc(key)).remove()
 *   list({prefix, limit, cursor})     → key 字段范围扫描（gte prefix, lt prefix+\uffff）
 *
 * 三处与 CF KV 的差异，都是有意为之：
 *   1. 强一致：文档库读写都走主库，不存在 CF KV 那种「写完几秒读到旧值」的窗口。
 *      验证码「码即键」的设计因此更安全，不需要额外补偿。
 *   2. 文档 _id 不直接用原始 key：key 里常有 `:` `@` `/` `.`，各引擎对 _id 的
 *      字符限制不一致。这里统一 base64url 编码，原始 key 另存 `key` 字段并建索引。
 *   3. list 用「key 字段范围扫描」而不是正则：范围比较走索引、按字节序，
 *      不受 collation 干扰，也不会出现正则把 `user_x:` 误算进 `user:` 前缀。
 *
 * 索引（首次部署建议在控制台建，不建也能跑，只是全表扫）：
 *   kv:        key 升序
 *   kv_backup: taken_on 升序 + key 升序（复合）
 */

const tcb = require("@cloudbase/node-sdk");

/** 业务键集合 */
const COLLECTION = process.env.KV_COLLECTION || "kv";
/** 每日快照集合（备份用，与 PG 版的 kv_backup 表对应） */
const SNAPSHOT_COLLECTION = process.env.KV_SNAPSHOT_COLLECTION || "kv_backup";

/** 单次查询上限（文档库服务端单次 get 上限 1000） */
const QUERY_LIMIT = 1000;
/** 单页处理条数 */
const PAGE = 500;
/** 单表行数硬上限，防止异常膨胀把函数打挂 */
const MAX_ROWS = 20000;
/** 写库时每批条数（并发池大小） */
const CHUNK = 100;
/** 并发写入度：过高会触发文档库的 QPS 保护 */
const CONCURRENCY = 8;

/* ------------------------------------------------------------------ 客户端 */

let dbPromise = null;
let readyPromise = null;

function client() {
  if (!dbPromise) {
    const env = process.env.TCB_ENV || process.env.CLOUDBASE_ENV || "";
    const accessKey = process.env.CLOUDBASE_APIKEY || "";
    if (!env) throw new Error("[kv-nosql] 缺少环境 ID（TCB_ENV）");
    if (!accessKey) throw new Error("[kv-nosql] 缺少 API Key（CLOUDBASE_APIKEY）");
    const app = tcb.init({ env, accessKey });
    dbPromise = Promise.resolve(app.database());
  }
  return dbPromise;
}

/** 集合不存在时创建；已存在（或并发创建）忽略。只跑一次。 */
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const db = await client();
      for (const name of [COLLECTION, SNAPSHOT_COLLECTION]) {
        try {
          await db.createCollection(name);
        } catch (err) {
          /* 已存在、或环境不允许建集合：后续读写会给出更具体的错误，这里不拦 */
          const msg = String((err && (err.message || err.code)) || "");
          if (!/exist|Exist|ALREADY|DATABASE_COLLECTION_EXIST/i.test(msg)) {
            console.warn(`[kv-nosql] createCollection(${name}) 跳过：${msg}`);
          }
        }
      }
      return true;
    })();
  }
  return readyPromise;
}

/** 统一把 SDK 返回体里的 error 转成异常 */
function unwrap(res, what) {
  if (res && res.error) {
    const detail = res.error.message || res.error.code || "unknown error";
    const err = new Error(`[kv-nosql] ${what} 失败：${detail}`);
    err.cause = res.error;
    throw err;
  }
  return res;
}

/* ----------------------------------------------------------------- 工具 */

/** 原始 key → 文档 _id。base64url 只含 A-Za-z0-9-_，不会撞引擎的字符限制 */
function encId(key) {
  return "k" + Buffer.from(String(key), "utf8").toString("base64url");
}

function encSnapshotId(takenOn, key) {
  return "s" + Buffer.from(`${takenOn}\u0000${key}`, "utf8").toString("base64url");
}

/** 过期判定：expires_at 非空且已到期即视为不存在 */
function isExpired(doc) {
  if (!doc || !doc.expires_at) return false;
  const t = new Date(doc.expires_at).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

/** 从 get() 的返回里取出单条文档：不同版本可能给对象或数组 */
function pickOne(res) {
  const data = res && res.data;
  if (!data) return null;
  if (Array.isArray(data)) return data[0] || null;
  return data;
}

/** 有限并发地跑一批任务，任何一条失败都抛出（备份不能半截成功） */
async function pool(items, worker, concurrency = CONCURRENCY) {
  const list = Array.from(items);
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, list.length || 1) }, async () => {
    while (idx < list.length) {
      const i = idx;
      idx += 1;
      await worker(list[i], i);
    }
  });
  await Promise.all(runners);
}

/** 前缀的字典序上界：用 \uffff 作哨兵，避开正则与 collation */
function prefixUpper(prefix) {
  return `${prefix}\uffff`;
}

/* --------------------------------------------------------------- 单键读写 */

async function rawGet(key) {
  await ready();
  const db = await client();
  const res = await db.collection(COLLECTION).doc(encId(key)).get();
  unwrap(res, `get ${key}`);
  const doc = pickOne(res);
  if (!doc || isExpired(doc)) return null;
  return doc.value;
}

async function rawGetMany(keys) {
  await ready();
  const db = await client();
  const _ = db.command;
  const res = await db
    .collection(COLLECTION)
    .where({ _id: _.in(keys.map(encId)) })
    .limit(Math.min(QUERY_LIMIT, keys.length))
    .get();
  unwrap(res, `getMany(${keys.length})`);
  const map = new Map();
  for (const doc of res.data || []) map.set(doc.key, doc);
  return map;
}

/* ----------------------------------------------------------- 读批量（微批） */

/*
 * 与 PG 驱动完全一致的合并策略：同一微任务批次里的一次性并发读合并成一次
 * IN 查询。合并失败自动退回逐个读，任何情况下都不会因为批处理而丢数据。
 */

const SAFE_KEY = /^[A-Za-z0-9_.:@\-]{1,180}$/;

let pendingReads = [];
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
  const batch = pendingReads;
  pendingReads = [];
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
      map = null;
    }
    for (const item of chunk) {
      try {
        if (map) {
          const doc = map.get(item.key);
          item.resolve(doc && !isExpired(doc) ? doc.value : null);
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
     * 被忽略：文档库是强一致读写，没有「边缘缓存旧值」这回事。
     */
    async get(key) {
      return new Promise((resolve, reject) => {
        pendingReads.push({ key, resolve, reject });
        scheduleFlush();
      });
    },

    /** 写一个键。兼容 put(key, value, { expirationTtl | expiration }) */
    async put(key, value, opts = {}) {
      const ttl = Number(opts && opts.expirationTtl) || 0;
      const abs = Number(opts && opts.expiration) || 0;
      let expiresAt = null;
      if (ttl > 0) expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      else if (abs > 0) expiresAt = new Date(abs * 1000).toISOString();

      await ready();
      const db = await client();
      const res = await db
        .collection(COLLECTION)
        .doc(encId(key))
        .set({
          key: String(key),
          value: String(value),
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        });
      unwrap(res, `put ${key}`);
    },

    /** 删一个键 */
    async delete(key) {
      await ready();
      const db = await client();
      const res = await db.collection(COLLECTION).doc(encId(key)).remove();
      unwrap(res, `delete ${key}`);
    },

    /**
     * 列出某个前缀下的键。返回 { keys: [{ name }], list_complete, cursor }，
     * 与 Workers KV 的形状一致。cursor 用「上一页最后一个 key」表示。
     */
    async list(opts = {}) {
      await ready();
      const db = await client();
      const _ = db.command;
      const prefix = String((opts && opts.prefix) || "");
      const limit = Math.max(1, Math.min(QUERY_LIMIT - 1, Number(opts && opts.limit) || QUERY_LIMIT - 1));
      const cursor = opts && opts.cursor ? String(opts.cursor) : "";

      let cond = null;
      if (prefix) cond = _.gte(prefix).and(_.lt(prefixUpper(prefix)));
      if (cursor) cond = cond ? cond.and(_.gt(cursor)) : _.gt(cursor);

      let q = db.collection(COLLECTION);
      if (cond) q = q.where({ key: cond });
      const res = await q.orderBy("key", "asc").limit(limit + 1).get();
      unwrap(res, `list ${prefix}`);

      const rows = (res.data || []).filter((doc) => doc && doc.key && !isExpired(doc));
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
 * 与 kv-pg.cjs 的 createStore() 同形，backup.cjs 只写一遍流程。
 * 快照落在同库的 kv_backup 集合里：一条键一天一个文档，
 * 文档 _id = base64url(takenOn + NUL + key)，天然幂等，重复跑只会覆盖。
 * ================================================================== */

/** 扫描集合里符合条件的文档（按 key 升序翻页），最多 maxRows 条 */
async function scan(collection, where, { page = PAGE, maxRows = MAX_ROWS, sortKey = "key" } = {}) {
  await ready();
  const db = await client();
  const rows = [];
  for (let i = 0; i * page < maxRows; i += 1) {
    const res = await db
      .collection(collection)
      .where(where || {})
      .orderBy(sortKey, "asc")
      .skip(i * page)
      .limit(Math.min(page, QUERY_LIMIT))
      .get();
    unwrap(res, `扫描 ${collection}（第 ${i + 1} 页）`);
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < page || rows.length >= maxRows) break;
  }
  return rows;
}

/** 全量导出（备份用）：跳过已过期键？不跳过 —— 备份要能还原成原样 */
async function dumpAll({ maxRows = MAX_ROWS } = {}) {
  const rows = await scan(COLLECTION, {}, { maxRows });
  return rows.map((doc) => ({
    key: doc.key,
    value: doc.value,
    expires_at: doc.expires_at || null,
  }));
}

/** 删掉某天的旧快照（幂等：同一天反复跑只会留一份） */
async function clearSnapshot(takenOn) {
  await ready();
  const db = await client();
  const res = await db.collection(SNAPSHOT_COLLECTION).where({ taken_on: takenOn }).remove();
  unwrap(res, `清理当天旧快照 ${takenOn}`);
}

/** 写入某一天的快照，返回真正写进去的条数 */
async function writeSnapshot(takenOn, rows) {
  await ready();
  const db = await client();
  await clearSnapshot(takenOn);

  const takenAt = new Date().toISOString();
  let written = 0;
  await pool(rows, async (r) => {
    const res = await db
      .collection(SNAPSHOT_COLLECTION)
      .doc(encSnapshotId(takenOn, r.key))
      .set({
        taken_on: takenOn,
        key: r.key,
        value: r.value,
        expires_at: r.expires_at || null,
        taken_at: takenAt,
      });
    unwrap(res, `写入快照 ${r.key}`);
    written += 1;
  });
  return written;
}

/** 读出某一天的快照 */
async function readSnapshot(takenOn, { maxRows = MAX_ROWS } = {}) {
  const rows = await scan(SNAPSHOT_COLLECTION, { taken_on: takenOn }, { maxRows });
  return rows.map((doc) => ({
    key: doc.key,
    value: doc.value,
    expires_at: doc.expires_at || null,
  }));
}

/** 清理超出保留期的旧快照，返回截止日期 */
async function pruneSnapshots(cutoff) {
  await ready();
  const db = await client();
  const _ = db.command;
  const res = await db
    .collection(SNAPSHOT_COLLECTION)
    .where({ taken_on: _.lt(cutoff) })
    .remove();
  unwrap(res, "清理过期快照");
  return cutoff;
}

/** 批量覆盖写入（恢复用） */
async function upsertMany(rows) {
  await ready();
  const db = await client();
  let written = 0;
  await pool(rows, async (r) => {
    const res = await db
      .collection(COLLECTION)
      .doc(encId(r.key))
      .set({
        key: r.key,
        value: r.value,
        expires_at: r.expires_at || null,
        updated_at: new Date().toISOString(),
      });
    unwrap(res, `恢复 ${r.key}`);
    written += 1;
  });
  return written;
}

/** 批量删除（清理过期键用） */
async function deleteMany(keys) {
  await ready();
  const db = await client();
  let deleted = 0;
  await pool(keys, async (k) => {
    const res = await db.collection(COLLECTION).doc(encId(k)).remove();
    unwrap(res, `删除 ${k}`);
    deleted += 1;
  });
  return deleted;
}

/**
 * 扫描已过期的键。业务数据的 expires_at 为空，永远不会出现在这里；
 * 只有会话、验证码、限流令牌这类带 TTL 的键。
 */
async function scanExpired({ max = 5000 } = {}) {
  await ready();
  const db = await client();
  const _ = db.command;
  const nowIso = new Date().toISOString();
  const rows = await scan(COLLECTION, { expires_at: _.lt(nowIso) }, { maxRows: max });

  /* 双保险：不只信数据库的字符串比较，再在 JS 里判一次绝对时间 */
  const nowMs = Date.now();
  return rows
    .filter((doc) => {
      if (!doc || !doc.expires_at) return false;
      const t = new Date(doc.expires_at).getTime();
      return Number.isFinite(t) && t <= nowMs;
    })
    .map((doc) => ({ key: doc.key, expires_at: doc.expires_at }));
}

async function putMeta(key, obj) {
  await ready();
  const db = await client();
  const res = await db.collection(COLLECTION).doc(encId(key)).set({
    key: String(key),
    value: JSON.stringify(obj),
    expires_at: null,
    updated_at: new Date().toISOString(),
  });
  unwrap(res, `写 ${key}`);
}

async function getMeta(key) {
  const raw = await rawGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createStore() {
  return {
    driver: "nosql",
    dumpAll,
    writeSnapshot,
    readSnapshot,
    pruneSnapshots,
    upsertMany,
    deleteMany,
    scanExpired,
    putMeta,
    getMeta,
    /* 导出这两个给运维脚本用（本地迁移工具按同样的编码写文档） */
    encId,
  };
}

module.exports = { createKV, createStore };
