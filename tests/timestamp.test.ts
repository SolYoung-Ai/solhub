import { describe, expect, it } from "vitest";
import { timestampToDate, dateToTimestamp } from "@/lib/tools/timestamp";

describe("Timestamp converter", () => {
  it("converts seconds to date", () => {
    const r = timestampToDate("0", "s");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.isoUtc).toBe("1970-01-01T00:00:00.000Z");
    }
  });

  it("converts ms timestamps", () => {
    const r = timestampToDate("1000", "ms");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.isoUtc).toBe("1970-01-01T00:00:01.000Z");
  });

  it("rejects non-numeric input", () => {
    expect(timestampToDate("abc", "s").ok).toBe(false);
    expect(timestampToDate("", "s").ok).toBe(false);
    expect(timestampToDate("-5", "s").ok).toBe(false);
  });

  it("converts local date to timestamp", () => {
    const r = dateToTimestamp("2026-10-16 12:00:00");
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 秒级时间戳应在 1.79e9 量级（2026 年）
      expect(r.seconds).toBeGreaterThan(1780000000);
      expect(r.seconds).toBeLessThan(1800000000);
      expect(r.milliseconds).toBe(r.seconds * 1000);
    }
  });

  it("rejects dates before Unix epoch", () => {
    const r = dateToTimestamp("1960-01-01 00:00:00");
    expect(r.ok).toBe(false);
  });

  it("rejects invalid dates", () => {
    expect(dateToTimestamp("not a date").ok).toBe(false);
    expect(dateToTimestamp("2026-13-45").ok).toBe(false);
    expect(dateToTimestamp("2026-02-30").ok).toBe(false);
    expect(dateToTimestamp("2026-10-16 25:00").ok).toBe(false);
  });
});
