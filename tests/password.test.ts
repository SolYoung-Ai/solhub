import { describe, expect, it } from "vitest";
import { generatePassword, type PasswordOptions } from "@/lib/tools/password";

const base: PasswordOptions = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
};

describe("Password generator", () => {
  it("generates password of requested length", () => {
    const r = generatePassword({ ...base, length: 24 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.password).toHaveLength(24);
  });

  it("rejects invalid length", () => {
    expect(generatePassword({ ...base, length: 2 }).ok).toBe(false);
    expect(generatePassword({ ...base, length: 999 }).ok).toBe(false);
  });

  it("rejects empty charset", () => {
    const r = generatePassword({
      length: 16,
      uppercase: false,
      lowercase: false,
      numbers: false,
      symbols: false,
    });
    expect(r.ok).toBe(false);
  });

  it("only uses selected charsets", () => {
    const r = generatePassword({ length: 32, uppercase: true, lowercase: false, numbers: false, symbols: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.password).toMatch(/^[A-Z]+$/);
  });

  it("includes at least one char from each selected set", () => {
    const r = generatePassword({ ...base, length: 8 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.password).toMatch(/[A-Z]/);
      expect(r.password).toMatch(/[a-z]/);
      expect(r.password).toMatch(/[0-9]/);
      expect(r.password).toMatch(/[^A-Za-z0-9]/);
    }
  });
});
