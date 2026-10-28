import { describe, expect, it } from "vitest";
import { rankProducts } from "@/lib/ranking";
import { products } from "@/data/products";
import type { Product } from "@/data/types";

/** 构造独立测试数据，不依赖真实产品列表内容。 */
function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: "p",
    slug: "p",
    name: "P",
    shortDescription: "d",
    description: "d",
    websiteUrl: "https://example.com",
    category: "ai-tools",
    tags: [],
    developerName: "D",
    publishedAt: "2026-10-16",
    launchBatch: "W42",
    verificationStatus: "unverified",
    isDemo: false,
    ...overrides,
  };
}

describe("Ranking", () => {
  it("puts verified before unverified", () => {
    const ranked = rankProducts([
      makeProduct({ id: "a", slug: "a", verificationStatus: "unverified" }),
      makeProduct({ id: "b", slug: "b", verificationStatus: "verified" }),
    ]);
    expect(ranked[0].verificationStatus).toBe("verified");
    expect(ranked[1].verificationStatus).toBe("unverified");
  });

  it("puts demo products last", () => {
    const ranked = rankProducts([
      makeProduct({ id: "a", slug: "a", isDemo: false }),
      makeProduct({ id: "b", slug: "b", isDemo: true }),
    ]);
    expect(ranked[0].isDemo).toBe(false);
    expect(ranked[1].isDemo).toBe(true);
  });

  it("respects rankPosition order", () => {
    const ranked = rankProducts([
      makeProduct({ id: "a", slug: "a", rankPosition: 3 }),
      makeProduct({ id: "b", slug: "b", rankPosition: 1 }),
      makeProduct({ id: "c", slug: "c", rankPosition: 2 }),
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps all products", () => {
    expect(rankProducts(products)).toHaveLength(products.length);
  });

  it("all current real products are verified and non-demo", () => {
    // 数据诚实性约束：当前收录产品必须真实核验、无演示占位
    for (const p of products) {
      expect(p.isDemo).toBe(false);
      expect(p.verificationStatus).toBe("verified");
    }
  });
});
