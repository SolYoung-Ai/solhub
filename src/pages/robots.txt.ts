import type { APIRoute } from "astro";
import { baseUrl } from "@/lib/paths";

/** 动态生成 robots.txt，Sitemap 地址自动带上 base 前缀 */
export const GET: APIRoute = ({ site }) => {
  const base = baseUrl();
  // Astro 的 site 是 URL 对象；toString 后去掉末尾斜杠再拼接 base
  const host = (site ? site.toString() : "https://solyoung.top").replace(/\/$/, "");
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
