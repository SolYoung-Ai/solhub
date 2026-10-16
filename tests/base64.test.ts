import { describe, expect, it } from "vitest";
import { base64Encode, base64Decode } from "@/lib/tools/base64";

describe("Base64 codec", () => {
  it("encodes Chinese as UTF-8", () => {
    expect(base64Encode("你好")).toBe("5L2g5aW9");
  });

  it("round-trips English text", () => {
    const enc = base64Encode("Hello, SolHub!");
    const dec = base64Decode(enc);
    expect(dec.ok).toBe(true);
    if (dec.ok) expect(dec.output).toBe("Hello, SolHub!");
  });

  it("round-trips Chinese + emoji", () => {
    const enc = base64Encode("你好，🚀");
    const dec = base64Decode(enc);
    expect(dec.ok).toBe(true);
    if (dec.ok) expect(dec.output).toBe("你好，🚀");
  });

  it("rejects invalid characters", () => {
    const r = base64Decode("!!!not base64!!!");
    expect(r.ok).toBe(false);
  });

  it("rejects invalid UTF-8 payload", () => {
    // "ÿ" 等非 UTF-8 字节（0xFF）
    const r = base64Decode("/w==");
    expect(r.ok).toBe(false);
  });

  it("rejects empty input", () => {
    const r = base64Decode("   ");
    expect(r.ok).toBe(false);
  });
});
