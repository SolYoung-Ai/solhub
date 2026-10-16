/**
 * 路径工具：统一处理 GitHub Pages 子路径部署（base）问题。
 * 所有站内链接都必须经过 p()，不能硬编码 "/xxx"。
 */

export function baseUrl(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

/** 生成站内链接（自动带上 base 前缀） */
export function p(path: string): string {
  const cleanBase = baseUrl();
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return cleanBase + cleanPath;
}

/** 把当前 pathname 还原为无 base 的路由（用于导航激活状态） */
export function stripBase(pathname: string): string {
  const base = baseUrl();
  if (base === "/") return pathname;
  const cleanBase = base.replace(/\/$/, "");
  if (pathname === cleanBase || pathname === cleanBase + "/") return "/";
  if (pathname.startsWith(cleanBase + "/")) return pathname.slice(cleanBase.length);
  return pathname;
}

/** 生成绝对 URL（用于 canonical / OG / sitemap） */
export function absoluteUrl(path: string): string {
  const site = import.meta.env.ASTRO_SITE
    ? import.meta.env.ASTRO_SITE
    : "https://solyoung.top";
  const base = baseUrl();
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${site.replace(/\/$/, "")}${base}${cleanPath}`;
}
