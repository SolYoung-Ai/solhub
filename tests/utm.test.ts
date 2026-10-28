import { describe, expect, it } from "vitest";
import { buildUtmUrl } from "@/lib/tools/utm";

describe("UTM builder", () => {
  const params = { source: "google", medium: "cpc", campaign: "launch", term: "", content: "" };

  it("builds valid UTM url", () => {
    const r = buildUtmUrl("https://example.com/product", params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const u = new URL(r.url);
      expect(u.searchParams.get("utm_source")).toBe("google");
      expect(u.searchParams.get("utm_medium")).toBe("cpc");
      expect(u.searchParams.get("utm_campaign")).toBe("launch");
    }
  });

  it("preserves existing query params", () => {
    const r = buildUtmUrl("https://example.com/p?ref=friend", params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const u = new URL(r.url);
      expect(u.searchParams.get("ref")).toBe("friend");
      expect(u.searchParams.get("utm_source")).toBe("google");
    }
  });

  it("overrides same-name utm params", () => {
    const r = buildUtmUrl("https://example.com/?utm_source=old", params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const u = new URL(r.url);
      expect(u.searchParams.get("utm_source")).toBe("google");
    }
  });

  it("rejects invalid urls", () => {
    expect(buildUtmUrl("example.com/no-protocol", params).ok).toBe(false);
    expect(buildUtmUrl("ftp://example.com", params).ok).toBe(false);
    expect(buildUtmUrl("", params).ok).toBe(false);
  });

  it("requires source/medium/campaign", () => {
    expect(buildUtmUrl("https://example.com", { ...params, source: "" }).ok).toBe(false);
    expect(buildUtmUrl("https://example.com", { ...params, medium: "" }).ok).toBe(false);
    expect(buildUtmUrl("https://example.com", { ...params, campaign: "" }).ok).toBe(false);
  });

  it("adds term and content when provided", () => {
    const r = buildUtmUrl("https://example.com", { ...params, term: "t", content: "c" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const u = new URL(r.url);
      expect(u.searchParams.get("utm_term")).toBe("t");
      expect(u.searchParams.get("utm_content")).toBe("c");
    }
  });
});
