import { describe, expect, it } from "vitest";
import { buildJsonLd } from "@/lib/tools/jsonld";

describe("JSON-LD generator", () => {
  it("builds Organization schema", () => {
    const r = buildJsonLd({
      type: "Organization",
      name: "SolHub",
      url: "https://example.com",
      description: "产品平台",
      logo: "https://example.com/logo.png",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.output);
      expect(parsed["@type"]).toBe("Organization");
      expect(parsed.name).toBe("SolHub");
      expect(parsed.logo).toBe("https://example.com/logo.png");
      expect(r.validation.some((v) => v.includes("通过"))).toBe(true);
    }
  });

  it("builds WebSite with SearchAction", () => {
    const r = buildJsonLd({
      type: "WebSite",
      name: "SolHub",
      url: "https://example.com",
      description: "",
      searchTemplate: "https://example.com/search?q={search_term_string}",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.output) as { potentialAction: { "@type": string } };
      expect(parsed.potentialAction["@type"]).toBe("SearchAction");
    }
  });

  it("builds SoftwareApplication with offer", () => {
    const r = buildJsonLd({
      type: "SoftwareApplication",
      name: "Tool",
      url: "https://example.com/tool",
      description: "",
      offersPrice: "0",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const parsed = JSON.parse(r.output) as { offers: { price: string; priceCurrency: string } };
      expect(parsed.offers.price).toBe("0");
      expect(parsed.offers.priceCurrency).toBe("CNY");
    }
  });

  it("rejects missing/invalid url", () => {
    expect(buildJsonLd({ type: "Organization", name: "", url: "", description: "" }).ok).toBe(false);
    expect(buildJsonLd({ type: "Organization", name: "x", url: "bad", description: "" }).ok).toBe(false);
  });

  it("output is always valid JSON", () => {
    const r = buildJsonLd({ type: "Organization", name: "x", url: "https://x.com", description: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(() => JSON.parse(r.output)).not.toThrow();
  });
});
