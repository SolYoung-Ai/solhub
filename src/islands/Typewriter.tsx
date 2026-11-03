import { useEffect, useMemo, useState } from "react";

interface TypewriterProps {
  /** 逐行文本：手机端行内接续（自动换行），sm 以上每行独立成行 */
  lines: string[];
  /** 每字间隔（毫秒） */
  speed?: number;
  /** 开始前延迟（毫秒） */
  startDelay?: number;
  /** 打完是否保留光标闪烁 */
  keepCaret?: boolean;
  className?: string;
}

/** 标点后多停一拍，读起来更像真人在输入 */
const PAUSE_AFTER = /[，。、；：！？,.;:!?]/;

/**
 * 打字机效果：像终端里逐字输出。
 *
 * 无障碍 / SEO 处理：
 * - 完整文本始终以 `sr-only` 输出（爬虫与读屏软件拿到的是完整句子）；
 * - 逐字显示的视觉层加 `aria-hidden`，避免读两遍；
 * - 无 JS 时由页面的 `<noscript>` 样式把 `sr-only` 复原成可见文本；
 * - 系统开启「减弱动态效果」时直接显示全文，不做动画。
 */
export default function Typewriter({
  lines,
  speed = 38,
  startDelay = 320,
  keepCaret = false,
  className = "",
}: TypewriterProps) {
  const { offsets, total, full } = useMemo(() => {
    const offs: number[] = [];
    let acc = 0;
    for (const line of lines) {
      offs.push(acc);
      acc += line.length;
    }
    return { offsets: offs, total: acc, full: lines.join("") };
  }, [lines]);

  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || total === 0) {
      setCount(total);
      setDone(true);
      return;
    }

    let typed = 0;
    let timer: number | undefined;
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      typed += 1;
      setCount(typed);
      if (typed >= total) {
        setDone(true);
        return;
      }
      const ch = full[typed - 1] ?? "";
      timer = window.setTimeout(step, speed + (PAUSE_AFTER.test(ch) ? 160 : 0));
    };

    const kick = window.setTimeout(step, startDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(kick);
      if (timer) window.clearTimeout(timer);
    };
  }, [full, total, speed, startDelay]);

  /* 光标跟着「当前打到的字符」走：若正好落在换行处，留在上一行末尾 */
  const caretRow = useMemo(() => {
    for (let i = 0; i < lines.length; i += 1) {
      if (count <= offsets[i] + lines[i].length) return i;
    }
    return lines.length - 1;
  }, [count, lines, offsets]);

  const showCaret = !done || keepCaret;

  return (
    <span className={className}>
      <span className="tw-sr sr-only">{lines.join("")}</span>
      <span aria-hidden="true">
        {lines.map((line, i) => {
          const start = offsets[i];
          const shown = Math.max(0, Math.min(line.length, count - start));
          return (
            <span key={i} className="sm:block">
              {line.slice(0, shown)}
              {showCaret && caretRow === i && (
                <span
                  className="tw-caret"
                  style={{ transition: done ? "opacity .45s ease .6s" : undefined, opacity: done ? 0 : 1 }}
                />
              )}
            </span>
          );
        })}
      </span>
    </span>
  );
}
