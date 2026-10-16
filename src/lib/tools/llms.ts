/** llms.txt 生成纯逻辑（社区提案格式） */

export interface LlmsPage {
  url: string;
  title: string;
  detail?: string;
}

export interface LlmsInput {
  siteName: string;
  siteUrl: string;
  intro: string;
  pages: LlmsPage[];
}

export function buildLlms(input: LlmsInput): { ok: true; output: string } | { ok: false; error: string } {
  if (!input.siteName.trim() || !input.siteUrl.trim()) {
    return { ok: false, error: "网站名称与网址为必填项。" };
  }
  let siteUrl: URL;
  try {
    siteUrl = new URL(input.siteUrl.trim());
  } catch {
    return { ok: false, error: "网站网址不是有效的 URL（需包含协议，如 https://example.com）。" };
  }
  if (siteUrl.protocol !== "http:" && siteUrl.protocol !== "https:") {
    return { ok: false, error: "网站网址需以 http:// 或 https:// 开头。" };
  }
  const base = siteUrl.origin;
  const lines: string[] = [];
  lines.push(`# ${input.siteName.trim()}`);
  lines.push("");
  lines.push(`> ${input.siteUrl.trim()}`);
  lines.push("");
  if (input.intro.trim()) {
    lines.push(input.intro.trim());
    lines.push("");
  }
  lines.push("## 主要页面");
  lines.push("");
  const seen = new Set<string>();
  for (const page of input.pages) {
    if (!page.url.trim() || !page.title.trim()) continue;
    const url = normalizePageUrl(page.url.trim(), base);
    if (seen.has(url)) continue;
    seen.add(url);
    lines.push(`- [${page.title.trim()}](${url})${page.detail ? `: ${page.detail.trim()}` : ""}`);
  }
  return { ok: true, output: lines.join("\n") + "\n" };
}

function normalizePageUrl(raw: string, base: string): string {
  try {
    const u = new URL(raw, base);
    if (u.origin !== new URL(base).origin) return raw;
    return u.toString();
  } catch {
    return raw;
  }
}
