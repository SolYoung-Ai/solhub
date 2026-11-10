#!/usr/bin/env node
/* ============================================================
   把 src/data/skills-zh.json 的中文简介合并进 skills-catalog.json

   为什么单独一个文件：
   catalog 是快照产物（scripts/build-skills-catalog.mjs 会整体重写），
   译文是人工/AI 产出、需要长期保留。分开存，重跑快照时才不会把译文冲掉。

   用法：node scripts/merge-skills-zh.mjs
   ============================================================ */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = resolve(ROOT, "public/data/skills-catalog.json");
const ZH = resolve(ROOT, "src/data/skills-zh.json");

if (!existsSync(ZH)) {
  console.error("✗ 找不到 src/data/skills-zh.json");
  process.exit(1);
}

const zh = JSON.parse(readFileSync(ZH, "utf8"));
const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
const items = catalog.items ?? [];

let hit = 0;
for (const item of items) {
  const text = zh[item.name];
  if (text) {
    item.descriptionZh = text;
    hit += 1;
  } else {
    delete item.descriptionZh;
  }
}

/* 记录覆盖率，页面可据此决定是否展示「中文简介」筛选 */
const coverage = { total: items.length, translated: hit, updatedAt: new Date().toISOString().slice(0, 10) };
if (catalog.meta) catalog.meta.zhCoverage = coverage;

writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");

const missingKeys = Object.keys(zh).filter((k) => !items.some((i) => i.name === k));
console.log(`✓ 已合并中文简介 ${hit}/${items.length} 条（${((hit / items.length) * 100).toFixed(0)}%）`);
if (missingKeys.length > 0) {
  console.log(`⚠ ${missingKeys.length} 个译名在快照里找不到同名 skill：${missingKeys.slice(0, 5).join("、")}…`);
}
