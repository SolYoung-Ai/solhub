import { describe, expect, it } from "vitest";
import { calculateAspect } from "@/lib/tools/aspect";

describe("Aspect ratio calculator", () => {
  it("computes height from width and ratio", () => {
    const r = calculateAspect({ width: "1920", ratio: "16:9" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.height).toBe(1080);
      expect(r.result.width).toBe(1920);
      expect(r.result.isLandscape).toBe(true);
    }
  });

  it("computes width from height and ratio", () => {
    const r = calculateAspect({ height: "1080", ratio: "16:9" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.width).toBe(1920);
  });

  it("derives ratio from width and height", () => {
    const r = calculateAspect({ width: "1000", height: "1000" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.ratio).toBe("1:1");
  });

  it("rejects insufficient input", () => {
    expect(calculateAspect({ width: "100" }).ok).toBe(false);
    expect(calculateAspect({ ratio: "16:9" }).ok).toBe(false);
    expect(calculateAspect({}).ok).toBe(false);
  });

  it("rejects non-positive values", () => {
    expect(calculateAspect({ width: "-5", height: "10" }).ok).toBe(false);
  });

  it("recognizes common ratios", () => {
    const r = calculateAspect({ width: "1280", height: "720" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.ratio).toBe("16:9");
  });
});
