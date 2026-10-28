import { describe, expect, it } from "vitest";
import { countText } from "@/lib/tools/text";

describe("Text counter", () => {
  it("counts basic English text", () => {
    const s = countText("hello world");
    expect(s.characters).toBe(11);
    expect(s.charactersNoSpaces).toBe(10);
    expect(s.words).toBe(2);
    expect(s.paragraphs).toBe(1);
    expect(s.lines).toBe(1);
  });

  it("counts Chinese runs as words", () => {
    const s = countText("你好世界");
    expect(s.words).toBe(1);
    expect(s.characters).toBe(4);
  });

  it("combines Chinese and English words", () => {
    const s = countText("你好 world");
    expect(s.words).toBe(2);
  });

  it("counts paragraphs by blank lines", () => {
    const s = countText("第一段\n\n第二段");
    expect(s.paragraphs).toBe(2);
    expect(s.lines).toBe(3);
  });

  it("handles empty input", () => {
    const s = countText("");
    expect(s.characters).toBe(0);
    expect(s.words).toBe(0);
    expect(s.paragraphs).toBe(0);
  });

  it("excludes full-width spaces from no-space count", () => {
    const s = countText("你　好");
    expect(s.charactersNoSpaces).toBe(2);
  });
});
