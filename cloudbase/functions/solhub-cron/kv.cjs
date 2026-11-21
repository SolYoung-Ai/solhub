/*
 * ⚠️ 本文件由 scripts/sync-cloudbase-fn.mjs 从 cloudbase/functions/solhub-auth/ 复制，
 *    请勿直接编辑；改存储层请改 solhub-auth/ 下的源文件再执行同步脚本。
 */
/**
 * KV 兼容层 · 驱动选择器
 * =====================================================
 *
 * 业务代码（core.cjs）只认 `env.PROFILES` 的 Workers KV 接口，实际落到哪种
 * 数据库由这里决定，用环境变量切换、不改一行代码：
 *
 *   KV_DRIVER=pg       PostgreSQL（默认；按 0.2 核常驻计费，一个月约 4.9 万点）
 *   KV_DRIVER=nosql    CloudBase 文档型数据库（按调用次数计费，容量近乎免费）
 *
 * 两个驱动都必须实现同样的两个工厂：
 *   createKV()     → get / put / delete / list（Workers KV 形状，业务用）
 *   createStore()  → dumpAll / writeSnapshot / readSnapshot / …（备份与运维用）
 *
 * 切换步骤、数据搬迁工具与回滚办法见 cloudbase/README-kv-driver.md。
 *
 * 为什么默认仍是 pg：线上环境目前是 PG 实例（环境创建时定的，一个环境只能有
 * 一种数据库）。文档型要新建环境后才能用，所以默认值必须保持现状 —— 否则
 * 一次误部署就会让线上全部 404。
 */

const RAW = String(process.env.KV_DRIVER || "pg").trim().toLowerCase();

/** 别名收敛：文档库在不同文档里有多种叫法，一律当 nosql */
const DRIVER = ["nosql", "document", "documentdb", "mongodb", "mongo"].includes(RAW) ? "nosql" : "pg";

if (RAW !== DRIVER) {
  console.warn(`[kv] 未知的 KV_DRIVER="${RAW}"，已按 ${DRIVER} 处理`);
}

const impl = DRIVER === "nosql" ? require("./kv-nosql.cjs") : require("./kv-pg.cjs");

console.log(`[kv] 存储驱动 = ${DRIVER}（KV_DRIVER=${RAW}）`);

module.exports = {
  createKV: () => impl.createKV(),
  createStore: () => impl.createStore(),
  driver: () => DRIVER,
};
