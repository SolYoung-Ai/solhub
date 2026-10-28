/** JSON 工具纯逻辑：格式化 / 压缩 / 校验（带错误位置定位） */

export interface JsonValidationError {
  message: string;
  line: number;
  column: number;
  /** 错误在原文中的字符偏移 */
  offset: number;
}

export function parseJsonWithError(input: string): { ok: true; value: unknown } | { ok: false; error: JsonValidationError } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: { message: "输入为空，请输入 JSON 内容。", line: 1, column: 1, offset: 0 } };
  }
  try {
    const value = JSON.parse(trimmed);
    return { ok: true, value };
  } catch (e) {
    const err = e as Error;
    // V8 错误信息形如 "Unexpected token '}' ... at position 42"
    const posMatch = /position (\d+)/.exec(err.message);
    let offset = 0;
    if (posMatch) {
      offset = Number(posMatch[1]);
    }
    const { line, column } = offsetToLineColumn(trimmed, offset);
    return {
      ok: false,
      error: {
        message: describeJsonError(err.message, trimmed, offset),
        line,
        column,
        offset,
      },
    };
  }
}

function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const safe = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, safe);
  const lines = before.split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

function describeJsonError(raw: string, text: string, offset: number): string {
  // 提取 V8 的错误类别（如 Unexpected token、Unexpected end of JSON input）
  const clean = raw.replace(/ in JSON at position \d+$/, "").trim();
  let hint = "";
  if (offset < text.length) {
    const around = text.slice(Math.max(0, offset - 12), offset + 12).replace(/\n/g, "⏎");
    hint = `（附近内容：…${around}…）`;
  }
  return `${clean}${hint}`;
}

export function formatJson(input: string, indent = 2): { ok: true; output: string } | { ok: false; error: JsonValidationError } {
  const parsed = parseJsonWithError(input);
  if (!parsed.ok) return parsed;
  return { ok: true, output: JSON.stringify(parsed.value, null, indent) };
}

export function minifyJson(input: string): { ok: true; output: string } | { ok: false; error: JsonValidationError } {
  const parsed = parseJsonWithError(input);
  if (!parsed.ok) return parsed;
  return { ok: true, output: JSON.stringify(parsed.value) };
}

export function isValidJson(input: string): boolean {
  return parseJsonWithError(input).ok;
}
