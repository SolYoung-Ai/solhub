/**
 * 以官方账号身份在世界里发布一条手动公告（**不再默认每次更新都发**）。
 *
 * 现在的自动发帖由 Worker 负责：
 *   · 用户上传新产品 → 官方自动播报（/publish 内触发）
 *   · 每天两次随机推荐社区产品 → Worker cron（北京时间 10:00 / 20:00）
 *
 * 只有需要发「重要公告」时才手动跑这个脚本。
 *
 * 用法：
 *   node scripts/changelog.mjs "公告内容"
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
