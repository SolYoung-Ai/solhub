#!/usr/bin/env node
/**
 * 存储驱动自检：在内存里跑一遍 kv-nosql.cjs 的语义
 * =====================================================
 *
 * 用法：node scripts/check-kv-driver.mjs
 *
 * 什么时候跑：
 *   1. 改过 kv-nosql.cjs / kv.cjs / backup.cjs；
 *   2. 真正把 KV_DRIVER 切到 nosql 之前（上线前最后一道自检）；
 *   3. 切完切回之前，确认两个驱动行为仍然一致。
 *
 * 为什么不是普通单测：驱动依赖 @cloudbase/node-sdk 的真实客户端，而仓库根目录
 * 不装它（只有云函数目录装），vitest 里 require 会直接失败。这里用 Module._load
 * 拦截注入内存实现，既不污染依赖，也不需要在 CI 里连库。
 */

import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/* ------------------------------------------------------------------ 打桩 */

const mockSdk = require("./mock-cloudbase-nosql.cjs").createMockSdk();
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === "@cloudbase/node-sdk") return mockSdk;
  return originalLoad.apply(this, arguments);
};

/* 驱动会读这两个变量；给假值即可，mock 不校验 */
process.env.TCB_ENV = process.env.TCB_ENV || "mock-env";
process.env.CLOUDBASE_APIKEY = process.env.CLOUDBASE_APIKEY || "mock-key";
process.env.KV_DRIVER = "nosql";

const DRIVER_PATH = path.join(ROOT, "cloudbase", "functions", "solhub-auth", "kv-nosql.cjs");
const { createKV, createStore } = require(DRIVER_PATH);

/* ------------------------------------------------------------------ 断言 */

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
}

/* ------------------------------------------------------------------ 用例 */

async function main() {
  const kv = createKV();
  const store = createStore();

  console.log("\n[0] 迁移脚本与驱动的 _id 编码必须一致（否则搬过去业务读不到）");
  const { encId: migrateEncId } = await import("./migrate-kv-to-nosql.mjs");
  for (const k of ["hot:v1", "user:a@b.com", "目录:中文"]) {
    eq(`encId ${k}`, migrateEncId(k), store.encId(k));
  }

  console.log("\n[1] 单键读写（含特殊字符的 key）");
  const keys = ["hot:v1", "user:solyoungwork@gmail.com", "handle:solyoung", "avatar:a/b", "目录:中文"];
  for (const k of keys) {
    await kv.put(k, `值-${k}`);
  }
  for (const k of keys) {
    eq(`get ${k}`, await kv.get(k), `值-${k}`);
  }
  eq("不存在的键返回 null", await kv.get("nope:missing"), null);

  console.log("\n[2] 覆盖写与删除");
  await kv.put("hot:v1", "新值");
  eq("覆盖写生效", await kv.get("hot:v1"), "新值");
  await kv.delete("avatar:a/b");
  eq("删除后读不到", await kv.get("avatar:a/b"), null);

  console.log("\n[3] TTL 过期（不依赖真实时钟：直接改库里的 expires_at）");
  await kv.put("session:expired", "x", { expirationTtl: 3600 });
  const db = mockSdk.__lastDb();
  const id = store.encId("session:expired");
  const doc = db.raw("kv").get(id);
  check("put 时写入了 expires_at", !!(doc && doc.expires_at), JSON.stringify(doc));
  doc.expires_at = new Date(Date.now() - 1000).toISOString();
  eq("过期后 get 返回 null", await kv.get("session:expired"), null);
  await kv.delete("session:expired");

  console.log("\n[4] 前缀扫描不串味（user: 不能匹配 user_x:）");
  await kv.put("user_x:decoy", "不该被扫到");
  const listed = await kv.list({ prefix: "user:", limit: 100 });
  const names = listed.keys.map((x) => x.name);
  check("user: 前缀只返回自己的键", names.every((n) => n.startsWith("user:")), JSON.stringify(names));
  check("包含 user:...", names.includes("user:solyoungwork@gmail.com"), JSON.stringify(names));
  check("不包含 user_x:...", !names.includes("user_x:decoy"), JSON.stringify(names));
  await kv.delete("user_x:decoy");

  console.log("\n[5] list 分页（cursor 翻页，不重不漏）");
  for (let i = 0; i < 5; i += 1) await kv.put(`page:k${i}`, String(i));
  const first = await kv.list({ prefix: "page:", limit: 2 });
  eq("第一页 2 条且未结束", [first.keys.length, first.list_complete], [2, false]);
  const second = await kv.list({ prefix: "page:", limit: 2, cursor: first.cursor });
  const third = await kv.list({ prefix: "page:", limit: 2, cursor: second.cursor });
  eq("第二页 2 条", second.keys.length, 2);
  eq("第三页 1 条且结束", [third.keys.length, third.list_complete], [1, true]);
  const allPage = [...first.keys, ...second.keys, ...third.keys].map((x) => x.name).sort();
  eq("翻页结果完整", allPage, ["page:k0", "page:k1", "page:k2", "page:k3", "page:k4"]);

  console.log("\n[6] 备份：导出 / 快照幂等 / 读回");
  const dump = await store.dumpAll();
  check("dumpAll 拿到全量", dump.length >= 8, `实际 ${dump.length} 条`);
  const snapshotBefore = dump.find((r) => r.key === "hot:v1");
  eq("导出带值", snapshotBefore && snapshotBefore.value, "新值");

  const written1 = await store.writeSnapshot("2026-11-22", dump);
  const written2 = await store.writeSnapshot("2026-11-22", dump);
  eq("同一天写两次，条数一致（幂等）", [written1, written2], [dump.length, dump.length]);
  const back = await store.readSnapshot("2026-11-22");
  eq("快照读回条数一致", back.length, dump.length);
  eq("快照内容一致", back.find((r) => r.key === "hot:v1").value, "新值");

  console.log("\n[7] 恢复与清理");
  await kv.put("hot:v1", "被写坏的值");
  await store.upsertMany(back);
  eq("upsertMany 恢复回快照值", await kv.get("hot:v1"), "新值");

  await kv.put("temp:a", "1");
  await kv.put("temp:b", "2");
  const deleted = await store.deleteMany(["temp:a", "temp:b"]);
  eq("deleteMany 数量", deleted, 2);
  eq("deleteMany 后读不到", await kv.get("temp:a"), null);

  const pruned = await store.pruneSnapshots("2026-11-23");
  eq("pruneSnapshots 返回截止日期", pruned, "2026-11-23");
  eq("过期快照被清空", (await store.readSnapshot("2026-11-22")).length, 0);

  console.log("\n[8] 过期键扫描（业务数据不能被误删）");
  await kv.put("session:old", "x", { expirationTtl: 60 });
  const oldDoc = db.raw("kv").get(store.encId("session:old"));
  oldDoc.expires_at = new Date(Date.now() - 1000).toISOString();
  const expired = await store.scanExpired({ max: 100 });
  const expiredKeys = expired.map((r) => r.key);
  check("扫到过期会话", expiredKeys.includes("session:old"), JSON.stringify(expiredKeys));
  check("不碰业务数据（hot:v1 没有 expires_at）", !expiredKeys.includes("hot:v1"), JSON.stringify(expiredKeys));

  console.log("\n[9] 元信息读写（backup:days / backup:last）");
  await store.putMeta("backup:days", ["2026-11-22"]);
  eq("getMeta 读回数组", await store.getMeta("backup:days"), ["2026-11-22"]);
  eq("不存在的元信息返回 null", await store.getMeta("backup:none"), null);

  /* ---------------------------------------------------------------- 汇总 */
  console.log(`\n${failures.length ? "❌" : "✅"} 通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length) {
    for (const f of failures) console.log(`   - ${f.name}: ${f.detail || ""}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\n自检崩溃：", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
