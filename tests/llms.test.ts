import { describe, expect, it } from "vitest";
import { buildLlms } from "@/lib/tools/llms";

describe("llms.txt generator", () => {
  it("builds valid llms.txt", () => {
    const r = buildLlms({
      siteName: "SolHub",
      siteUrl: "https://example.com",
      intro: "产品发现平台。",
      pages: [
        { url: "/products/", title: "产品榜单", detail: "发现好产品" },
        { url: "/tools/", title: "在线工具" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain("# SolHub");
      expect(r.output).toContain("[产品榜单](https://example.com/products/): 发现好产品");
      expect(r.output).toContain("[在线工具](https://example.com/tools/)");
    }
  });

  it("requires name and url", () => {
    expect(buildLlms({ siteName: "", siteUrl: "", intro: "", pages: [] }).ok).toBe(false);
    expect(buildLlms({ siteName: "x", siteUrl: "not-a-url", intro: "", pages: [] }).ok).toBe(false);
  });

  it("deduplicates pages", () => {
    const r = buildLlms({
      siteName: "S",
      siteUrl: "https://example.com",
      intro: "",
      pages: [
        { url: "/a", title: "A" },
        { url: "/a", title: "A again" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.output.match(/\[A/g) ?? []).length).toBe(1);
  });
});
