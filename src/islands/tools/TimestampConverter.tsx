import { useState } from "react";
import { timestampToDate, dateToTimestamp, nowTimestampMs } from "@/lib/tools/timestamp";
import { CopyButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";

export default function TimestampConverter() {
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
        `本地时间：${r.result.isoLocal}\nUTC 时间：${r.result.isoUtc}\n时区：${r.result.timezone}（UTC${r.result.timezoneOffsetMinutes >= 0 ? "+" : ""}${r.result.timezoneOffsetMinutes / 60}）`,
      );
    } else {
      setDateResult("");
      setDateError(r.error);
    }
  };

  const convertDate = () => {
    const r = dateToTimestamp(dateInput);
    if (r.ok) {
      setTsError(null);
      setTsResult(`秒（10 位）：${r.seconds}\n毫秒（13 位）：${r.milliseconds}`);
    } else {
      setTsResult("");
      setTsError(r.error);
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
        <ToolSection label="时间戳 → 日期" hint="支持秒（10 位）与毫秒（13 位）">
          <input
            type="text"
            value={tsInput}
            onChange={(e) => setTsInput(e.target.value)}
            placeholder="例如：1739520000 或 1739520000000"
            className="input font-mono !text-[13px]"
            aria-label="时间戳输入"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-[2px] border border-border bg-card p-0.5" role="group" aria-label="时间戳单位">
              {(
                [
                  ["s", "秒"],
                  ["ms", "毫秒"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setUnit(key)}
                  aria-pressed={unit === key}
                  className={`rounded-[2px] px-2.5 py-1 text-xs font-medium transition-colors ${
                    unit === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={convertTs} className="btn btn-accent !h-8 px-3 text-xs">
              转换
            </button>
            <button type="button" onClick={fillNow} className="btn btn-ghost !h-8 px-3 text-xs">
              使用当前时间
            </button>
            <CopyButton getText={() => dateResult} disabled={!dateResult} className="ml-auto" />
          </div>
        </ToolSection>
        {dateError && <Message tone="error">{dateError}</Message>}
        {dateResult && <ResultBox>{dateResult}</ResultBox>}
      </div>

      <div className="space-y-4">
        <ToolSection label="日期 → 时间戳" hint="支持 YYYY-MM-DD HH:mm:ss、ISO 8601">
          <input
            type="text"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            placeholder="例如：2026-10-16 12:00:00"
            className="input font-mono !text-[13px]"
            aria-label="日期输入"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={convertDate} className="btn btn-accent !h-8 px-3 text-xs">
              转换
            </button>
            <CopyButton getText={() => tsResult} disabled={!tsResult} className="ml-auto" />
          </div>
        </ToolSection>
        {tsError && <Message tone="error">{tsError}</Message>}
        {tsResult && <ResultBox>{tsResult}</ResultBox>}
      </div>

      <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground lg:col-span-2">
        <p className="font-semibold text-foreground/80">时区说明</p>
        <p className="mt-1.5">
          日期 → 时间戳按<strong>当前浏览器本地时区</strong>解析（即你所在时区的时间）；时间戳 → 日期同时显示本地时间与 UTC
          时间，并标注时区偏移。转换在浏览器本地完成。
        </p>
      </div>
    </div>
  );
}
