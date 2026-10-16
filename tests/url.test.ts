import { describe, expect, it } from "vitest";
import { urlEncode, urlDecode } from "@/lib/tools/url";

describe("URL codec", () => {
  it("encodes special chars", () => {
    expect(urlEncode("a b&c=d")).toBe("a%20b%26c%3Dd");
  });

  it("encodes Chinese", () => {
    expect(urlEncode("你好")).toBe("%E4%BD%A0%E5%A5%BD");
  });

  it("decodes correctly", () => {
    const r = urlDecode("a%20b%26c%3Dd");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toBe("a b&c=d");
  });

  it("fails on malformed percent sequences", () => {
    const r = urlDecode("%ZZ");
    expect(r.ok).toBe(false);
    const r2 = urlDecode("%E4%BD");
    expect(r2.ok).toBe(false);
  });
});
