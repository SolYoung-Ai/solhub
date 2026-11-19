#!/usr/bin/env node
/**
 * 发布 SolHub 官方在线工具（hosted tools）。
 *
 * 工具源码放在 hosted-tools/：单个自包含 HTML + 一张 SVG Logo。
 * 上传前会把 <script src="vendor/..."> 就地内联，保证云端拿到的是单文件
 * （沙箱 iframe 里没有同源目录，外链脚本会 404）。
 *
 * 用法：
 *   SOLHUB_ADMIN_KEY=xxx node scripts/publish-hosted-tool.mjs            # 全部发布
 *   SOLHUB_ADMIN_KEY=xxx node scripts/publish-hosted-tool.mjs solqr      # 只发一个
 *   node scripts/publish-hosted-tool.mjs --dry                           # 只构建不上传
 *
 * id 固定写在 manifest 里：重复发布是覆盖同一件工具，不会产生新链接。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "hosted-tools");
const API = process.env.SOLHUB_API || "https://solyoung-d4gpp1f7s4e075f6d-1499756427.ap-shanghai.app.tcloudbase.com/api";
const KEY = process.env.SOLHUB_ADMIN_KEY || "";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.filter((a) => !a.startsWith("--"));

/* 把 <script src="vendor/x.js"></script> 换成内联脚本 */
async function inlineScripts(html) {
  const tags = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)];
  for (const [tag, src] of tags) {
    if (/^https?:/i.test(src)) continue;
    const code = await readFile(path.join(DIR, src), "utf8");
    if (/<\/script/i.test(code)) throw new Error(`${src} 含有 </script>，无法直接内联`);
    html = html.replace(tag, `<script>\n/* ${path.basename(src)} —— MIT, Kazuhiko Arase */\n${code}\n</script>`);
  }
  return html;
}

async function dataUri(file) {
  const buf = await readFile(path.join(DIR, file));
  const type = file.endsWith(".svg") ? "image/svg+xml" : "image/png";
  return `data:${type};base64,${buf.toString("base64")}`;
}

const manifest = JSON.parse(await readFile(path.join(DIR, "manifest.json"), "utf8"));
const list = manifest.tools.filter((t) => only.length === 0 || only.includes(t.id));
if (list.length === 0) {
  console.error("没有匹配的工具，检查参数或 manifest.json");
  process.exit(1);
}

for (const tool of list) {
  const html = await inlineScripts(await readFile(path.join(DIR, tool.file), "utf8"));
  const logo = await dataUri(tool.logo);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`· ${tool.id}  ${tool.name}  ${kb} KB  logo ${(logo.length / 1024).toFixed(1)} KB`);

  if (dry) continue;
  if (!KEY) {
    console.error("缺少 SOLHUB_ADMIN_KEY，无法上传");
    process.exit(1);
  }

  const res = await fetch(`${API}/hosted/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": KEY },
    body: JSON.stringify({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      tags: tool.tags,
      author: manifest.author,
      logo,
      html,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    console.error(`  上传失败 ${res.status}: ${data.error || "未知错误"}`);
    process.exit(1);
  }
  console.log(`  → https://solhub.solyoung.top/tools/?id=${data.id}`);
}
