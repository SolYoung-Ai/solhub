/**
 * 批量把 DNS 记录写入 Cloudflare（幂等 upsert）。
 *
 * 用途：阿里云邮件推送发信域名需要配 6 条 DNS 记录，
 * 在 Cloudflare 控制台手工点 6 次很繁琐，本脚本一次搞定。
 *
 * 用法：
 *   CLOUDFLARE_API_TOKEN=<你的 token> node scripts/cf-dns-apply.mjs <records.json>
 *
 * records.json 格式：
 *   {
 *     "zone": "solyoung.top",
 *     "records": [
 *       { "type": "TXT", "name": "aliyundm.mail", "content": "e000a000b000c000d9" },
 *       { "type": "MX", "name": "mail", "content": "mx01.dm.aliyun.com", "priority": 10 }
 *     ]
 *   }
 *
 * 注意：
 *   - name 用相对 zone 的写法（mail = mail.solyoung.top），脚本会自动补全为 FQDN。
 *   - 同名同类型的旧记录会被删除后重建，保证幂等。
 *   - MX 的 content 后面如果已带优先级（"mx01.dm.aliyun.com 10"）会正确拆分。
 */
import { readFileSync } from "node:fs";

const CF_API = "https://api.cloudflare.com/client/v4";

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("缺少环境变量 CLOUDFLARE_API_TOKEN");
  process.exit(1);
}
const file = process.argv[2];
if (!file) {
  console.error("用法: CLOUDFLARE_API_TOKEN=xxx node scripts/cf-dns-apply.mjs <records.json>");
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(file, "utf8"));
const zoneName = cfg.zone;
const records = cfg.records || [];

async function api(path, method = "GET", body) {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    const msg = (data.errors || []).map((e) => `${e.code}:${e.message}`).join("; ");
    throw new Error(`${method} ${path} → ${msg || "unknown error"}`);
  }
  return data.result;
}

function fqdn(name, zone) {
  const n = String(name || "").trim();
  if (!n || n === "@") return zone;
  if (n.endsWith(`.${zone}`) || n === zone) return n;
  return `${n}.${zone}`;
}

/** 拆出 MX 的优先级：content 可能是 "mx01.dm.aliyun.com" 或 "mx01.dm.aliyun.com 10" */
function splitMx(content) {
  const parts = String(content).trim().split(/\s+/);
  if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
    return { content: parts[0], priority: Number(parts[1]) };
  }
  return { content: parts[0], priority: 10 };
}

const zone = await api(`/zones?name=${encodeURIComponent(zoneName)}`);
if (!zone.length) throw new Error(`找不到 zone: ${zoneName}`);
const zoneId = zone[0].id;
console.log(`zone: ${zoneName}  id: ${zoneId}\n`);

let created = 0;
let removed = 0;
let failed = 0;

for (const r of records) {
  const type = String(r.type || "").toUpperCase();
  const name = fqdn(r.name, zoneName);
  let content = String(r.content ?? "");
  let priority;

  if (type === "MX") {
    const m = splitMx(content);
    content = m.content;
    priority = r.priority ?? m.priority;
  }

  // 幂等：先删掉同名同类型的旧记录
  const existing = await api(
    `/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}&per_page=100`,
  );
  for (const ex of existing) {
    await api(`/zones/${zoneId}/dns_records/${ex.id}`, "DELETE");
    removed++;
  }

  const body = {
    type,
    name,
    content,
    ttl: r.ttl ?? 300,
    proxied: type === "CNAME" ? !!r.proxied : false,
  };
  if (type === "MX") body.priority = priority;

  try {
    await api(`/zones/${zoneId}/dns_records`, "POST", body);
    created++;
    console.log(`  ✅ ${type.padEnd(5)} ${name.padEnd(34)} → ${content.slice(0, 68)}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${type.padEnd(5)} ${name.padEnd(34)} → ${e.message}`);
  }
}

console.log(`\n新增 ${created} 条，清理旧记录 ${removed} 条，失败 ${failed} 条`);

// 回读校验
console.log("\n=== 回读校验 ===");
const all = await api(`/zones/${zoneId}/dns_records?per_page=100`);
const mine = new Set(records.map((r) => `${r.type.toUpperCase()}|${fqdn(r.name, zoneName)}`));
for (const rec of all) {
  if (mine.has(`${rec.type}|${rec.name}`)) {
    console.log(`  ${rec.type.padEnd(5)} ${rec.name.padEnd(34)} → ${String(rec.content).slice(0, 68)}`);
  }
}
