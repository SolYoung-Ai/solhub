/**
 * SolHub 定时任务 —— CloudBase Event Function（定时触发）
 * =====================================================
 *
 * 这一个函数承担两件事，靠触发器的名字分流：
 *
 *   1. 官方推荐帖（原 official-* 触发器，**已下线**）
 *      发帖功能在 2026-11-04 下线，页面上不再有任何帖子入口，所以三个
 *      official-morning / afternoon / midnight 触发器已经删除，避免每天往
 *      feed:global 里写没人看得到的孤儿数据。代码与 core.scheduled() 都保留，
 *      把触发器加回（如 "0 0 9 * * * *"）即可恢复。
 *      与 Worker 的 scheduled() 完全同一份业务代码（core.cjs 里原封不动搬过来了），
 *      这里只做两件事：把 Worker 的 env / ctx 协议补齐；把 waitUntil 收集到的异步
 *      任务等完再返回 —— SCF 在函数返回后可能冻结容器，不等完可能写到一半被冻住。
 *
 *   2. 每日数据备份（触发器 backup-daily，见 backup.cjs）
 *      共享实例没有平台自动备份，这里自己每天存一份全量快照到 public.kv_backup 表。
 *      手动调用也走这里：{ action: "backup" } 立刻备份，
 *      { action: "restore", confirm: "RESTORE" } 从最近一份恢复。
 */

const { webcrypto } = require("node:crypto");
const core = require("./core.cjs");
const { createKV } = require("./kv.cjs");
const { installCaches } = require("./caches.cjs");
const { runBackup, runRestore, purgeExpired } = require("./backup.cjs");

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

/**
 * 判断这次触发要做什么。
 * timer 触发器送来的是 { Type: "Timer", TriggerName: "xxx" }；
 * 手动调用（控制台 / MCP / callFunction）送的是自定义 JSON，用 action 指定。
 */
function taskOf(event) {
  const e = event || {};
  if (e.action) return String(e.action);
  const name = String(e.TriggerName || e.Trigger || "");
  if (/backup/i.test(name)) return "backup";
  return "official";
}

exports.main = async (event, context) => {
  const startedAt = Date.now();
  const task = taskOf(event);

  if (task === "backup") {
    try {
      const backup = await runBackup();
      /* 备份之后再清理过期键 —— 顺序不能反：先备份，被清理掉的行在当天的快照里
         仍然存在，30 天内随时能 restore 找回。
         清理失败不影响备份结果，只把错误挂在返回值上。 */
      let purge;
      try {
        purge = await purgeExpired({ dryRun: !!(event && event.dryRun) });
      } catch (err) {
        console.error("[purge] 执行失败:", err && err.stack ? err.stack : err);
        purge = { ok: false, error: String((err && err.message) || err) };
      }
      return { ...backup, purge };
    } catch (err) {
      console.error("[backup] 执行失败:", err && err.stack ? err.stack : err);
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  /* 只清理、不备份（人工调用：先 {"action":"purge","dryRun":true} 看数字） */
  if (task === "purge") {
    try {
      return await purgeExpired({ dryRun: !!(event && event.dryRun) });
    } catch (err) {
      console.error("[purge] 执行失败:", err && err.stack ? err.stack : err);
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  if (task === "restore") {
    /* 恢复是不可逆的写操作，必须显式带 confirm 确认串，避免误触发 */
    if (!event || event.confirm !== "RESTORE") {
      return { ok: false, error: '恢复需要 confirm="RESTORE"；先传 dryRun:true 可预览' };
    }
    try {
      return await runRestore({ takenOn: event.takenOn, dryRun: !!event.dryRun });
    } catch (err) {
      console.error("[restore] 执行失败:", err && err.stack ? err.stack : err);
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  console.log(
    `[solhub-cron] 定时触发 task=${task} type=${(event && event.Type) || "unknown"} at=${new Date().toISOString()}`,
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
