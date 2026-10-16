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

/** 生成绝对 URL（用于 canonical / OG / sitemap，含语言前缀） */
export function absoluteUrl(path: string, locale: Locale = "zh"): string {
  const site = import.meta.env.ASTRO_SITE
    ? import.meta.env.ASTRO_SITE
    : "https://solyoung.top";
  const base = baseUrl();
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const langPrefix = locale === "en" ? "en/" : "";
  return `${site.replace(/\/$/, "")}${base}${langPrefix}${cleanPath}`;
}
