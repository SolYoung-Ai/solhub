/**
 * SolHub 每日数据快照（逻辑备份）
 * =====================================================
 *
 * 背景：本环境是 CloudBase PostgreSQL 的**共享实例**（体验版套餐）。
 * 平台级「自动备份 / 时间点恢复」是独享实例才有的能力，控制台里没有备份入口；
 * 而云存储这条路在 PG 环境里也被封了（旧 COS SDK 返回 STORAGE_NOT_SUPPORTED，
 * pgstore 又还没进 node-sdk），所以备份落在数据库里，见 cloudbase/migrations/
 * 20261104020000_create_kv_backup.sql。
 *
 * 它兜住的是真正会发生的事故：
 *   - 误执行 DELETE / UPDATE（最常见）
 *   - 迁移脚本写错、代码缺陷把整批数据写坏
 *
 * 它兜不住：实例被销毁、环境被回收。要覆盖这一类风险，只能升级到独享实例用平台
 * 备份，或者定期把快照导一份到环境之外（见 runRestore 导出说明）。
 *
 * 粒度：一天一份，保留 30 天。当天补跑只覆盖当天那份，不会产生重复快照。
 */

const tcb = require("@cloudbase/node-sdk");

/** 保留天数 */
const KEEP_DAYS = 30;
/** 单页行数：postgREST 单次返回有条数上限，分页拉全量 */
const PAGE = 500;
/** 单表行数硬上限，防止异常膨胀把函数打挂（当前全站 57 行） */
const MAX_ROWS = 20000;
/** 写库时每批条数 */
const CHUNK = 100;
/** kv 表的列 */
const KV_COLS = "key,value,expires_at,updated_at";

let appPromise = null;

/** 数据库客户端：用环境级 API Key（与 kv.cjs 一致） */
function app() {
  if (!appPromise) {
    const env = process.env.TCB_ENV || process.env.CLOUDBASE_ENV || "";
    const accessKey = process.env.CLOUDBASE_APIKEY || "";
    if (!env) throw new Error("[backup] 缺少环境 ID（TCB_ENV）");
    if (!accessKey) throw new Error("[backup] 缺少 API Key（CLOUDBASE_APIKEY）");
    appPromise = Promise.resolve(tcb.init({ env, accessKey }));
  }
  return appPromise;
}

function unwrap(res, what) {
  if (res && res.error) {
    const detail = res.error.message || res.error.code || "unknown error";
    const err = new Error(`[backup] ${what} 失败：${detail}`);
    err.cause = res.error;
    throw err;
  }
  return res;
}

/** 北京时间日期 YYYY-MM-DD（按自然日命名，跨 UTC 边界不会被拆成两份） */
function bjDate(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ 导出 */

/** 按主键翻页导出全表。不用 offset 翻页 —— 导出期间有写入时 offset 会漏行 */
async function dumpKV(db) {
  const rows = [];
  let cursor = "";
  for (let i = 0; i < Math.ceil(MAX_ROWS / PAGE) + 2; i += 1) {
    let q = db.from("kv").select(KV_COLS).order("key", { ascending: true }).limit(PAGE);
    if (cursor) q = q.gt("key", cursor);
    const res = unwrap(await q, `导出 kv（第 ${i + 1} 页）`);
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    cursor = batch[batch.length - 1].key;
    if (rows.length >= MAX_ROWS) {
      console.warn(`[backup] kv 行数达到上限 ${MAX_ROWS}，后续行未导出`);
      break;
    }
  }
  return rows;
}

/* ------------------------------------------------------------- 快照读写 */

/**
 * 写入某一天的快照。先删当天再批量插入 —— 等价于幂等 upsert，
 * 但不用赌 postgREST 多列 on_conflict 的写法，同一天反复跑结果一致。
 */
async function saveSnapshot(db, takenOn, rows) {
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

/** 清理超出保留期的旧快照 */
async function pruneSnapshots(db) {
  const cutoff = bjDate(new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000));
  unwrap(await db.from("kv_backup").delete().lt("taken_on", cutoff), "清理过期快照");
  return cutoff;
}

/** 写一个 KV 元信息键（沿用 kv 表，备份本身不依赖它） */
async function putMeta(db, key, obj) {
  unwrap(
    await db.from("kv").upsert(
      { key, value: JSON.stringify(obj), expires_at: null, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    ),
    `写 ${key}`,
  );
}

async function getMeta(db, key) {
  const res = unwrap(await db.from("kv").select("value").eq("key", key), `读 ${key}`);
  const row = res.data && res.data[0];
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- 主流程 */

async function runBackup() {
  const startedAt = Date.now();
  const a = await app();
  const db = a.rdb();

  const takenOn = bjDate();
  const rows = await dumpKV(db);
  if (!rows.length) throw new Error("[backup] kv 表导出为空，这明显不对，已中止（不覆盖当天快照）");

  const rawBytes = rows.reduce((s, r) => s + String(r.value || "").length + String(r.key).length, 0);
  const written = await saveSnapshot(db, takenOn, rows);
  const cutoff = await pruneSnapshots(db);

  const prev = await getMeta(db, "backup:days");
  const days = Array.isArray(prev) ? prev.filter((d) => d !== takenOn) : [];
  days.push(takenOn);
  days.sort();
  const kept = days.slice(-KEEP_DAYS);

  await putMeta(db, "backup:days", kept);
  await putMeta(db, "backup:last", {
    takenOn,
    rows: written,
    rawBytes,
    at: new Date().toISOString(),
  });

  const summary = {
    ok: true,
    takenOn,
    rows: written,
    rawBytes,
    keepDays: KEEP_DAYS,
    prunedBefore: cutoff,
    snapshots: kept.length,
    ms: Date.now() - startedAt,
  };
  console.log(`[backup] 完成 ${JSON.stringify(summary)}`);
  return summary;
}

/* ----------------------------------------------------------------- 恢复 */

/** 读出某一天的快照（按 key 翻页） */
async function readSnapshot(db, takenOn) {
  const rows = [];
  let cursor = "";
  for (let i = 0; i < Math.ceil(MAX_ROWS / PAGE) + 2; i += 1) {
    let q = db
      .from("kv_backup")
      .select("key,value,expires_at")
      .eq("taken_on", takenOn)
      .order("key", { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt("key", cursor);
    const res = unwrap(await q, `读取快照 ${takenOn}（第 ${i + 1} 页）`);
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    cursor = batch[batch.length - 1].key;
  }
  return rows;
}

/**
 * 恢复。默认只做「补回」，不删多余键：
 *   - 快照里有的 key → 覆盖写入（回到快照时的状态）
 *   - 快照里没有、库里现在有的 key → 保留（避免把备份之后注册的新用户直接抹掉）
 * 需要「完全回滚到某天」时，先手动 DELETE 再恢复，属于人工决策，不放进自动化。
 */
async function runRestore({ takenOn, dryRun = true } = {}) {
  const a = await app();
  const db = a.rdb();

  let day = String(takenOn || "");
  if (!day) {
    const meta = await getMeta(db, "backup:days");
    if (!Array.isArray(meta) || !meta.length) {
      throw new Error("[restore] 还没有任何快照（backup:days 为空）");
    }
    day = meta[meta.length - 1];
  }

  const snap = await readSnapshot(db, day);
  if (!snap.length) throw new Error(`[restore] ${day} 这份快照是空的`);

  const counts = { takenOn: day, total: snap.length, written: 0 };
  if (dryRun) return { ok: true, dryRun: true, ...counts };

  for (let i = 0; i < snap.length; i += CHUNK) {
    const chunk = snap.slice(i, i + CHUNK).map((r) => ({
      key: r.key,
      value: r.value,
      expires_at: r.expires_at || null,
      updated_at: new Date().toISOString(),
    }));
    unwrap(await db.from("kv").upsert(chunk, { onConflict: "key" }), `恢复第 ${i / CHUNK + 1} 批`);
    counts.written += chunk.length;
  }

  console.log(`[restore] 完成 ${JSON.stringify(counts)}`);
  return { ok: true, ...counts, restoredAt: new Date().toISOString() };
}

module.exports = { runBackup, runRestore, bjDate };
