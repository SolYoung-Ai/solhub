/**
 * 以官方账号身份在世界里发布一条产品更新日志。
 *
 * 用法：
 *   node scripts/changelog.mjs "本次更新内容"
 *   或在 CI 中通过环境变量传入：CHANGELOG_TEXT=... node scripts/changelog.mjs
 *
 * 依赖 scripts/official.mjs（负责确保官方账号存在并登录）。
 */

import { postChangelog } from "./official.mjs";

const text = (process.argv.slice(2).join(" ").trim() || process.env.CHANGELOG_TEXT || "").trim();
if (!text) {
  console.error("用法: node scripts/changelog.mjs \"更新内容\"");
  process.exit(1);
}

try {
  const res = await postChangelog(text);
  console.log("✓ 已以官方账号发布更新日志:", res?.post?.id || "");
} catch (e) {
  console.error("✗ 发布失败:", e.message);
  process.exit(1);
}
