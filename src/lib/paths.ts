/**
 * 路径工具：统一处理 GitHub Pages 子路径部署（base）与语言前缀。
 * 所有站内链接都必须经过 p()，不能硬编码 "/xxx"。
 * 语言规则：zh 无前缀（/solhub/xxx），en 带 /en 前缀（/solhub/en/xxx）。
 */
import type { Locale } from "@/i18n";

export function baseUrl(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

/** 生成站内链接（自动带上 base 与语言前缀） */
export function p(path: string, locale: Locale = "zh"): string {
  const cleanBase = baseUrl();
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const langPrefix = locale === "en" ? "en/" : "";
  return cleanBase + langPrefix + cleanPath;
}

/** 把当前 pathname 还原为无 base、无语言前缀的路由（用于导航激活状态） */
export function stripBase(pathname: string): string {
  const base = baseUrl();
  let rest = pathname;
  if (base !== "/") {
    const cleanBase = base.replace(/\/$/, "");
    if (pathname === cleanBase || pathname === cleanBase + "/") rest = "/";
    else if (pathname.startsWith(cleanBase + "/")) rest = pathname.slice(cleanBase.length);
  }
  // 去掉 en 语言前缀
  if (rest === "/en" || rest === "/en/") return "/";
  if (rest.startsWith("/en/")) return rest.slice(3);
  return rest;
}

/** 从 pathname 推断当前语言（en 前缀 → en，否则 zh） */
export function localeFromPath(pathname: string): Locale {
  const base = baseUrl();
  let rest = pathname;
  if (base !== "/") {
    const cleanBase = base.replace(/\/$/, "");
    if (pathname.startsWith(cleanBase + "/")) rest = pathname.slice(cleanBase.length);
    else if (pathname === cleanBase) rest = "/";
  }
  if (rest === "/en" || rest.startsWith("/en/")) return "en";
  return "zh";
}

/** 把路由转为另一语言的路由（用于语言切换按钮）。route 为无 base 无语言前缀的路由。 */
export function langHref(route: string, target: Locale): string {
  return p(route, target);
}

/** 生成绝对 URL（用于 canonical / OG / sitemap，含语言前缀）
 *
 * 站点地址的取值顺序（**不要改动，猜错会把整站 canonical 指到别的域名**）：
 *   1. ASTRO_SITE 环境变量（临时切域名/预览部署时用）
 *   2. import.meta.env.SITE —— Astro 由 astro.config.mjs 的 `site` 自动注入
 *   3. 兜底常量，与 astro.config.mjs 里 SITE 的默认值保持一致
 *
 * 历史坑：早先这里只读 ASTRO_SITE，而 CI 没有设置该变量，于是所有页面
 * 的 canonical / og:url / hreflang 都退化成 https://solyoung.top/（另一个站点），
 * 等于把 SolHub 的每个页面都声明成别人的标准地址 —— 搜索引擎会拒绝收录。
 */
export function absoluteUrl(path: string, locale: Locale = "zh"): string {
  const site =
    (import.meta.env.ASTRO_SITE as string | undefined) ||
    (import.meta.env.SITE as string | undefined) ||
    "https://solhub.solyoung.top";
  const base = baseUrl();
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const langPrefix = locale === "en" ? "en/" : "";
  return `${site.replace(/\/$/, "")}${base}${langPrefix}${cleanPath}`;
}
