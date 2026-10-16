import { useRef, useState, type ReactNode } from "react";
import { Check, Copy, Download, Eraser, RotateCcw, X } from "lucide-react";
import { copyText, cx } from "@/lib/utils";

/** 统一的操作反馈：复制 / 下载 / 重置 / 清空 / 状态消息 / 结果区 */

export function CopyButton({
  getText,
  label = "复制",
  onStatus,
  className,
  disabled = false,
}: {
  getText: () => string;
  label?: string;
  onStatus?: (ok: boolean) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onClick = async () => {
    if (disabled) return;
    const ok = await copyText(getText());
    setState(ok ? "copied" : "failed");
    onStatus?.(ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "btn btn-outline !h-8 px-3 text-xs",
        state === "copied" && "border-success/40 bg-success/10 text-success",
        state === "failed" && "border-destructive/40 bg-destructive/10 text-destructive",
        className,
      )}
      aria-live="polite"
    >
      {state === "copied" ? (
        <>
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> 已复制
        </>
      ) : state === "failed" ? (
        <>
          <X className="h-3.5 w-3.5" aria-hidden="true" /> 复制失败
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {label}
        </>
      )}
    </button>
  );
}

export function DownloadButton({
  filename,
  getContent,
  mime = "text/plain;charset=utf-8",
  label = "下载",
  disabled = false,
}: {
  filename: string;
  getContent: () => string;
  mime?: string;
  label?: string;
  disabled?: boolean;
}) {
  const onClick = () => {
    const blob = new Blob([getContent()], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn btn-outline !h-8 px-3 text-xs">
      <Download className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </button>
  );
}

export function ResetButton({
  onClick,
  label = "重置",
  disabled = false,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn btn-ghost !h-8 px-3 text-xs">
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </button>
  );
}

export function ClearButton({
  onClick,
  label = "清空",
  disabled = false,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn btn-ghost !h-8 px-3 text-xs">
      <Eraser className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </button>
  );
}

export function Message({
  tone,
  children,
}: {
  tone: "info" | "error" | "success";
  children: ReactNode;
}) {
  const cls = {
    info: "border-border bg-secondary/50 text-muted-foreground",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
    success: "border-success/30 bg-success/10 text-success",
  }[tone];
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cx("rounded-[2px] border px-3 py-2 text-[13px] leading-5", cls)}>
      {children}
    </p>
  );
}

export function ToolSection({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="label !mb-0">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function ResultBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={cx(
        "scroll-x max-h-[420px] w-full rounded-[3px] border border-border bg-secondary/40 p-3.5 font-mono text-[13px] leading-6 whitespace-pre-wrap break-all text-foreground/85",
        className,
      )}
    >
      {children}
    </pre>
  );
}
