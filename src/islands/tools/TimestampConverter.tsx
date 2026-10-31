import { useState } from "react";
import { timestampToDate, dateToTimestamp, nowTimestampMs } from "@/lib/tools/timestamp";
import { CopyButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t, localizeError } from "@/i18n/data";

export default function TimestampConverter({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [tsInput, setTsInput] = useState("");
  const [unit, setUnit] = useState<"s" | "ms">("s");
  const [dateResult, setDateResult] = useState<string>("");
  const [dateError, setDateError] = useState<string | null>(null);

  const [dateInput, setDateInput] = useState("");
  const [tsResult, setTsResult] = useState<string>("");
  const [tsError, setTsError] = useState<string | null>(null);

  const convertTs = () => {
    const r = timestampToDate(tsInput, unit);
    if (r.ok) {
      setDateError(null);
      setDateResult(
        locale === "en"
          ? `Local: ${r.result.isoLocal}\nUTC: ${r.result.isoUtc}\nTimezone: ${r.result.timezone} (UTC${r.result.timezoneOffsetMinutes >= 0 ? "+" : ""}${r.result.timezoneOffsetMinutes / 60})`
          : `本地时间：${r.result.isoLocal}\nUTC 时间：${r.result.isoUtc}\n时区：${r.result.timezone}（UTC${r.result.timezoneOffsetMinutes >= 0 ? "+" : ""}${r.result.timezoneOffsetMinutes / 60}）`,
      );
    } else {
      setDateResult("");
      setDateError(localizeError(locale, r.error));
    }
  };

  const convertDate = () => {
    const r = dateToTimestamp(dateInput);
    if (r.ok) {
      setTsError(null);
      setTsResult(
        locale === "en"
          ? `Seconds (10 digits): ${r.seconds}\nMilliseconds (13 digits): ${r.milliseconds}`
          : `秒（10 位）：${r.seconds}\n毫秒（13 位）：${r.milliseconds}`,
      );
    } else {
      setTsResult("");
      setTsError(localizeError(locale, r.error));
    }
  };

  const fillNow = () => {
    setUnit("ms");
    setTsInput(String(nowTimestampMs()));
    setDateInput("");
    setDateResult("");
    setDateError(null);
    setTsResult("");
    setTsError(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <ToolSection label={locale === "en" ? "Timestamp → Date" : "时间戳 → 日期"} hint={locale === "en" ? "Seconds (10) or milliseconds (13)" : "支持秒（10 位）与毫秒（13 位）"}>
          <input
            type="text"
            value={tsInput}
            onChange={(e) => setTsInput(e.target.value)}
            placeholder="例如：1739520000 或 1739520000000"
            className="input font-mono !text-[13px]"
            aria-label={t(locale, "tools.timestamp-converter.tsLabel")}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-[6px] border border-border bg-card p-0.5" role="group" aria-label={locale === "en" ? "Timestamp unit" : "时间戳单位"}>
              {(
                [
                  ["s", locale === "en" ? "sec" : "秒"],
                  ["ms", locale === "en" ? "ms" : "毫秒"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setUnit(key)}
                  aria-pressed={unit === key}
                  className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                    unit === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={convertTs} className="btn btn-accent !h-8 px-3 text-xs">
              {locale === "en" ? "Convert" : "转换"}
            </button>
            <button type="button" onClick={fillNow} className="btn btn-ghost !h-8 px-3 text-xs">
              {locale === "en" ? "Use now" : "使用当前时间"}
            </button>
            <CopyButton getText={() => dateResult} disabled={!dateResult} className="ml-auto" />
          </div>
        </ToolSection>
        {dateError && <Message tone="error">{dateError}</Message>}
        {dateResult && <ResultBox>{dateResult}</ResultBox>}
      </div>

      <div className="space-y-4">
        <ToolSection label={locale === "en" ? "Date → Timestamp" : "日期 → 时间戳"} hint={locale === "en" ? "YYYY-MM-DD HH:mm:ss, ISO 8601" : "支持 YYYY-MM-DD HH:mm:ss、ISO 8601"}>
          <input
            type="text"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            placeholder="例如：2026-10-16 12:00:00"
            className="input font-mono !text-[13px]"
            aria-label={t(locale, "tools.timestamp-converter.dateLabel")}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={convertDate} className="btn btn-accent !h-8 px-3 text-xs">
              {locale === "en" ? "Convert" : "转换"}
            </button>
            <CopyButton getText={() => tsResult} disabled={!tsResult} className="ml-auto" />
          </div>
        </ToolSection>
        {tsError && <Message tone="error">{tsError}</Message>}
        {tsResult && <ResultBox>{tsResult}</ResultBox>}
      </div>

      <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground lg:col-span-2">
        <p className="font-semibold text-foreground/80">{locale === "en" ? "Timezone notes" : "时区说明"}</p>
        <p className="mt-1.5">
          {locale === "en" ? (
            <>Date → timestamp parses in the <strong>browser's local timezone</strong>; timestamp → date shows both local and UTC with the offset. All conversions happen locally.</>
          ) : (
            <>日期 → 时间戳按<strong>当前浏览器本地时区</strong>解析（即你所在时区的时间）；时间戳 → 日期同时显示本地时间与 UTC
              时间，并标注时区偏移。转换在浏览器本地完成。</>
          )}
        </p>
      </div>
    </div>
  );
}
