/**
 * 把「社区提交 + 官方目录索引」灌进 CloudBase PostgreSQL 的 kv 表。
 *
 * 背景：后端读取目录数据一律 KV 优先（catalog:community:v1 / catalog:index:v1），
 * 只有在 KV 为空时才回退到 GitHub 仓库文件（需要 GITHUB_PAT）。
 * 因此只要 src/data 里的目录发生变化（新增产品、改动 developerLogin 等），
 * 部署完云函数后跑一次本脚本即可让个人主页立刻反映最新目录。
 *
 * 2026-11-02：存储从 Cloudflare KV 换成 CloudBase PG 的 public.kv 表
 * （键名与语义完全兼容，见 cloudbase/functions/solhub-auth/kv.cjs）。
 *
 * 用法: node scripts/seed-catalog-pg.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");

/* @cloudbase/node-sdk 装在云函数目录里，从那个位置解析 */
const require = createRequire(path.join(root, "cloudbase/functions/solhub-auth/package.json"));
const tcb = require("@cloudbase/node-sdk");

function readEnvFile(file) {
  if (!existsSync(file)) throw new Error(`找不到 ${file}`);
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const jobs = [
  { key: "catalog:community:v1", file: "src/data/community.json" },
  { key: "catalog:index:v1", file: "src/data/product-index.json" },
];

for (const job of jobs) {
  const abs = path.join(root, job.file);
  if (!existsSync(abs)) {
    console.error(`✗ 缺少文件 ${job.file}`);
    process.exit(1);
  }
}

const env = readEnvFile(path.join(root, "cloudbase/.env.local"));
const db = tcb.init({ env: env.TCB_ENV, accessKey: env.CLOUDBASE_APIKEY }).rdb();

for (const job of jobs) {
  const abs = path.join(root, job.file);
  const value = readFileSync(abs, "utf8");
  const res = await db
    .from("kv")
    .upsert(
      {
        key: job.key,
        value,
        expires_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  if (res.error) {
    console.error(`✗ 写入 ${job.key} 失败：${res.error.message}`);
    process.exit(1);
  }
  console.log(`✓ ${job.file} -> ${job.key}（${value.length} 字节）`);
}

console.log("\n提示：改完 src/data/products.ts 后请先运行 node scripts/build-product-index.mjs，再运行本脚本。");
