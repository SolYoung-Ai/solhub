#!/usr/bin/env node
/**
 * Cloudflare KV → CloudBase PostgreSQL 存量迁移
 * =============================================
 *
 * 用 Cloudflare KV REST API 拉取全部键值，批量写入 CloudBase PG 的 public.kv 表。
 *
 * 之所以直接调 REST API 而不是用 wrangler kv key get 逐个取：
 *   - wrangler 每次启动都要联网校验，一次 1~2 秒，36 个键要跑一分钟；
 *   - REST API 可以并发拉取，几十秒内跑完。
 *   OAuth token 从 wrangler 自己的配置里读（~/.config/.wrangler/config/default.toml
 *   或 ~/Library/Preferences/.wrangler/config/default.toml），不落盘到本仓库。
 *
 * 过期语义：CF KV 的 expiration（unix 秒）原样映射到 PG 的 expires_at。
 * 已经过期的键不迁（迁过去也是死数据）。
 *
 * 用法：
 *   node scripts/migrate-kv-to-pg.mjs            # 迁移
 *   node scripts/migrate-kv-to-pg.mjs --dry-run  # 只看会迁什么
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

/* @cloudbase/node-sdk 装在云函数目录里，这里从那个位置解析，
   避免在仓库根目录再装一份（同样的依赖装两遍只会让依赖树更难维护）。 */
const require = createRequire(path.resolve("cloudbase/functions/solhub-auth/package.json"));
const tcb = require("@cloudbase/node-sdk");

const CF_ACCOUNT = "01624aee8adc7c5730447831e3bb38ab";
const CF_NS = "bad8c625ab4846eb97b71b7166a3fab0";
const CF_API = "https://api.cloudflare.com/client/v4";

const dryRun = process.argv.includes("--dry-run");

/* ---------------------------------------------------------- 读 wrangler token */

function readWranglerToken() {
  const candidates = [
    path.join(os.homedir(), ".config", ".wrangler", "config", "default.toml"),
    path.join(os.homedir(), "Library", "Preferences", ".wrangler", "config", "default.toml"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const m = /oauth_token\s*=\s*"([^"]+)"/.exec(fs.readFileSync(file, "utf8"));
    if (m) return m[1];
  }
  throw new Error("找不到 wrangler 的 oauth_token，请先运行一次 `wrangler login`");
}

/* ------------------------------------------------------------ 读本地 API Key */

function readEnvFile(file) {
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  return Object.fromEntries(
    fs.readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

/* ------------------------------------------------------------------ CF 侧 API */

async function cfFetch(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`CF ${res.status} ${url}：${await res.text()}`);
  return res;
}

async function listKeys(token) {
  const out = [];
  let cursor = "";
  do {
    const url = `${CF_API}/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${CF_NS}/keys?limit=1000${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const body = await (await cfFetch(token, url)).json();
    if (!body.success) throw new Error(`CF 列表失败：${JSON.stringify(body.errors)}`);
    out.push(...body.result);
    cursor = body.result_info && body.result_info.cursor ? body.result_info.cursor : "";
  } while (cursor);
  return out;
}

async function getValue(token, key) {
  const url = `${CF_API}/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${CF_NS}/values/${encodeURIComponent(key)}`;
  return (await cfFetch(token, url)).text();
}

/* ------------------------------------------------------------------ 主流程 */

const token = readWranglerToken();
const local = readEnvFile(path.resolve("cloudbase/.env.local"));
const app = tcb.init({ env: local.TCB_ENV, accessKey: local.CLOUDBASE_APIKEY });
const db = app.rdb();

const keys = await listKeys(token);
console.log(`[migrate] Cloudflare KV 共 ${keys.length} 个键`);

const now = Date.now();
const todo = [];
const skipped = [];
for (const k of keys) {
  const exp = k.expiration ? Number(k.expiration) * 1000 : 0;
  if (exp && exp <= now) {
    skipped.push(`${k.name}（已过期）`);
    continue;
  }
  todo.push({ name: k.name, expiresAt: exp ? new Date(exp).toISOString() : null });
}

console.log(`[migrate] 待迁移 ${todo.length} 个，跳过 ${skipped.length} 个`);
if (skipped.length) console.log(`[migrate] 跳过明细：${skipped.join(", ")}`);

if (dryRun) {
  console.log("[migrate] dry-run 结束，未写入");
  process.exit(0);
}

/* 拉值：并发 8 */
const values = new Map();
let cursor = 0;
async function worker() {
  while (cursor < todo.length) {
    const item = todo[cursor++];
    try {
      values.set(item.name, await getValue(token, item.name));
    } catch (err) {
      console.error(`[migrate] 读取失败 ${item.name}：${err.message}`);
      values.set(item.name, null);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()));

/* 写库：分批 upsert */
let written = 0;
for (let i = 0; i < todo.length; i += 20) {
  const chunk = todo.slice(i, i + 20).filter((it) => values.get(it.name) !== null);
  for (const it of chunk) {
    const res = await db
      .from("kv")
      .upsert(
        {
          key: it.name,
          value: values.get(it.name),
          expires_at: it.expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    if (res.error) throw new Error(`写入 ${it.name} 失败：${res.error.message}`);
    written += 1;
  }
  process.stdout.write(`\r[migrate] 已写入 ${written}/${todo.length}`);
}
console.log(`\n[migrate] 完成，共写入 ${written} 个键`);
