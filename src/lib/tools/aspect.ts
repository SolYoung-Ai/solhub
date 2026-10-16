/** 宽高比计算纯逻辑 */

export interface AspectResult {
  width: number | null;
  height: number | null;
  ratio: string;
  isLandscape: boolean;
}

export function calculateAspect(args: {
  width?: string;
  height?: string;
  ratio?: string;
}): { ok: true; result: AspectResult } | { ok: false; error: string } {
  const width = parseNum(args.width);
  const height = parseNum(args.height);
  let ratio = parseRatio(args.ratio);

  const known = [width, height, ratio].filter((v) => v !== null).length;
  if (known === 0) {
    return { ok: false, error: "请至少输入宽度、高度或比例中的一项。" };
  }

  let outW = width;
  let outH = height;

  if (outW !== null && outH !== null && ratio !== null) {
    // 三项都给了：以宽度为准验证比例，若不一致以比例重算高度并提示
    outH = outW / ratio;
  } else if (outW !== null && outH === null && ratio !== null) {
    outH = outW / ratio;
  } else if (outW === null && outH !== null && ratio !== null) {
    outW = outH * ratio;
  } else if (outW !== null && outH !== null && ratio === null) {
    ratio = outW / outH;
  } else {
    return { ok: false, error: "已知条件不足：比例必须与宽度或高度中的至少一项同时给出。" };
  }

  if (outW !== null && outH !== null && (outW <= 0 || outH <= 0)) {
    return { ok: false, error: "尺寸必须为正数。" };
  }
  if (outW !== null && outW > 1e7) return { ok: false, error: "宽度数值过大。" };
  if (outH !== null && outH > 1e7) return { ok: false, error: "高度数值过大。" };

  const r = outW !== null && outH !== null ? outW / outH : 1;
  return {
    ok: true,
    result: {
      width: outW !== null ? round(outW) : null,
      height: outH !== null ? round(outH) : null,
      ratio: simplifyRatio(r),
      isLandscape: r >= 1,
    },
  };
}

export const commonRatios: { label: string; value: string }[] = [
  { label: "1:1（方形）", value: "1:1" },
  { label: "4:3（经典）", value: "4:3" },
  { label: "3:2（照片）", value: "3:2" },
  { label: "16:9（视频）", value: "16:9" },
  { label: "21:9（超宽）", value: "21:9" },
  { label: "9:16（竖屏）", value: "9:16" },
  { label: "3:4（竖版）", value: "3:4" },
  { label: "2:3（竖版）", value: "2:3" },
  { label: "1:1.91（卡片）", value: "1:1.91" },
];

function parseNum(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseRatio(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const s = v.trim();
  const m = /^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a <= 0 || b <= 0) return null;
  return a / b;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function simplifyRatio(r: number): string {
  // 常见整数比例优先
  for (const c of commonRatios) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(c.value);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (Math.abs(r - a / b) < 0.001) return c.value;
  }
  return `1 : ${round(1 / r)}`;
}
