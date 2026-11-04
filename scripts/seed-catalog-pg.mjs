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
 *       node scripts/seed-catalog-pg.mjs --force-community  # 用仓库种子强覆盖社区键
 *
 * 注意：catalog:community:v1 是运行时可写的（/publish、编辑、删除都会改它），
 * 仓库里的 community.json 只是初始种子。若 KV 里已有运行时数据且与仓库不同，
 * 脚本默认跳过该键，避免把线上用户提交冲掉；只有 --force-community 才覆盖。
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

const forceCommunity = process.argv.includes("--force-community");

for (const job of jobs) {
  const abs = path.join(root, job.file);
  const value = readFileSync(abs, "utf8");

  /* 社区键是运行时可写的：/publish、编辑、删除都会往 KV_COMMUNITY 写。
     community.json 只是初始种子，直接用它覆盖会丢掉线上用户提交的产品。
     只要 KV 已有内容且与仓库不一致就跳过，除非显式 --force-community。 */
  if (job.key === "catalog:community:v1" && !forceCommunity) {
    const cur = await db.from("kv").select("value").eq("key", job.key).limit(1);
    if (cur.error) {
      console.error(`✗ 读取 ${job.key} 失败：${cur.error.message}`);
      process.exit(1);
    }
    const existing = cur.data && cur.data[0] ? cur.data[0].value : null;
    if (existing && existing !== value) {
      console.log(`· 跳过 ${job.key}：KV 已有运行时数据且与仓库不同（${existing.length} vs ${value.length} 字节）`);
      console.log("  这是防覆盖保护。确需用仓库种子初始化/覆盖，请加 --force-community。");
      continue;
    }
  }

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

console.log(
  "\n提示：改完 src/data/products.ts 后请先运行 node scripts/build-product-index.mjs，再运行本脚本。\n" +
    "      目录数据是 KV 优先，漏跑会让线上个人主页仍读旧快照（例如图标改名后 404 破图）。",
);
