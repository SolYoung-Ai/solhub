import { describe, expect, it } from "vitest";
import { isValidHttpUrl, formatDateIso, formatDateZh } from "@/lib/utils";

describe("utils", () => {
  it("validates http urls", () => {
    expect(isValidHttpUrl("https://example.com")).toBe(true);
    expect(isValidHttpUrl("http://example.com/path?q=1")).toBe(true);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(isValidHttpUrl("example.com")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
  });

  it("formats dates", () => {
    expect(formatDateIso("2026-10-16T00:00:00Z")).toBe("2026-10-16");
    expect(formatDateZh("2026-10-16T00:00:00Z")).toBe("2026年10月16日");
  });
});
