#!/usr/bin/env node
/* ============================================================
   一条命令接入 AdSense：写 ads.txt + 写好本地 .env + 打印上线清单

   用法：
     npm run ads:init -- ca-pub-1234567890123456
     npm run ads:init -- ca-pub-1234567890123456 --article=1234567890 --list=0987654321
     npm run ads:init -- --check        # 只看当前配置状态

   为什么要有 ads.txt：
   AdSense 靠它确认「这个域名确实授权了 google.com 卖广告」，缺了会在后台
   报「找不到授权卖方」，部分广告需求会直接不参与竞价（等于少赚钱）。
   ============================================================ */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(ROOT, ".env");
const ADS_TXT = resolve(ROOT, "public/ads.txt");
/* 这一串是 Google 的认证机构 ID，所有 AdSense 站点都一样，不是密钥 */
const CERT_AUTHORITY_ID = "f08c47fec0942fa0";

const args = process.argv.slice(2);
const flags = new Map(
  args.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v = ""] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

const client = (args.find((a) => /^ca-pub-\d+$/.test(a)) ?? "").trim();
const article = (flags.get("article") ?? "").trim();
const list = (flags.get("list") ?? "").trim();

function readEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function upsertEnv(updates) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  for (const [key, value] of Object.entries(updates)) {
    if (!value) continue;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text += `${text.endsWith("\n") || text === "" ? "" : "\n"}${key}=${value}\n`;
  }
  writeFileSync(ENV_FILE, text, "utf8");
}

function status() {
  const env = readEnv();
  const rows = [
    ["PUBLIC_ADSENSE_CLIENT", env.PUBLIC_ADSENSE_CLIENT],
    ["PUBLIC_ADSENSE_SLOT_ARTICLE", env.PUBLIC_ADSENSE_SLOT_ARTICLE],
    ["PUBLIC_ADSENSE_SLOT_LIST", env.PUBLIC_ADSENSE_SLOT_LIST],
  ];
  console.log("当前本地配置（.env）：");
  for (const [k, v] of rows) console.log(`  ${v ? "✓" : "·"} ${k} = ${v || "(空)"}`);
  console.log(`  ${existsSync(ADS_TXT) ? "✓" : "·"} public/ads.txt ${existsSync(ADS_TXT) ? "存在" : "缺失"}`);
  const on = /^ca-pub-\d{10,20}$/.test((env.PUBLIC_ADSENSE_CLIENT ?? "").trim());
  console.log(`\n结论：广告 ${on ? "已启用（构建时会注入脚本与广告位）" : "未启用（构建产物零广告代码）"}`);
}

if (flags.has("check") || args.length === 0) {
  status();
  if (args.length === 0) {
    console.log("\n要开启广告：npm run ads:init -- ca-pub-你的16位数字");
  }
  process.exit(0);
}

if (!/^ca-pub-\d{10,20}$/.test(client)) {
  console.error("✗ 第一段参数必须是 ca-pub- 加 10~20 位数字，例如 ca-pub-1234567890123456");
  process.exit(1);
}
for (const [label, v] of [
  ["--article", article],
  ["--list", list],
]) {
  if (v && !/^\d{6,20}$/.test(v)) {
    console.error(`✗ ${label} 必须是纯数字的广告单元 id`);
    process.exit(1);
  }
}

const pubId = client.replace(/^ca-/, "");
writeFileSync(
  ADS_TXT,
  `# Google AdSense — 由 scripts/setup-adsense.mjs 生成，请勿手改\n` +
    `google.com, ${pubId}, DIRECT, ${CERT_AUTHORITY_ID}\n`,
  "utf8",
);

upsertEnv({
  PUBLIC_ADSENSE_CLIENT: client,
  PUBLIC_ADSENSE_SLOT_ARTICLE: article,
  PUBLIC_ADSENSE_SLOT_LIST: list,
});

console.log(`✓ 已写入 public/ads.txt → google.com, ${pubId}, DIRECT, ${CERT_AUTHORITY_ID}`);
console.log(`✓ 已更新 .env → PUBLIC_ADSENSE_CLIENT=${client}`);
if (article || list) console.log(`✓ 广告单元：article=${article || "(未设)"} list=${list || "(未设)"}`);

console.log(`
下一步（顺序别乱）：
  1. 本地验证：npm run build，然后在 dist/index.html 里搜 adsbygoogle —— 有就说明注入成功
  2. 上线开关：GitHub 仓库 → Settings → Secrets and variables → Actions → Variables，
     新增 PUBLIC_ADSENSE_CLIENT、PUBLIC_ADSENSE_SLOT_ARTICLE、PUBLIC_ADSENSE_SLOT_LIST
     （build 步骤已从 vars 读取；不配的话线上构建仍然是零广告）
  3. 推 main，等 Actions 部署完，访问 https://<域名>/ads.txt 确认能打开
  4. AdSense 后台「网站」→ 添加站点 → 提交审核（此时代码已在，Google 能验证到所有权）
  5. 过审后再去「广告 → 按广告单元」建两个单元，把 id 填进上面两个变量重新部署
  6. AdSense 后台「隐私权和消息」→ 开启 GDPR/EEA 同意消息（欧洲流量合规的硬要求）
`);
