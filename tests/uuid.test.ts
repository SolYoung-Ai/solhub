import { describe, expect, it } from "vitest";
import { generateUuidV4, generateUuids } from "@/lib/tools/uuid";

describe("UUID generator", () => {
  it("produces valid v4 format", () => {
    const u = generateUuidV4();
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique ids in batch", () => {
    const list = generateUuids(100);
    expect(list).toHaveLength(100);
    expect(new Set(list).size).toBe(100);
  });

  it("clamps batch count", () => {
    expect(generateUuids(0)).toHaveLength(1);
    expect(generateUuids(99999)).toHaveLength(5000);
  });
});
