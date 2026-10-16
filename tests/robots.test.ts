import { describe, expect, it } from "vitest";
import { buildRobots, robotsDefaultTemplate } from "@/lib/tools/robots";

describe("robots.txt generator", () => {
  it("builds basic rules", () => {
    const out = buildRobots([
      { userAgent: "*", allow: ["/"], disallow: ["/admin/"], crawlDelay: "1" },
    ]);
    expect(out).toContain("User-agent: *");
    expect(out).toContain("Allow: /");
    expect(out).toContain("Disallow: /admin/");
    expect(out).toContain("Crawl-delay: 1");
  });

  it("appends sitemap at the end", () => {
    const out = buildRobots([{ userAgent: "*", allow: ["/"], disallow: [] }]);
    expect(out).not.toContain("Sitemap:");
    const withSitemap = buildRobots([
      { userAgent: "*", allow: ["/"], disallow: [], sitemapUrl: "https://example.com/sitemap.xml" },
    ]);
    expect(withSitemap).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("skips empty rules", () => {
    const out = buildRobots([{ userAgent: "*", allow: [], disallow: [] }]);
    expect(out.trim()).toBe("");
  });

  it("supports multiple user agents", () => {
    const out = buildRobots([
      { userAgent: "*", allow: ["/"], disallow: [] },
      { userAgent: "Googlebot", allow: ["/public"], disallow: [] },
    ]);
    expect(out).toContain("User-agent: Googlebot");
  });

  it("default template is valid output", () => {
    const parsed = buildRobots([
      { userAgent: "*", allow: ["/"], disallow: ["/admin/", "/private/"] },
    ]);
    expect(parsed).toContain("Disallow: /admin/");
    expect(robotsDefaultTemplate).toContain("Disallow: /admin/");
  });
});
