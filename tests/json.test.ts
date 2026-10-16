import { describe, expect, it } from "vitest";
import { formatJson, minifyJson, parseJsonWithError } from "@/lib/tools/json";

describe("JSON tools", () => {
  it("formats pretty JSON", () => {
    const r = formatJson('{"a":1,"b":[1,2]}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('"a": 1');
      expect(r.output.split("\n").length).toBeGreaterThan(3);
    }
  });

  it("minifies JSON", () => {
    const r = minifyJson('{ "a" : 1 }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toBe('{"a":1}');
  });

  it("reports error position for broken JSON", () => {
    const r = parseJsonWithError('{"a": }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBeGreaterThan(0);
      expect(r.error.column).toBeGreaterThan(0);
      expect(r.error.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects empty input", () => {
    const r = parseJsonWithError("   ");
    expect(r.ok).toBe(false);
  });

  it("rejects trailing content", () => {
    const r = parseJsonWithError('{"a":1} extra');
    expect(r.ok).toBe(false);
  });
});
