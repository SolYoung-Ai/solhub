/** 时间戳与日期互转纯逻辑（支持秒 / 毫秒，显示本地时区） */

export interface TimestampResult {
  timestampMs: number;
  isoLocal: string;
  isoUtc: string;
  timezone: string;
  timezoneOffsetMinutes: number;
}

/** 时间戳 → 日期。unit: "s" | "ms"。 */
export function timestampToDate(
  input: string,
  unit: "s" | "ms",
): { ok: true; result: TimestampResult } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "请输入时间戳。" };
  const num = Number(raw);
  if (!Number.isFinite(num)) return { ok: false, error: "输入不是有效数字。" };
  if (num < 0) return { ok: false, error: "时间戳不能为负数。" };
  const ms = unit === "s" ? num * 1000 : num;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return { ok: false, error: "无法解析为有效日期。" };
  const offset = d.getTimezoneOffset(); // 分钟，UTC = local - offset
  const tz = getTimezoneName();
  return {
    ok: true,
    result: {
      timestampMs: ms,
      isoLocal: d.toISOString().slice(0, 19).replace("T", " ") + localOffsetSuffix(offset),
      isoUtc: d.toISOString(),
      timezone: tz,
      timezoneOffsetMinutes: -offset,
    },
  };
}

/** 日期时间字符串 → 时间戳（秒与毫秒）。支持 ISO 格式与常见本地格式。 */
export function dateToTimestamp(
  input: string,
): { ok: true; seconds: number; milliseconds: number } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "请输入日期时间。" };
  const d = parseDateInput(raw);
  if (!d || Number.isNaN(d.getTime())) {
    return {
      ok: false,
      error: "无法解析日期。支持格式：YYYY-MM-DD HH:mm:ss、YYYY-MM-DD、ISO 8601（如 2026-10-16T12:00:00Z）。",
    };
  }
  const ms = d.getTime();
  if (ms < 0) return { ok: false, error: "解析结果早于 Unix 纪元（1970-01-01），无法表示为时间戳。" };
  return { ok: true, seconds: Math.floor(ms / 1000), milliseconds: ms };
}

function parseDateInput(raw: string): Date | null {
  // 常见本地格式：2026-10-16 14:30:00 或 2026/10/16 14:30
  const localMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if (localMatch) {
    const [, yStr, mStr, dStr, hStr = "0", minStr = "0", sStr = "0"] = localMatch;
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    const h = Number(hStr);
    const min = Number(minStr);
    const s = Number(sStr);
    // 严格校验范围，避免 JS Date 自动进位（如 2026-13-45）
    if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || s > 59) {
      return null;
    }
    const date = new Date(y, m - 1, d, h, min, s);
    // 校验「进位后的日期」是否与输入一致（例如 2 月 30 日会被进位）
    if (
      date.getFullYear() !== y ||
      date.getMonth() + 1 !== m ||
      date.getDate() !== d ||
      date.getHours() !== h ||
      date.getMinutes() !== min ||
      date.getSeconds() !== s
    ) {
      return null;
    }
    return date;
  }
  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function getTimezoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "本地时区";
  } catch {
    return "本地时区";
  }
}

function localOffsetSuffix(offsetMinutes: number): string {
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return ` (UTC${sign}${hh}:${mm})`;
}

/** 当前时间戳（毫秒） */
export function nowTimestampMs(): number {
  return Date.now();
}
