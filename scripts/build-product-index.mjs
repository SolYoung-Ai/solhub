/**
 * 从 src/data/products.ts 生成 src/data/product-index.json。
 * Worker 需要读取「公开产品索引」来渲染用户主页的产品卡片（Worker 读不了 TS）。
 * 用法: node scripts/build-product-index.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "src/data/products.ts");
const out = path.join(root, "src/data/product-index.json");

const text = readFileSync(src, "utf8");

/** 解析文件里的常量赋值：const NAME = "value" 或 const NAME = BARE */
const consts = {};
for (const m of text.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("([^"]*)"|'([^']*)'|([A-Za-z_][A-Za-z0-9_]*))/g)) {
  consts[m[1]] = m[3] ?? m[4] ?? m[5];
}

/** 取字段值：优先带引号的字面量，否则尝试解析为已定义的常量名 */
const str = (block, key) => {
  const q = block.match(new RegExp(`\\b${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (q) return q[1];
  const b = block.match(new RegExp(`\\b${key}:\\s*([A-Za-z_][A-Za-z0-9_]*)`));
  if (b && consts[b[1]] != null) return consts[b[1]];
  return "";
};

/** 取数字字段 */
const num = (block, key) => {
  const m = block.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
  return m ? Number(m[1]) : undefined;
};

/** 取字符串数组字段 */
const list = (block, key) => {
  const m = block.match(new RegExp(`\\b${key}:\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return [];
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
};

// 产品数组开始处之后按顶层对象切块
const start = text.indexOf("export const products");
const body = text.slice(start);
const blocks = body.split(/\n  \{\n/).slice(1);

const products = blocks
  .map((block) => {
    const slug = str(block, "slug");
    if (!slug) return null;
    return {
      slug,
      name: str(block, "name"),
      icon: str(block, "icon"),
      shortDescription: str(block, "shortDescription"),
      websiteUrl: str(block, "websiteUrl"),
      category: str(block, "category"),
      tags: list(block, "tags").slice(0, 6),
      verificationStatus: str(block, "verificationStatus") || "unverified",
      publishedAt: str(block, "publishedAt"),
      developerName: str(block, "developerName"),
      developerLogin: str(block, "developerLogin"),
      isDemo: /\bisDemo:\s*true/.test(block),
      rankPosition: num(block, "rankPosition"),
    };
  })
  .filter(Boolean);

writeFileSync(out, JSON.stringify(products, null, 2) + "\n");
console.log(`✓ ${products.length} 个产品 -> ${path.relative(root, out)}`);
products.forEach((p) => console.log(`  · ${p.slug} (${p.name})`));
