/**
 * SolHub 热点抓取 —— CloudBase Event Function（定时触发）
 * =====================================================
 *
 * 每 15 分钟跑一轮：抓 10 个中文科技媒体的 RSS，合并进 public.kv 的 hot:v1，
 * 前端 /hot 页按 60 秒轮询读它。
 *
 * 为什么用定时函数而不是「请求时现抓」：
 *   RSS 一轮要 10 秒上下（最慢的源 4~16 秒），放请求链路上会让页面白屏十几秒，
 *   而且每个访客都触发一次等于把人家服务器当自家缓存用。定时抓 + 落库，
 *   访客读的只是一个 60 秒实例缓存的 JSON。
 *
 * 为什么要合并而不是覆盖：
 *   每轮各源只吐最新的几十条。若直接覆盖，某个源临时 502 或某轮抓空了，
 *   已经展示出来的内容会当场消失。collectHot() 会把新条目并进旧列表，
 *   所以单轮失败不影响已发布内容 —— 只有超过 72 小时的旧条目才会被清掉。
 *
 * 手动调用：{ "action": "hot" } 立刻抓一轮；{ "action": "hot", "dryRun": true }
 * 只抓不写库（看抓取结果和源健康度用）。
 */

const { webcrypto } = require("node:crypto");
const { createKV } = require("./kv.cjs");
const { collectHot } = require("./hot.cjs");

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

/** 热点数据在 kv 表里的键；改结构时升版本号，旧键留给回滚 */
const KEY = "hot:v1";

exports.main = async (event) => {
  const startedAt = Date.now();
  const e = event || {};
  const dryRun = !!e.dryRun;

  const env = { ...process.env, PROFILES: createKV() };

  let old = [];
  try {
    const raw = await env.PROFILES.get(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) old = parsed.items;
    }
  } catch (err) {
    /* 旧值读不出来不该阻断抓取：最坏是这一轮当作首次抓取，条目从头积累 */
    console.error("[hot] 读取旧数据失败:", (err && err.message) || err);
  }

  let result;
  try {
    result = await collectHot({ old });
  } catch (err) {
    console.error("[hot] 抓取失败:", err && err.stack ? err.stack : err);
    return { ok: false, error: String((err && err.message) || err) };
  }

  const okFeeds = result.feeds.filter((f) => f.ok);
  const payload = {
    fetchedAt: result.fetchedAt,
    total: result.total,
    items: result.items,
  };

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      total: result.total,
      feeds: result.feeds,
      sample: result.items.slice(0, 5).map((x) => `${x.sourceName}｜${x.title}`),
      elapsed: Date.now() - startedAt,
    };
  }

  /* 全军覆没时不写库：写进去就是一次「清空」，比不更新糟得多。
     部分源失败照常写，失败情况挂在返回值里便于排查。 */
  if (!okFeeds.length) {
    return { ok: false, error: "所有源都抓取失败，保留旧数据未覆盖", feeds: result.feeds };
  }

  try {
    await env.PROFILES.put(KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("[hot] 写库失败:", err && err.stack ? err.stack : err);
    return { ok: false, error: String((err && err.message) || err), total: result.total };
  }

  console.log(
    `[hot] 写入 ${result.total} 条（${okFeeds.length}/${result.feeds.length} 源成功），耗时 ${Date.now() - startedAt}ms`,
  );

  return {
    ok: true,
    total: result.total,
    fresh: result.total - old.length,
    feeds: result.feeds,
    elapsed: Date.now() - startedAt,
  };
};
