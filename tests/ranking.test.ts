import { describe, expect, it } from "vitest";
import { rankProducts } from "@/lib/ranking";
import { products } from "@/data/products";

describe("Ranking", () => {
  it("puts verified before unverified", () => {
    const ranked = rankProducts(products);
    const verifiedIdx = ranked.findIndex((p) => p.verificationStatus === "verified");
    const unverifiedIdx = ranked.findIndex((p) => p.verificationStatus === "unverified");
    expect(verifiedIdx).toBeGreaterThanOrEqual(0);
    expect(unverifiedIdx).toBeGreaterThan(verifiedIdx);
  });

  it("puts demo products last", () => {
    const ranked = rankProducts(products);
    const lastReal = ranked.map((p) => p.isDemo).lastIndexOf(false);
    const firstDemo = ranked.findIndex((p) => p.isDemo);
    expect(firstDemo).toBeGreaterThan(lastReal);
  });

  it("respects rankPosition order", () => {
    const ranked = rankProducts(products);
    const withRank = ranked.filter((p) => p.rankPosition !== undefined);
    for (let i = 1; i < withRank.length; i++) {
      expect(withRank[i].rankPosition! >= withRank[i - 1].rankPosition!).toBe(true);
    }
  });

  it("keeps all products", () => {
    expect(rankProducts(products)).toHaveLength(products.length);
  });
});
