/**
 * 收藏（本地优先，仅存在当前浏览器）
 * ================================
 *
 * 取舍说明：收藏目前**不做云端同步**，只写 localStorage。这样不用登录、
 * 不产生任何服务端请求，隐私上最干净；代价是换设备 / 换浏览器看不到。
 * 站内「我的 → 收藏」和小程序里的收藏是两套独立数据，各存各的。
 *
 * 存的是「快照」而不是 id：收藏列表要能离线打开，也不能因为目录接口挂掉就空白。
 * 快照里只放展示需要的字段（名称、简介、分类、链接），不含任何个人数据。
 */

export type FavKind = "product" | "tool";

export interface FavItem {
  kind: FavKind;
  /** 产品用 slug，工具用工具 id */
  id: string;
  name: string;
  desc: string;
  /** 站内详情页或官网地址（点击收藏条目就跳这里） */
  href: string;
  /** 图标地址（可为空） */
  icon?: string;
  /** 分类名等一行小字 */
  meta?: string;
  addedAt: number;
}

const KEY = "solhub:fav:v1";
const EVENT = "solhub:fav";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function sanitize(raw: unknown): FavItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FavItem[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const kind = o.kind === "tool" ? "tool" : o.kind === "product" ? "product" : null;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!kind || !id || !name) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind,
      id,
      name,
      desc: typeof o.desc === "string" ? o.desc : "",
      href: typeof o.href === "string" && o.href ? o.href : "#",
      icon: typeof o.icon === "string" ? o.icon : "",
      meta: typeof o.meta === "string" ? o.meta : "",
      addedAt: Number(o.addedAt) || 0,
    });
  }
  /* 最近收藏的排前面 */
  return out.sort((a, b) => b.addedAt - a.addedAt);
}

export function readFavorites(): FavItem[] {
  const s = storage();
  if (!s) return [];
  try {
    return sanitize(JSON.parse(s.getItem(KEY) || "[]"));
  } catch {
    return [];
  }
}

function write(list: FavItem[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(list.slice(0, 300)));
  } catch {
    /* 配额满 / 被禁：静默，功能降级为「点了没记住」 */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* 忽略 */
  }
}

export function isFavorite(kind: FavKind, id: string): boolean {
  return readFavorites().some((f) => f.kind === kind && f.id === id);
}

/** 切换收藏，返回切换后的状态（true = 现在已收藏） */
export function toggleFavorite(item: Omit<FavItem, "addedAt">): boolean {
  const list = readFavorites();
  const idx = list.findIndex((f) => f.kind === item.kind && f.id === item.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    write(list);
    return false;
  }
  list.unshift({ ...item, addedAt: Date.now() });
  write(list);
  return true;
}

export function removeFavorite(kind: FavKind, id: string): void {
  write(readFavorites().filter((f) => !(f.kind === kind && f.id === id)));
}

/** 订阅变化（同一页里多个入口——详情页按钮、我的页列表——保持一致） */
export function subscribeFavorites(cb: (list: FavItem[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb(readFavorites());
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb(readFavorites());
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** 收藏列表内的搜索：名称 / 简介 / 分类，全部小写包含匹配 */
export function filterFavorites(list: FavItem[], query: string): FavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const words = q.split(/\s+/).filter(Boolean);
  return list.filter((f) => {
    const hay = `${f.name} ${f.desc} ${f.meta || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
