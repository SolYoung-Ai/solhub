/** URL 编码 / 解码纯逻辑 */

export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

export function urlDecode(input: string): { ok: true; output: string } | { ok: false; error: string } {
  try {
    return { ok: true, output: decodeURIComponent(input) };
  } catch {
    return { ok: false, error: "解码失败：输入包含非法的百分号编码（如不完整的 % 转义序列）。" };
  }
}
