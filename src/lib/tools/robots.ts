/** robots.txt 生成纯逻辑 */

export interface RobotsRule {
  /** 用户代理；默认 *（所有爬虫） */
  userAgent: string;
  allow: string[];
  disallow: string[];
  /** 抓取延迟（秒，可选；部分搜索引擎不支持） */
  crawlDelay?: string;
  sitemapUrl?: string;
}

export const robotsDefaultRule: RobotsRule = {
  userAgent: "*",
  allow: ["/"],
  disallow: [],
};

export function buildRobots(rules: RobotsRule[]): string {
  const lines: string[] = [];
  for (const rule of rules) {
    if (rule.allow.length === 0 && rule.disallow.length === 0) continue;
    lines.push(`User-agent: ${rule.userAgent || "*"}`);
    for (const a of rule.allow) if (a.trim()) lines.push(`Allow: ${a.trim()}`);
    for (const d of rule.disallow) if (d.trim()) lines.push(`Disallow: ${d.trim()}`);
    if (rule.crawlDelay?.trim()) lines.push(`Crawl-delay: ${rule.crawlDelay.trim()}`);
    lines.push("");
  }
  for (const rule of rules) {
    if (rule.sitemapUrl?.trim()) {
      lines.push(`Sitemap: ${rule.sitemapUrl.trim()}`);
    }
  }
  return lines.join("\n").trim() + "\n";
}

export const robotsDefaultTemplate = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /private/
`;

/** robots.txt 说明（用于页面展示，不构成 SEO 承诺） */
export const robotsExplanations: { title: string; detail: string }[] = [
  { title: "它是规范，不是指令", detail: "robots.txt 是给搜索引擎爬虫的访问建议，遵守与否由爬虫决定，不能用来隐藏敏感页面。" },
  { title: "Disallow 不等于不收录", detail: "Disallow 只是阻止抓取，页面仍可能因外部链接被收录（只是没有正文内容）。" },
  { title: "Sitemap 配合使用", detail: "在 robots.txt 中声明 Sitemap 可以帮助爬虫更快发现新页面。" },
  { title: "部分指令支持不一", detail: "Crawl-delay 等指令并非所有搜索引擎都支持。" },
];
