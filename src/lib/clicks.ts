/**
 * 点击量统计（前端侧）
 * ==================
 *
 * 产品页的三条排序原则是「核验优先 / 全球精选 / 按点击量排名」，
 * 其中点击量是唯一需要运行时数据的部分：列表渲染时向 /stats/clicks
 * 取一份计数表，用户点「访问官网」「全屏使用」时向 /stats/click 加一。
 *
 * 设计约束：
 * - 统计失败绝不能影响用户跳转 —— 全部 fire-and-forget，异常吞掉；
 * - 计数表只在内存 + sessionStorage 缓存 5 分钟，列表页刷新不必每次都打接口；
 * - 后端按「IP + 目标」10 分钟去重，同一访客连点不会刷榜。
 */

import { base } from "@/lib/api-base";

export type ClickMap = Record<string, number>;

const CACHE_KEY = "solhub:clicks:v1";
const VISITOR_KEY = "solhub:vid:v1";
const CACHE_MS = 5 * 60 * 1000;

/** 访客标识（随机、与身份无关）：只用来做 10 分钟内重复点击去重。
    后端不存原值，只存摘要；换浏览器/清缓存会重新生成，丢了也无所谓。 */
function visitorId(): string {
  try {
    const cur = localStorage.getItem(VISITOR_KEY);
    if (cur) return cur;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return "";
  }
}

let memory: { at: number; map: ClickMap } | null = null;

function validMap(v: unknown): ClickMap {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: ClickMap = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    const num = Number(n);
    if (typeof k === "string" && k && Number.isFinite(num) && num > 0) out[k] = num;
  }
  return out;
}

/** 读点击量（失败返回空表：列表就退回「精选顺序」的默认排序） */
export async function fetchClicks(): Promise<ClickMap> {
  const now = Date.now();
  if (memory && now - memory.at < CACHE_MS) return memory.map;
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as { at?: number; map?: unknown };
      if (parsed && typeof parsed.at === "number" && now - parsed.at < CACHE_MS) {
        memory = { at: parsed.at, map: validMap(parsed.map) };
        return memory.map;
      }
    }
  } catch {
    /* 私密模式 / 存储被禁：忽略缓存 */
  }
  try {
    const res = await fetch(`${base()}/stats/clicks`, { cache: "no-store" });
    if (!res.ok) return memory ? memory.map : {};
    const data = (await res.json()) as { clicks?: unknown };
    const map = validMap(data.clicks);
    memory = { at: now, map };
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, map }));
    } catch {
      /* 存不进就算了 */
    }
    return map;
  } catch {
    return memory ? memory.map : {};
  }
}

/**
 * 记一次点击。不 await、不抛错：调用方拿到同步返回，
 * 跳转动作不会被统计拖慢（keepalive 保证页面跳走时请求仍会发出去）。
 */
export function recordClick(slug: string): void {
  if (!slug || typeof slug !== "string") return;
  try {
    void fetch(`${base()}/stats/click`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, vid: visitorId() }),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
    /* 本地先加一，用户返回列表时看到的顺序立刻合理 */
    if (memory) {
      memory.map[slug] = (Number(memory.map[slug]) || 0) + 1;
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: memory.at, map: memory.map }));
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    /* 统计失败不影响跳转 */
  }
}
