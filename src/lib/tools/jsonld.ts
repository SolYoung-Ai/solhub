/** JSON-LD Schema 生成纯逻辑 */

export type JsonLdType = "Organization" | "WebSite" | "SoftwareApplication";

export interface JsonLdInput {
  type: JsonLdType;
  name: string;
  url: string;
  description: string;
  /** Organization: logo URL */
  logo?: string;
  /** WebSite: searchAction 模板，如 https://example.com/search?q={search_term_string} */
  searchTemplate?: string;
  /** SoftwareApplication: 应用分类（如 WebApplication、SoftwareApplication） */
  applicationCategory?: string;
  operatingSystem?: string;
  offersPrice?: string;
  offersCurrency?: string;
}

export function buildJsonLd(input: JsonLdInput): { ok: true; output: string; validation: string[] } | { ok: false; error: string } {
  const validation: string[] = [];
  if (!input.name.trim()) return { ok: false, error: "名称不能为空。" };
  if (!input.url.trim()) return { ok: false, error: "网址不能为空。" };
  try {
    const u = new URL(input.url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "网址需以 http:// 或 https:// 开头。" };
    }
  } catch {
    return { ok: false, error: "网址不是有效的 URL。" };
  }

  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": input.type,
    name: input.name.trim(),
    url: input.url.trim(),
    description: input.description.trim() || undefined,
  };

  if (input.type === "Organization" && input.logo?.trim()) {
    try {
      new URL(input.logo.trim());
      base.logo = input.logo.trim();
    } catch {
      validation.push("Logo URL 无效，已忽略。");
    }
  }

  if (input.type === "WebSite") {
    if (input.searchTemplate?.trim()) {
      const tpl = input.searchTemplate.trim();
      if (tpl.includes("{search_term_string}")) {
        base.potentialAction = {
          "@type": "SearchAction",
          target: `${tpl}?` ,
          "query-input": "required name=search_term_string",
        };
        // target 应指向真实模板地址：替换占位
        (base.potentialAction as { target: string }).target = tpl.replace("{search_term_string}", "{search_term_string}");
      } else {
        validation.push("SearchAction 模板需包含 {search_term_string} 占位符，已忽略。");
      }
    }
  }

  if (input.type === "SoftwareApplication") {
    base.applicationCategory = input.applicationCategory || "WebApplication";
    if (input.operatingSystem?.trim()) base.operatingSystem = input.operatingSystem.trim();
    if (input.offersPrice?.trim()) {
      base.offers = {
        "@type": "Offer",
        price: input.offersPrice.trim(),
        priceCurrency: input.offersCurrency?.trim() || "CNY",
      };
    }
  }

  // 去除 undefined 字段
  const clean = JSON.parse(JSON.stringify(base));
  let output: string;
  try {
    output = JSON.stringify(clean, null, 2);
  } catch {
    return { ok: false, error: "无法序列化 JSON-LD（可能存在循环引用）。" };
  }
  // 校验生成结果本身是合法 JSON
  try {
    JSON.parse(output);
  } catch {
    return { ok: false, error: "生成的 JSON-LD 无法通过 JSON 解析。" };
  }
  validation.push("JSON 语法校验通过。");
  return { ok: true, output, validation };
}
