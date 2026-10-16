import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// 部署路径适配：
// - 自定义域名根路径部署（如 https://solyoung.top/）：BASE_PATH=/ 或不设置
// - GitHub Pages 项目站点（如 https://SolYoung-work.github.io/solhub/）：BASE_PATH=/solhub/
// GitHub Actions 工作流会自动计算 BASE_PATH，本地开发默认 "/"
const SITE = process.env.ASTRO_SITE ?? "https://solyoung.top";
const BASE = process.env.BASE_PATH ?? "/";

export default defineConfig({
  site: SITE,
  base: BASE,
  output: "static",
  trailingSlash: "always",
  compressHTML: true,
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
