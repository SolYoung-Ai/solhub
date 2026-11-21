/**
 * SolHub 每日数据快照（逻辑备份）
 * =====================================================
 *
 * 背景：本环境是 CloudBase 的**共享实例**（体验版/个人版套餐）。平台级
 * 「自动备份 / 时间点恢复」是独享实例才有的能力，控制台里没有备份入口；
 * 而云存储这条路在 PG 环境里也被封了（旧 COS SDK 返回 STORAGE_NOT_SUPPORTED，
 * pgstore 又还没进 node-sdk），所以备份落在数据库里：
 *   - pg 驱动    → 表 kv_backup（见 cloudbase/migrations/20261104020000_create_kv_backup.sql）
 *   - nosql 驱动 → 集合 kv_backup
 *
 * 它兜住的是真正会发生的事故：
 *   - 误执行 DELETE / UPDATE（最常见）
 *   - 迁移脚本写错、代码缺陷把整批数据写坏
 *
 * 它兜不住：实例被销毁、环境被回收。要覆盖这一类风险，只能升级到独享实例用平台
 * 备份，或者定期把快照导一份到环境之外（见 runRestore 导出说明）。
 *
 * 粒度：一天一份，保留 30 天。当天补跑只覆盖当天那份，不会产生重复快照。
 *
 * 换库不影响本文件：读写全部走 kv.cjs 的 createStore()，由 KV_DRIVER 决定落到
 * 哪张表/哪个集合。备份逻辑只有这一份，不会出现「PG 备份了、NoSQL 漏了」。
 */

const { createStore } = require("./kv.cjs");

/** 保留天数 */
const KEEP_DAYS = 30;

/** 北京时间日期 YYYY-MM-DD（按自然日命名，跨 UTC 边界不会被拆成两份） */
function bjDate(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------- 主流程 */

async function runBackup() {
  const startedAt = Date.now();
  const store = createStore();

  const takenOn = bjDate();
  const rows = await store.dumpAll();
  if (!rows.length) throw new Error("[backup] kv 导出为空，这明显不对，已中止（不覆盖当天快照）");

  const rawBytes = rows.reduce((s, r) => s + String(r.value || "").length + String(r.key).length, 0);
  const written = await store.writeSnapshot(takenOn, rows);
  const cutoff = await store.pruneSnapshots(bjDate(new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000)));

  const prev = await store.getMeta("backup:days");
  const days = Array.isArray(prev) ? prev.filter((d) => d !== takenOn) : [];
  days.push(takenOn);
  days.sort();
  const kept = days.slice(-KEEP_DAYS);

  await store.putMeta("backup:days", kept);
  await store.putMeta("backup:last", {
    takenOn,
    rows: written,
    rawBytes,
    driver: store.driver,
    at: new Date().toISOString(),
  });

  const summary = {
    ok: true,
    driver: store.driver,
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

/**
 * 恢复。默认只做「补回」，不删多余键：
 *   - 快照里有的 key → 覆盖写入（回到快照时的状态）
 *   - 快照里没有、库里现在有的 key → 保留（避免把备份之后注册的新用户直接抹掉）
 * 需要「完全回滚到某天」时，先手动 DELETE 再恢复，属于人工决策，不放进自动化。
 */
async function runRestore({ takenOn, dryRun = true } = {}) {
  const store = createStore();

  let day = String(takenOn || "");
  if (!day) {
    const meta = await store.getMeta("backup:days");
    if (!Array.isArray(meta) || !meta.length) {
      throw new Error("[restore] 还没有任何快照（backup:days 为空）");
    }
    day = meta[meta.length - 1];
  }

  const snap = await store.readSnapshot(day);
  if (!snap.length) throw new Error(`[restore] ${day} 这份快照是空的`);

  const counts = { driver: store.driver, takenOn: day, total: snap.length, written: 0 };
  if (dryRun) return { ok: true, dryRun: true, ...counts };

  counts.written = await store.upsertMany(snap);

  console.log(`[restore] 完成 ${JSON.stringify(counts)}`);
  return { ok: true, ...counts, restoredAt: new Date().toISOString() };
}

/* ------------------------------------------------------------ 过期键清理 */

/**
 * 清理已过期的键（会话、验证码、限流令牌…）。
 *
 * 为什么需要：KV 兼容层的 get 只把「过期」当作不存在，**记录本身一直留着**。
 * session:* 这类 30 天 TTL 的键会无限堆积，而且每天被快照复制 30 份（备份是乘法）。
 *
 * 安全边界（很重要）：
 *   - 只删 expires_at 非空、且已经到期的记录；
 *   - 用户 / 资料 / 产品目录 / 关注关系这些业务数据 expires_at 都是空，
 *     永远不会被这里碰到；
 *   - 默认 dryRun，人工调用时先看数字再决定删不删。
 */
const PURGE_MAX = 5000;

async function purgeExpired({ dryRun = true, max = PURGE_MAX } = {}) {
  const store = createStore();
  const expired = await store.scanExpired({ max });

  const groups = {};
  for (const r of expired) {
    const g = `${String(r.key).split(":")[0]}:*`;
    groups[g] = (groups[g] || 0) + 1;
  }

  if (dryRun || !expired.length) {
    return { ok: true, driver: store.driver, dryRun, expired: expired.length, deleted: 0, groups };
  }

  const deleted = await store.deleteMany(expired.map((r) => r.key));
  const summary = {
    ok: true,
    driver: store.driver,
    dryRun: false,
    expired: expired.length,
    deleted,
    groups,
    at: new Date().toISOString(),
  };
  console.log(`[purge] 完成 ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = { runBackup, runRestore, purgeExpired, bjDate };
