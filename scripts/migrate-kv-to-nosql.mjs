#!/usr/bin/env node
/**
 * 把 kv 数据从一个 CloudBase 环境（PostgreSQL）搬到另一个环境（文档型数据库）
 * ==========================================================================
 *
 * 为什么需要单独一个脚本：切库那天要同时连两个环境，而云函数里的驱动只认
 * process.env 里的单个环境。这里用两个独立的 SDK 实例，读完老的、写新的，
 * 全程幂等（同一个 key 反复跑只会覆盖，不会重复）。
 *
 * 用法：
 *   node scripts/migrate-kv-to-nosql.mjs --from <老环境ID> --to <新环境ID> --dry
 *   TCB_KEY_FROM=<老Key> TCB_KEY_TO=<新Key> \
 *     node scripts/migrate-kv-to-nosql.mjs --from <老环境ID> --to <新环境ID>
 *
 * 参数：
 *   --from   老环境 ID（PostgreSQL，读）
 *   --to     新环境 ID（文档型，写）
 *   --dry    只统计与抽样，不写入
 *   --limit  最多搬多少条（默认 20000，防止异常膨胀）
 *
 * 密钥读取顺序：TCB_KEY_FROM / TCB_KEY_TO → CLOUDBASE_APIKEY
 * （同一个账号下环境级 API Key 通常可跨环境用，先试单项覆盖）。
 *
 * 注意：_id 编码必须与 kv-nosql.cjs 的 encId() 完全一致，否则搬过去业务读不到。
 * scripts/check-kv-driver.mjs 里有一条断言专门盯着这两处别分叉。
 */

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** SDK 只装在云函数目录里，从那里解析 */
const fnRequire = createRequire(path.join(ROOT, "cloudbase/functions/solhub-auth/package.json"));
const tcb = fnRequire("@cloudbase/node-sdk");

const PAGE = 500;
const CONCURRENCY = 8;

/* ------------------------------------------------------------------ 编码 */

/**
 * 原始 key → 文档 _id。必须与 kv-nosql.cjs 的 encId() 一致。
 * base64url 只含 A-Za-z0-9-_，绕开各引擎对 _id 字符的限制。
 */
export function encId(key) {
  return "k" + Buffer.from(String(key), "utf8").toString("base64url");
}

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const out = { dry: false, limit: 20000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry") out.dry = true;
    else if (a === "--from") out.from = argv[(i += 1)];
    else if (a === "--to") out.to = argv[(i += 1)];
    else if (a === "--limit") out.limit = Number(argv[(i += 1)]) || 20000;
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

function usage() {
  console.log(`用法：
  node scripts/migrate-kv-to-nosql.mjs --from <老环境ID> --to <新环境ID> [--dry] [--limit N]

密钥：TCB_KEY_FROM / TCB_KEY_TO（缺省用 CLOUDBASE_APIKEY）`);
}

/* ------------------------------------------------------------------ 读老库 */

async function readOld(envId, apiKey, maxRows) {
  if (!envId) throw new Error("缺少 --from（老环境 ID）");
  if (!apiKey) throw new Error("缺少老环境 API Key（TCB_KEY_FROM）");
  const app = tcb.init({ env: envId, accessKey: apiKey });
  const db = app.rdb();

  const rows = [];
  let cursor = "";
  for (let i = 0; i * PAGE < maxRows; i += 1) {
    let q = db.from("kv").select("key,value,expires_at").order("key", { ascending: true }).limit(PAGE);
    if (cursor) q = q.gt("key", cursor);
    const res = await q;
    if (res && res.error) throw new Error(`读老环境失败：${res.error.message || res.error.code}`);
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    cursor = batch[batch.length - 1].key;
  }
  return rows.slice(0, maxRows);
}

/* ------------------------------------------------------------------ 写新库 */

async function writeNew(envId, apiKey, rows, dry) {
  if (!envId) throw new Error("缺少 --to（新环境 ID）");
  if (!apiKey) throw new Error("缺少新环境 API Key（TCB_KEY_TO）");
  const app = tcb.init({ env: envId, accessKey: apiKey });
  const db = app.database();

  try {
    await db.createCollection("kv");
  } catch (err) {
    /* 已存在是正常情况 */
    const msg = String((err && (err.message || err.code)) || "");
    if (!/exist/i.test(msg)) console.warn(`[migrate] createCollection(kv)：${msg}`);
  }
  if (dry) return { written: 0, skipped: rows.length };

  const col = db.collection("kv");
  let written = 0;
  const now = new Date().toISOString();

  const writeOne = async (r) => {
    const res = await col.doc(encId(r.key)).set({
      key: r.key,
      value: r.value,
      expires_at: r.expires_at || null,
      updated_at: now,
    });
    if (res && res.error) throw new Error(`写 ${r.key} 失败：${res.error.message || res.error.code}`);
    written += 1;
  };

  let idx = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, rows.length || 1) }, async () => {
    while (idx < rows.length) {
      const cur = idx;
      idx += 1;
      await writeOne(rows[cur]);
    }
  });
  await Promise.all(runners);

  return { written, skipped: 0 };
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!args.from || !args.to) {
    usage();
    process.exitCode = 1;
    return;
  }

  const keyFrom = process.env.TCB_KEY_FROM || process.env.CLOUDBASE_APIKEY || "";
  const keyTo = process.env.TCB_KEY_TO || process.env.CLOUDBASE_APIKEY || "";

  console.log(`[migrate] 读 ${args.from} → 写 ${args.to}${args.dry ? "（dry run，不写入）" : ""}`);
  const startedAt = Date.now();

  const rows = await readOld(args.from, keyFrom, args.limit);
  if (!rows.length) {
    console.error("[migrate] 老环境 kv 是空的，中止（避免把新环境写成空库）");
    process.exitCode = 1;
    return;
  }

  const bytes = rows.reduce((s, r) => s + String(r.value || "").length + String(r.key).length, 0);
  console.log(`[migrate] 读到 ${rows.length} 条、${(bytes / 1024).toFixed(1)} KB`);
  if (args.dry) {
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.key} → _id=${encId(r.key)}（${String(r.value || "").length} 字符）`);
    }
  }

  const res = await writeNew(args.to, keyTo, rows, args.dry);
  const summary = {
    ok: true,
    dry: args.dry,
    from: args.from,
    to: args.to,
    rows: rows.length,
    written: res.written,
    bytes,
    ms: Date.now() - startedAt,
  };
  console.log(`[migrate] 完成 ${JSON.stringify(summary)}`);
  if (!args.dry) {
    console.log("[migrate] 下一步：在新环境 invoke solhub-cron {\"action\":\"backup\"}，确认 driver=nosql 且 rows 一致");
  }
}

/* 只在直接运行时执行（被自检脚本 import 时不跑） */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[migrate] 失败：", err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}
