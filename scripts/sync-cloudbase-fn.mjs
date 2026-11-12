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
 * 语法转换：export default { → module.exports = {，以及同目录的
 * import { A } from "./x.js" → const { A } = require("./x.cjs")。
 * worker/index.js 里没有顶层 await，所以这个转换是安全的。
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

/**
 * 除业务主文件外，还有几个纯函数模块也要同步过去（目前只有热点抓取引擎）。
 * 这类文件用「末尾一句具名导出」的写法，转换规则与 export default 不同。
 * 之所以放 worker/ 而不是直接写在云函数目录里：本地脚本、测试、云函数必须跑
 * 同一份解析逻辑，分叉一次就会「线上标题是乱的、本地是好的」。
 */
const EXTRA = [
  {
    src: path.join(ROOT, "worker", "hot.js"),
    dst: path.join(ROOT, "cloudbase", "functions", "solhub-hot", "hot.cjs"),
  },
  {
    src: path.join(ROOT, "worker", "translate.js"),
    dst: path.join(ROOT, "cloudbase", "functions", "solhub-hot", "translate.cjs"),
  },
  {
    src: path.join(ROOT, "worker", "t2s.js"),
    dst: path.join(ROOT, "cloudbase", "functions", "solhub-hot", "t2s.cjs"),
  },
  {
    /* 行情引擎。core.cjs 用 require 引入，所以凡是带 core.cjs 的函数目录都得有它
       （solhub-cron 也 require core.cjs，少一份就整个函数起不来）。 */
    src: path.join(ROOT, "worker", "quotes.js"),
    dst: [
      path.join(ROOT, "cloudbase", "functions", "solhub-auth", "quotes.cjs"),
      path.join(ROOT, "cloudbase", "functions", "solhub-cron", "quotes.cjs"),
    ],
  },
];

const BANNER = `/*
 * ⚠️ 本文件由 scripts/sync-cloudbase-fn.mjs 从 worker/ 下的源文件自动生成，请勿直接编辑。
 * 改业务逻辑请改 worker/ 里的源文件，然后重新执行该脚本。
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
const cjsSource = source
  .replace(/^export default \{/m, "module.exports = {")
  /* 同目录模块引用：云函数那边只有 .cjs，路径要一起换 */
  .replace(
    /^import\s+\{([\s\S]*?)\}\s+from\s+["']\.\/([\w.-]+)\.js["'];?$/gm,
    (m, names, file) => `const {${names}} = require("./${file}.cjs");`,
  );
const next = BANNER + cjsSource;

let changed = 0;

/** 写一个目标文件；--check 时只记账不落盘 */
function emit(dst, content, label) {
  const dir = path.dirname(dst);
  if (!fs.existsSync(dir)) {
    console.error(`[sync] 目标目录不存在，跳过：${path.relative(ROOT, dir)}`);
    return;
  }
  if (fs.existsSync(dst) && fs.readFileSync(dst, "utf8") === content) return;
  changed += 1;
  if (checkOnly) return;
  fs.writeFileSync(dst, content);
  console.log(`[sync] 已生成 ${path.relative(ROOT, dst)}（${content.length} 字节）`);
}

for (const dst of TARGETS) emit(dst, next, "core.cjs");

/* 纯函数模块：末尾一句 `export { A, B };` → `module.exports = { A, B };` */
for (const { src, dst } of EXTRA) {
  if (!fs.existsSync(src)) {
    console.error(`[sync] 找不到源文件，跳过：${path.relative(ROOT, src)}`);
    continue;
  }
  const body = fs.readFileSync(src, "utf8");
  const named = /^export \{([\s\S]*?)\};?\s*$/m.exec(body);
  if (!named) {
    console.error(`[sync] ${path.relative(ROOT, src)} 里没找到末尾的 export { ... }，无法转换`);
    process.exitCode = 1;
    continue;
  }
  /* 兄弟模块之间用 ESM import，转成 require 时路径要一起换成 .cjs，
     否则云函数里 require("./translate.js") 会找不到文件（那边只有 .cjs）。 */
  const asCjs = body
    .replace(
      /^import\s+\{([\s\S]*?)\}\s+from\s+["']\.\/([\w.-]+)\.js["'];?$/gm,
      (m, names, file) => `const {${names}} = require("./${file}.cjs");`,
    )
    .replace(/^export \{([\s\S]*?)\};?\s*$/m, "module.exports = {$1};");
  for (const one of [].concat(dst)) emit(one, `${BANNER}${asCjs}`, "module");
}

if (checkOnly && changed > 0) {
  console.error("[sync] 生成文件与源文件不一致，请执行 node scripts/sync-cloudbase-fn.mjs");
  process.exit(1);
}
if (!changed) console.log("[sync] 生成文件已是最新，无需改动");
