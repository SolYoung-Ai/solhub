import { describe, expect, it } from "vitest";
import {
  parseHex,
  parseRgb,
  parseHsl,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  parseAny,
} from "@/lib/tools/color";

describe("Color converter", () => {
  it("parses 6-digit hex", () => {
    const r = parseHex("#E87028");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rgb).toEqual({ r: 232, g: 112, b: 40 });
    }
  });

  it("parses 3-digit hex", () => {
    const r = parseHex("#fff");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rgb).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("rejects invalid hex", () => {
    expect(parseHex("#12345").ok).toBe(false);
    expect(parseHex("zzz").ok).toBe(false);
  });

  it("parses rgb()", () => {
    const r = parseRgb("rgb(232, 112, 40)");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rgb).toEqual({ r: 232, g: 112, b: 40 });
  });

  it("rejects out-of-range rgb", () => {
    expect(parseRgb("rgb(300, 0, 0)").ok).toBe(false);
  });

  it("parses hsl()", () => {
    const r = parseHsl("hsl(24, 79%, 53%)");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.hsl.h).toBeCloseTo(24);
  });

  it("round-trips hex -> rgb -> hsl -> rgb", () => {
    const r = parseHex("#E87028");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const hsl = rgbToHsl(r.rgb);
      const back = hslToRgb(hsl);
      expect(Math.abs(back.r - r.rgb.r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - r.rgb.g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - r.rgb.b)).toBeLessThanOrEqual(2);
    }
  });

  it("rgbToHex uppercases and pads", () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#FFFFFF");
    expect(rgbToHex({ r: 232, g: 112, b: 40 })).toBe("#E87028");
  });

  it("parses named colors", () => {
    const r = parseAny("orange");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.hex).toBe("#FFA500");
  });

  it("rejects unknown input", () => {
    expect(parseAny("not-a-color").ok).toBe(false);
  });
});
