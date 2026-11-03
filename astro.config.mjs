import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// 部署路径适配：
// - 自定义域名根路径部署（如 https://solyoung.top/）：BASE_PATH=/ 或不设置
// - GitHub Pages 项目站点（如 https://SolYoung-work.github.io/solhub/）：BASE_PATH=/solhub/
// GitHub Actions 工作流会自动计算 BASE_PATH，本地开发默认 "/"
const SITE = process.env.ASTRO_SITE ?? "https://solhub.solyoung.top";
const BASE = process.env.BASE_PATH ?? "/";

/* 不进 sitemap 的页面：后台、登录/注册、个人中心、表单页。
 * 这些页面在 <meta robots> 里已经标了 noindex，若同时又出现在 sitemap 里，
 * 等于一边告诉搜索引擎「别收录」、一边主动提交地址，是自相矛盾的信号；
 * 后台地址（/guanli/）更不该出现在公开的 sitemap 中。 */
const SITEMAP_EXCLUDE = [
  "/admin/",
  "/guanli/",
  "/account/",
  "/login/",
  "/forgot-password/",
  "/my-submissions/",
  "/submit/",
];

const sitemapFilter = (page) => {
  try {
    const path = new URL(page).pathname;
    /* 去掉 base 前缀与语言前缀后再比对，/en/login/ 与 /login/ 一并排除 */
    const rest = BASE !== "/" && path.startsWith(BASE) ? path.slice(BASE.length - 1) : path;
    const normalized = rest.replace(/^\/en(?=\/|$)/, "") || "/";
    const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
    return !SITEMAP_EXCLUDE.includes(withSlash);
  } catch {
    return true;
  }
};

export default defineConfig({
  site: SITE,
  base: BASE,
  output: "static",
  trailingSlash: "always",
  compressHTML: true,
  integrations: [react(), sitemap({ filter: sitemapFilter })],
  vite: {
    plugins: [tailwindcss()],
  },
});
