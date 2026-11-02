/**
 * 探针 2：验证前缀扫描 / 范围扫描 / or 过滤器的实际行为。
 * 一次性调试脚本，不参与部署。
 */
import fs from "node:fs";
import tcb from "@cloudbase/node-sdk";

const envFile = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  envFile.split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const app = tcb.init({ env: env.TCB_ENV, accessKey: env.CLOUDBASE_APIKEY });
const db = app.rdb();
const T = `probe2:${Date.now()}`;

async function ins(key, value = "x") {
  await db.from("kv").upsert({ key, value, expires_at: null, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
function keys(res) {
  return (res.data || []).map((r) => r.key);
}
async function q(label, fn) {
  const res = await fn();
  console.log(label, "=>", JSON.stringify(keys(res)), "error:", res.error ? res.error.message : null);
}

await ins(`${T}:user:a`);
await ins(`${T}:user:b`);
await ins(`${T}:users:c`);
await ins(`${T}:user_x:d`);
await ins(`${T}:user:e`, "expired");
await db.from("kv").upsert({ key: `${T}:user:e`, value: "expired", expires_at: new Date(Date.now() - 1000).toISOString(), updated_at: new Date().toISOString() }, { onConflict: "key" });

const prefix = `${T}:user:`;

await q("A. like prefix", () => db.from("kv").select("key").like("key", `${prefix}*`));
await q("B. gte/lt range", () => db.from("kv").select("key").gte("key", prefix).lt("key", `${prefix}￿`));
await q("C. gte/lt range 10FFFF", () => db.from("kv").select("key").gte("key", prefix).lt("key", `${prefix}\u{10FFFF}`));
await q("D. like + or(expires)", () =>
  db.from("kv").select("key").like("key", `${prefix}*`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`));
await q("E. gte/lt + or(expires)", () =>
  db.from("kv").select("key").gte("key", prefix).lt("key", `${prefix}￿`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`));
await q("F. in + or(expires)", () =>
  db.from("kv").select("key,value").in("key", [`${T}:user:a`, `${T}:user:e`]).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`));
await q("G. like with underscore escape", () => db.from("kv").select("key").like("key", `${T}:user\\_x*`));
await q("H. order+limit+like", () => db.from("kv").select("key").like("key", `${prefix}*`).order("key", { ascending: true }).limit(2));
await q("I. gt cursor", () => db.from("kv").select("key").like("key", `${prefix}*`).gt("key", `${T}:user:a`).order("key", { ascending: true }));
await q("J. eq + or(expires) 单键", () =>
  db.from("kv").select("value,expires_at").eq("key", `${T}:user:e`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`));

// 清理
await db.from("kv").delete().like("key", `${T}*`);
console.log("cleanup ok");
