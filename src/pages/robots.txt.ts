import type { APIRoute } from "astro";
import { baseUrl } from "@/lib/paths";

/** 动态生成 robots.txt，Sitemap 地址自动带上 base 前缀 */
export const GET: APIRoute = ({ site }) => {
  const base = baseUrl();
  // Astro 的 site 是 URL 对象；toString 后去掉末尾斜杠再拼接 base
  // 兜底值与 astro.config.mjs 的 SITE 默认值保持一致（写成 solyoung.top 会把 sitemap 指到别的站）
  const host = (site ? site.toString() : "https://solhub.solyoung.top").replace(/\/$/, "");
  const sitemapUrl = `${host}${base}sitemap-index.xml`;
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};

export const prerender = true;
