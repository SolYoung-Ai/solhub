/** UTM 链接构建纯逻辑（正确处理已有查询参数） */

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  term?: string;
  content?: string;
}

export function buildUtmUrl(
  baseUrl: string,
  params: UtmParams,
): { ok: true; url: string } | { ok: false; error: string } {
  if (!baseUrl.trim()) return { ok: false, error: "请输入目标网址。" };
  let u: URL;
  try {
    u = new URL(baseUrl.trim());
  } catch {
    return { ok: false, error: "目标网址不是有效的 URL（需包含协议，例如 https://example.com/page）。" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "目标网址需以 http:// 或 https:// 开头。" };
  }
  if (!params.source.trim() || !params.medium.trim() || !params.campaign.trim()) {
    return { ok: false, error: "Source、Medium、Campaign 为必填项。" };
  }
  // 已有参数保留；UTM 参数覆盖同名项（追加到查询字符串尾部）
  u.searchParams.set("utm_source", params.source.trim());
  u.searchParams.set("utm_medium", params.medium.trim());
  u.searchParams.set("utm_campaign", params.campaign.trim());
  if (params.term?.trim()) u.searchParams.set("utm_term", params.term.trim());
  else u.searchParams.delete("utm_term");
  if (params.content?.trim()) u.searchParams.set("utm_content", params.content.trim());
  else u.searchParams.delete("utm_content");
  return { ok: true, url: u.toString() };
}
