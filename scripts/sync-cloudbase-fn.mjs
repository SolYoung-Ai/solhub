#!/usr/bin/env node
/**
 * 把 worker/index.js（业务逻辑唯一真源）同步成云函数用的 core.cjs。
 *
 * 为什么需要这一步：
 *   认证服务的业务代码原封不动地从 Cloudflare Worker 搬到 CloudBase 云函数，
 *   但两份代码不能各改各的 —— 一旦分叉就会出现「线上跑的和本地测的不一样」。
 *   所以 worker/index.js 是唯一真源，每次部署前跑一次这个脚本把内容带过去。
 *
 * worker/index.js 是 ES Module（末尾一句 export default { ... }），而云函数
 * （HTTP Function / Event Function）统一用 CommonJS。这里做的是一次性的
 * 语法转换：export default { → module.exports = {。
 * worker/index.js 里没有 import、也没有顶层 await，所以这个转换是安全的。
 * 转换后的文件与源文件逐行可对照，出问题能一眼看出差异在哪。
 *
 * 用法：node scripts/sync-cloudbase-fn.mjs [--check]
 *   --check 只比对不同步（CI 用；有差异时以非零码退出）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "worker", "index.js");
const TARGETS = [
  path.join(ROOT, "cloudbase", "functions", "solhub-auth", "core.cjs"),
  path.join(ROOT, "cloudbase", "functions", "solhub-cron", "core.cjs"),
];

const BANNER = `/*
 * ⚠️ 本文件由 scripts/sync-cloudbase-fn.mjs 从 worker/index.js 自动生成，请勿直接编辑。
 * 改业务逻辑请改 worker/index.js，然后重新执行该脚本。
 */
`;

const checkOnly = process.argv.includes("--check");

if (!fs.existsSync(SRC)) {
  console.error(`[sync] 找不到源文件：${SRC}`);
  process.exit(1);
}

const source = fs.readFileSync(SRC, "utf8");

/* ESM → CJS：只有末尾一句 export default */
const exportMatch = /^export default \{/m.exec(source);
if (!exportMatch) {
  console.error("[sync] 没找到 export default，无法转换成 CommonJS");
  process.exit(1);
}
const cjsSource = source.replace(/^export default \{/m, "module.exports = {");
const next = BANNER + cjsSource;

let changed = 0;
for (const dst of TARGETS) {
  const dir = path.dirname(dst);
  if (!fs.existsSync(dir)) {
    console.error(`[sync] 目标目录不存在，跳过：${path.relative(ROOT, dir)}`);
    continue;
  }
  if (fs.existsSync(dst) && fs.readFileSync(dst, "utf8") === next) continue;
  if (checkOnly) {
    changed += 1;
    continue;
  }
  fs.writeFileSync(dst, next);
  changed += 1;
  console.log(`[sync] 已生成 ${path.relative(ROOT, dst)}（${next.length} 字节）`);
}

if (checkOnly && changed > 0) {
  console.error("[sync] core.cjs 与 worker/index.js 不一致，请执行 node scripts/sync-cloudbase-fn.mjs");
  process.exit(1);
}
if (!changed) console.log("[sync] core.cjs 已是最新，无需改动");
