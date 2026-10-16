/** 颜色转换纯逻辑：HEX / RGB / HSL 互转，带校验 */

export interface Rgb {
  r: number; // 0-255
  g: number;
  b: number;
}
export interface Hsl {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export type ColorFormat = "hex" | "rgb" | "hsl";

export function parseHex(input: string): { ok: true; rgb: Rgb; alpha?: number } | { ok: false; error: string } {
  const s = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return { ok: true, rgb: { r, g, b } };
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return {
      ok: true,
      rgb: {
        r: parseInt(s.slice(0, 2), 16),
        g: parseInt(s.slice(2, 4), 16),
        b: parseInt(s.slice(4, 6), 16),
      },
    };
  }
  if (/^[0-9a-fA-F]{4}$/.test(s)) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    const a = parseInt(s[3] + s[3], 16) / 255;
    return { ok: true, rgb: { r, g, b }, alpha: a };
  }
  if (/^[0-9a-fA-F]{8}$/.test(s)) {
    return {
      ok: true,
      rgb: {
        r: parseInt(s.slice(0, 2), 16),
        g: parseInt(s.slice(2, 4), 16),
        b: parseInt(s.slice(4, 6), 16),
      },
      alpha: parseInt(s.slice(6, 8), 16) / 255,
    };
  }
  return { ok: false, error: "HEX 需为 3、4、6 或 8 位十六进制（如 #E87028）。" };
}

export function parseRgb(input: string): { ok: true; rgb: Rgb } | { ok: false; error: string } {
  const m = /^rgb\(?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?$/i.exec(input.trim());
  if (!m) return { ok: false, error: "RGB 格式：rgb(232, 112, 40)，数值 0–255。" };
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if ([r, g, b].some((v) => v < 0 || v > 255)) {
    return { ok: false, error: "RGB 数值需在 0–255 之间。" };
  }
  return { ok: true, rgb: { r, g, b } };
}

export function parseHsl(input: string): { ok: true; hsl: Hsl } | { ok: false; error: string } {
  const m = /^hsl\(?\s*(\d{1,3}(?:\.\d+)?)\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%\s*\)?$/i.exec(input.trim());
  if (!m) return { ok: false, error: "HSL 格式：hsl(24, 79%, 53%)。" };
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Number(m[3]);
  if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) {
    return { ok: false, error: "HSL 范围：H 0–360，S/L 0–100。" };
  }
  return { ok: true, hsl: { h, s, l } };
}

export function rgbToHex(rgb: Rgb): string {
  const to = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${to(rgb.r)}${to(rgb.g)}${to(rgb.b)}`.toUpperCase();
}

export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
    h *= 360;
  }
  return { h: Math.round(h * 100) / 100, s: Math.round(s * 10000) / 100, l: Math.round(l * 10000) / 100 };
}

export function hslToRgb(hsl: Hsl): Rgb {
  const h = ((hsl.h % 360) + 360) % 360 / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

export function hslString(hsl: Hsl): string {
  return `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`;
}

export function rgbString(rgb: Rgb): string {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
}

export function rgbCss(rgb: Rgb): string {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
}

/** 将任意支持的颜色输入解析为 RGB */
export function parseColor(input: string): { ok: true; rgb: Rgb } | { ok: false; error: string } {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("#")) return parseHex(trimmed);
  if (lower.startsWith("rgb")) return parseRgb(trimmed);
  if (lower.startsWith("hsl")) {
    const parsed = parseHsl(trimmed);
    if (!parsed.ok) return parsed;
    return { ok: true, rgb: hslToRgb(parsed.hsl) };
  }
  // 支持命名颜色（常用子集）
  const named: Record<string, Rgb> = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 255, g: 255, b: 255 },
    red: { r: 255, g: 0, b: 0 },
    green: { r: 0, g: 128, b: 0 },
    blue: { r: 0, g: 0, b: 255 },
    orange: { r: 255, g: 165, b: 0 },
    gray: { r: 128, g: 128, b: 128 },
    grey: { r: 128, g: 128, b: 128 },
    yellow: { r: 255, g: 255, b: 0 },
    purple: { r: 128, g: 0, b: 128 },
    pink: { r: 255, g: 192, b: 203 },
  };
  if (named[lower]) return { ok: true, rgb: named[lower] };
  return { ok: false, error: "无法识别的颜色格式。支持 HEX、rgb(r,g,b)、hsl(h,s%,l%) 与常见颜色名。" };
}

export function parseAny(
  input: string,
): { ok: true; format: ColorFormat; rgb: Rgb; hsl: Hsl; hex: string } | { ok: false; error: string } {
  const parsed = parseColor(input);
  if (!parsed.ok) return parsed;
  const hex = rgbToHex(parsed.rgb);
  const hsl = rgbToHsl(parsed.rgb);
  const lower = input.trim().toLowerCase();
  const format: ColorFormat = lower.startsWith("#")
    ? "hex"
    : lower.startsWith("rgb")
      ? "rgb"
      : lower.startsWith("hsl")
        ? "hsl"
        : "hex";
  return { ok: true, format, rgb: parsed.rgb, hsl, hex };
}
