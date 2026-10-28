/** 文本统计纯逻辑（支持中文与英文） */

export interface TextStats {
  characters: number; // 全部字符（含空格与换行）
  charactersNoSpaces: number; // 不含空格（含换行计为字符但空格不计）——详见规则
  charactersNoWhitespace: number; // 不含所有空白（空格/换行/制表）
  words: number;
  paragraphs: number;
  lines: number;
}

/**
 * 统计规则（页面需要向用户说明）：
 * - characters：全部字符数（含空格与换行）。
 * - charactersNoSpaces：去除空格（U+0020 与全角空格）后的字符数，保留换行。
 * - words：英文按空白分词；中文按连续汉字/中文标点边界计为「词」。
 *   混合文本将两者相加。数字串视为一个词。
 * - paragraphs：按空行分隔的段落数；全部为空白时段落数为 0。
 * - lines：按换行分隔的行数；空文本为 0。
 */
export function countText(input: string): TextStats {
  if (!input) {
    return {
      characters: 0,
      charactersNoSpaces: 0,
      charactersNoWhitespace: 0,
      words: 0,
      paragraphs: 0,
      lines: 0,
    };
  }

  const characters = input.length;
  const charactersNoSpaces = input.replace(/[\u0020\u3000]/g, "").length;
  const charactersNoWhitespace = input.replace(/\s/g, "").length;

  // 英文单词：按空白拆分
  const englishWords = input.split(/[\s\u3000]+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

  // 中文词：连续的汉字序列（含中文数字与中文标点分隔）
  const chineseRuns = input.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g);
  const chineseWords = chineseRuns ? chineseRuns.length : 0;

  const words = englishWords + chineseWords;

  // 段落：按一个及以上空行分隔
  const paragraphs = input
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;

  // 行数
  const lines = input === "" ? 0 : input.split("\n").length;

  return {
    characters,
    charactersNoSpaces,
    charactersNoWhitespace,
    words,
    paragraphs,
    lines,
  };
}
