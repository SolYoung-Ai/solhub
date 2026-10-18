/**
 * 数据层本地化：工具 / 分类 / 产品 / 产品分类的英文文案映射。
 * 数据文件（src/data/*.ts）保持中文为唯一事实源，英文覆盖集中在此处，
 * 便于维护且不会把数据与展示耦合。
 */
import type { Locale } from "./index";
import { getDict, translate } from "./index";

/* ---------------- 工具描述 / 说明 ---------------- */

export const toolDescEn: Record<string, string> = {
  "json-formatter": "Format, minify and validate JSON, with exact parse-error locations.",
  "text-counter": "Real-time character, word and paragraph counts for Chinese and English.",
  "url-codec": "URL encode / decode with one click and clear feedback on bad input.",
  "base64-codec": "Base64 encode / decode with full UTF-8 (Chinese) and special-char support.",
  "uuid-generator": "Batch-generate UUID v4 with the Web Crypto API.",
  "password-generator": "Configurable strong-password generator that runs entirely on your device.",
  "timestamp-converter": "Convert Unix timestamps to dates and back, seconds or milliseconds, timezone-aware.",
  "utm-builder": "Build UTM tracking links that merge cleanly with existing query params.",
  "qr-generator": "Generate QR codes from text or URLs, resize and download as PNG.",
  "image-compressor": "Compress images locally in the browser with live size and ratio feedback.",
  "aspect-ratio-calculator": "Derive missing dimensions from width, height or ratio, with common presets.",
  "color-converter": "Convert between HEX, RGB and HSL with a live preview and one-click copy.",
  "robots-generator": "Build common robots.txt rules and copy the result.",
  "llms-generator": "Generate a clean llms.txt so LLMs can understand your site.",
  "jsonld-generator": "Generate JSON-LD for Organization, WebSite, SoftwareApplication and more.",
  "markdown-editor": "Split-pane Markdown editor with live preview, copy and download.",
};

export const toolNoteEn: Record<string, string> = {
  "json-formatter": "Everything runs locally in your browser — input is never uploaded.",
  "text-counter": "Word-count rules: English splits on spaces; Chinese counts consecutive characters. See the page notes.",
  "url-codec": "Uses encodeURIComponent / decodeURIComponent, covering UTF-8 Chinese and common special characters.",
  "base64-codec": "Non-ASCII text (e.g. Chinese) is UTF-8 encoded first; invalid input shows a clear error.",
  "uuid-generator": "Uses crypto.randomUUID() — no server involved.",
  "password-generator": "Uses the browser's native crypto.getRandomValues(). Passwords are never saved to the page, console or any server.",
  "timestamp-converter": "Times are shown in your local timezone with the offset; invalid input shows an error.",
  "utm-builder": "Existing query params on the target URL are merged, never overwritten.",
  "qr-generator": "Generated locally with a proven QR library — your image is never uploaded.",
  "image-compressor": "Images are processed entirely on-device. PNG transparency is flattened to a background color when exporting JPEG.",
  "aspect-ratio-calculator": "Leave either width or height blank to derive it from the ratio. All math is local.",
  "color-converter": "Invalid colors show a clear message. HEX accepts 3/6-digit and 8-digit (alpha) formats.",
  "robots-generator": "This generator only outputs the robots.txt text; search engines vary in which directives they honor.",
  "llms-generator": "llms.txt is a community-proposed format, not a search-engine standard — use it with judgment.",
  "jsonld-generator": "Results are validated as JSON right on the page; actual indexing depends on the search engine.",
  "markdown-editor": "Preview output is sanitized (DOMPurify) — untrusted scripts never execute.",
};

/* ---------------- 工具分类 ---------------- */

export const categoryDescEn: Record<string, string> = {
  "developer-tools": "Daily efficiency tools for developers: JSON, code, encoding and generators.",
  "seo-web": "Web and search-engine tools: URL, robots and structured data.",
  "text-content": "Text counting and content-processing tools.",
  images: "Image utilities: compression, QR codes and more.",
  "converters-calculators": "Converters & calculators: timestamps, colors, ratios.",
  "growth-marketing": "Growth and marketing tools, e.g. UTM link builder.",
};

/* ---------------- 产品分类 ---------------- */

export const productCatEn: Record<string, { name: string; description: string }> = {
  "creator-space": { name: "Personal Digital Space", description: "Personal sites, portfolios and digital archives." },
  services: { name: "Design & Services", description: "Web building, branding and business collaboration services." },
  "ai-tools": { name: "AI Tools", description: "Products and tools powered by AI." },
  productivity: { name: "Productivity", description: "Products that help you get work done more efficiently." },
  "creator-tools": { name: "Creator Tools", description: "Gear for image, video and content creators." },
  "fun-tools": { name: "Fun Tools", description: "Tests, entertainment and light interactive products." },
  "growth-marketing": { name: "Growth & Marketing", description: "Acquisition, promotion and growth products." },
  "design-tools": { name: "Design Tools", description: "Visual and design products." },
};

/* ---------------- 产品 ---------------- */

export const productShortEn: Record<string, string> = {
  solyoung: "A person who turns ideas into work — an ever-updated personal digital space.",
  "solyoung-studio": "AI-powered personal websites, digital spaces and lightweight product builds.",
  myos: "A local-first workspace for independent creators: capture → think → create → ship → archive.",
  verity: "13 personality tests in one place — pick one and start.",
  camsim: "Camera simulator: reverse-engineer aperture, shutter and ISO from the look you want.",
};

export const productDescEn: Record<string, string> = {
  solyoung:
    "SolYoung is the personal site of independent creator Song Yang (Sol Young): a digital-archive layout hosting a portfolio, an on-now timeline, essays and product entries. It's the home base of his personal brand, covering image work, AI practice and lightweight product development — continuously updated.",
  "solyoung-studio":
    "SolYoung Studio is a service site for creators, freelancers and small brands: from requirements and visual design to AI-assisted production and deployment, turning ideas into real, usable work, plus branding and collaboration entry points.",
  myos:
    "My.OS is an online personal creation system: records, inspiration, projects, now and archives in one entry point, reducing the anxiety of scattered ideas. Free to use.",
  verity:
    "Verity is an online collection of 13 personality tests behind one consistent entry point, with instant results. Free to use — for people who want to understand themselves quickly.",
  camsim:
    "CamSim is an interactive tool for photography beginners: tell it the look you want, get a reference set of aperture / shutter / ISO values. Free to use.",
};

/* ---------------- 本地化取数函数 ---------------- */

export function toolDescription(slug: string, desc: string, locale: Locale): string {
  if (locale === "en") return toolDescEn[slug] ?? desc;
  return desc;
}

export function toolNote(slug: string, note: string | undefined, locale: Locale): string {
  if (locale === "en" && note) return toolNoteEn[slug] ?? note;
  return note ?? "";
}

export function categoryDescription(slug: string, desc: string, locale: Locale): string {
  if (locale === "en") return categoryDescEn[slug] ?? desc;
  return desc;
}

export function productCategoryNameLocalized(slug: string, zhName: string, locale: Locale): string {
  if (locale === "en") return productCatEn[slug]?.name ?? zhName;
  return zhName;
}

export function productCategoryDescriptionLocalized(slug: string, zhDesc: string, locale: Locale): string {
  if (locale === "en") return productCatEn[slug]?.description ?? zhDesc;
  return zhDesc;
}

export function productShortDescription(slug: string, zh: string, locale: Locale): string {
  if (locale === "en") return productShortEn[slug] ?? zh;
  return zh;
}

export function productDescription(slug: string, zh: string, locale: Locale): string {
  if (locale === "en") return productDescEn[slug] ?? zh;
  return zh;
}

/** 翻译辅助：从 i18n 字典取词（页面组件统一入口） */
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  return translate(getDict(locale), key, vars);
}

/* ---------------- 纯逻辑错误信息本地化 ---------------- */
/* 工具纯逻辑（src/lib/tools/*.ts）返回中文错误，英文版在展示层映射为英文。 */

const errMapEn: Record<string, string> = {
  "解码失败：输入包含非法的百分号编码（如不完整的 % 转义序列）。": "Decode failed: invalid percent-encoding (e.g. an incomplete % escape).",
  "密码长度需在 4–128 之间。": "Password length must be between 4 and 128.",
  "输入为空，请输入需要解码的 Base64 内容。": "Empty input — enter Base64 to decode.",
  "无法识别的颜色格式。支持 HEX、rgb(r,g,b)、hsl(h,s%,l%) 与常见颜色名。": "Unrecognized color. Supported: HEX, rgb(r,g,b), hsl(h,s%,l%) and common color names.",
  "网址需以 http:// 或 https:// 开头。": "URL must start with http:// or https://.",
  "网站网址需以 http:// 或 https:// 开头。": "Site URL must start with http:// or https://.",
  "生成的 JSON-LD 无法通过 JSON 解析。": "Generated JSON-LD is not valid JSON.",
  "无法序列化 JSON-LD（可能存在循环引用）。": "Could not serialize JSON-LD (possible circular reference).",
  "解析结果早于 Unix 纪元（1970-01-01），无法表示为时间戳。": "The date is before the Unix epoch (1970-01-01) and cannot be a timestamp.",
  "网站网址不是有效的 URL（需包含协议，如 https://example.com）。": "Site URL is not valid (needs a protocol, e.g. https://example.com).",
  "目标网址不是有效的 URL（需包含协议，例如 https://example.com/page）。": "Target URL is not valid (needs a protocol, e.g. https://example.com/page).",
  "网址不是有效的 URL。": "URL is not valid.",
  "宽度数值过大。": "Width is too large.",
  "尺寸必须为正数。": "Dimensions must be positive numbers.",
  "输入不是有效数字。": "Input is not a valid number.",
  "无法解析为有效日期。": "Could not parse as a valid date.",
  "至少选择一种字符类型。": "Select at least one character type.",
  "网站名称与网址为必填项。": "Site name and URL are required.",
  "请至少输入宽度、高度或比例中的一项。": "Enter at least one of width, height or ratio.",
  "已知条件不足：比例必须与宽度或高度中的至少一项同时给出。": "Not enough input: ratio must be paired with width or height.",
  "非法输入：Base64 只包含字母、数字、+、/ 与末尾的 = 填充符。": "Invalid input: Base64 only contains letters, digits, +, / and trailing = padding.",
  "HEX 需为 3、4、6 或 8 位十六进制（如 #E87028）。": "HEX must be 3, 4, 6 or 8 hex digits (e.g. #E87028).",
  "HSL 范围：H 0–360，S/L 0–100。": "HSL range: H 0–360, S/L 0–100.",
  "HSL 格式：hsl(24, 79%, 53%)。": "HSL format: hsl(24, 79%, 53%).",
  "RGB 数值需在 0–255 之间。": "RGB values must be 0–255.",
  "RGB 格式：rgb(232, 112, 40)，数值 0–255。": "RGB format: rgb(232, 112, 40), values 0–255.",
  "Source、Medium、Campaign 为必填项。": "Source, Medium and Campaign are required.",
  "请输入目标网址。": "Enter the target URL.",
  "无法解析日期。支持格式：YYYY-MM-DD HH:mm:ss、YYYY-MM-DD、ISO 8601（如 2026-10-16T12:00:00Z）。": "Could not parse the date. Supported: YYYY-MM-DD HH:mm:ss, YYYY-MM-DD, ISO 8601 (e.g. 2026-10-16T12:00:00Z).",
  "请输入时间戳。": "Enter a timestamp.",
  "名称不能为空。": "Name cannot be empty.",
  "网址不能为空。": "URL cannot be empty.",
};

/** 展示层本地化纯逻辑错误文案（zh 原样返回，en 查映射，未知则原样） */
export function localizeError(locale: Locale, message: string): string {
  if (locale === "zh") return message;
  return errMapEn[message] ?? message;
}
