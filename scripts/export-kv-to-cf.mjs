/**
 * 把 CloudBase PostgreSQL 的 public.kv 导出成 Cloudflare KV 的 bulk 文件
 * =====================================================================
 *
 * 用法：
 *   node scripts/export-kv-to-cf.mjs
 *   cd worker && npx wrangler kv bulk put ../worker/kv-bulk.json --binding=PROFILES --remote
 *
 * 为什么需要它：后端在 2026-11 从 Worker 迁到了 CloudBase（PG 模拟 KV），
 * 现在要迁回去，数据只有 1MB 出头（82 行），一次性搬完即可。
 *
 * 跳过哪些键：
 *   session: / vcode: / rate: / register:ip: / publish:hour: / login:fail: —— 会话与限流都是短命数据，
 *   搬过去反而会把一批本该过期的状态带到新环境。
 *   backup: —— 历史全量快照，属于备份本身，不参与迁移。
 *
 * 输出文件含头像 base64 与密码哈希，worker/kv-bulk.json 已在 .gitignore 里，不要提交。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "cloudbase/functions/solhub-auth/package.json"));
const tcb = require("@cloudbase/node-sdk");

const envText = readFileSync(path.join(root, "cloudbase/.env.local"), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const db = tcb.init({ env: env.TCB_ENV, accessKey: env.CLOUDBASE_APIKEY }).rdb();

const SKIP = ["backup:", "session:", "vcode:", "rate:", "publish:hour:", "register:ip:", "login:fail:"];
const skip = (k) => SKIP.some((p) => k.startsWith(p));

const rows = [];
const PAGE = 500;
for (let from = 0; ; from += PAGE) {
  const res = await db.from("kv").select("key,value,expires_at").range(from, from + PAGE - 1);
  if (res.error) throw new Error(res.error.message);
  const batch = res.data || [];
  rows.push(...batch);
  if (batch.length < PAGE) break;
}

const items = [];
let bytes = 0;
for (const r of rows) {
  if (skip(r.key)) continue;
  const value = String(r.value ?? "");
  bytes += Buffer.byteLength(value, "utf8");
  const item = { key: r.key, value };
  if (r.expires_at) item.expiration = Math.floor(new Date(r.expires_at).getTime() / 1000);
  items.push(item);
}

const out = path.join(root, "worker/kv-bulk.json");
writeFileSync(out, JSON.stringify(items, null, 0));
console.log(`导出 ${items.length} 个键 / ${(bytes / 1024 / 1024).toFixed(2)} MB -> ${out}`);
console.log("下一步：cd worker && npx wrangler kv bulk put kv-bulk.json --binding=PROFILES --remote");
