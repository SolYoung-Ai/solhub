/** 通用工具函数（纯函数，可被 Node 测试直接引用） */

import type { Locale } from "@/i18n";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** 客户端获取当前语言（按 URL 前缀判断；无 window 时默认 zh） */
export function getLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  const path = window.location.pathname;
  if (path.indexOf("/en/") !== -1 || path.endsWith("/en")) return "en";
  return "zh";
}

export function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 确保用户手填的网址带有协议头。
 * 用户常漏写 https://（如只填 solyoung.top），若直接当作 href，
 * 浏览器会当成站内相对路径跳转到 solhub.solyoung.top/solyoung.top 而 404。
 * 这里在渲染 / 存储前统一补上 https://。
 */
export function ensureHttps(url: string): string {
  const u = (url || "").trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return "https://" + u.replace(/^[./]+/, "");
}

/** 格式化日期为 YYYY-MM-DD */
export function formatDateIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 格式化日期为中文友好格式：2026年10月16日 */
export function formatDateZh(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 复制文本到剪贴板（带降级方案），返回是否成功 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 下载文本文件 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 生成唯一 id（运行时） */
export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
