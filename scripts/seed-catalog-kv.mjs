/**
 * 把「社区提交 + 官方目录索引」灌进 Worker 的 KV 缓存。
 *
 * 背景：Worker 读取目录数据一律 KV 优先（catalog:community:v1 / catalog:index:v1），
 * 只有在 KV 为空时才回退到 GitHub 仓库文件（需要 GITHUB_PAT）。
 * 因此只要 src/data 里的目录发生变化（新增产品、改动 developerLogin 等），
 * 部署完 Worker 后跑一次本脚本即可让个人主页立刻反映最新目录。
 *
 * 用法: node scripts/seed-catalog-kv.mjs
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workerDir = path.join(root, "worker");
const wrangler = path.join(workerDir, "node_modules/.bin/wrangler");

const jobs = [
  { key: "catalog:community:v1", file: "src/data/community.json" },
  { key: "catalog:index:v1", file: "src/data/product-index.json" },
];

if (!existsSync(wrangler)) {
  console.error(`✗ 找不到 wrangler（${wrangler}），请先在 worker/ 目录安装依赖`);
  process.exit(1);
}

for (const job of jobs) {
  const abs = path.join(root, job.file);
  if (!existsSync(abs)) {
    console.error(`✗ 缺少文件 ${job.file}`);
    process.exit(1);
  }
  execFileSync(
    wrangler,
    ["kv", "key", "put", "--remote", "--binding=PROFILES", job.key, `--path=${abs}`],
    { cwd: workerDir, stdio: "inherit" },
  );
  console.log(`✓ ${job.file} -> ${job.key}`);
}

console.log("\n提示：改完 src/data/products.ts 后请先运行 node scripts/build-product-index.mjs，再运行本脚本。");
