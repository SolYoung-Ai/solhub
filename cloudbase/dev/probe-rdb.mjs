/**
 * 探针：验证 @cloudbase/node-sdk 的 app.rdb() 对 public.kv 的实际行为。
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

function show(label, res) {
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(res, (k, v) => (k === "error" && v ? { message: v.message, code: v.code, details: v.details } : v), 2));
}

const T = `probe:${Date.now()}`;

// 1. insert
show("insert", await db.from("kv").insert({ key: `${T}:a`, value: "v1" }));

// 2. select eq
show("select eq", await db.from("kv").select("*").eq("key", `${T}:a`));

// 3. upsert onConflict
show("upsert", await db.from("kv").upsert({ key: `${T}:a`, value: "v2" }, { onConflict: "key" }));

// 4. select after upsert
show("select after upsert", await db.from("kv").select("*").eq("key", `${T}:a`));

// 5. select in (批量读)
show("select in", await db.from("kv").select("key,value").in("key", [`${T}:a`, `${T}:b`]));

// 6. like prefix
await db.from("kv").insert({ key: `${T}:b`, value: "vb" });
show("select like prefix", await db.from("kv").select("key").like("key", `${T}*`));

// 7. order + limit
show("select like order limit", await db.from("kv").select("key").like("key", `${T}*`).order("key", { ascending: true }).limit(10));

// 8. expires_at 过滤（or）
show("select or expires", await db.from("kv").select("key").like("key", `${T}*`).or("expires_at.is.null,expires_at.gt.2020-01-01T00:00:00Z"));

// 9. 带 expires_at 的 insert
show("insert with expires", await db.from("kv").insert({ key: `${T}:c`, value: "vc", expires_at: new Date(Date.now() + 60000).toISOString() }));

// 10. delete
show("delete", await db.from("kv").delete().eq("key", `${T}:c`));

// 11. 清理
await db.from("kv").delete().like("key", `${T}*`);
show("cleanup done", await db.from("kv").select("key").like("key", `${T}*`));

// 12. 单条 select 报错的形态（不存在的 key）
show("select missing", await db.from("kv").select("*").eq("key", `${T}:zzz`));
