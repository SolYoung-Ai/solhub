/**
 * 赞助位（右侧广告位）客户端。
 *
 * 口径与 worker 的 /ads/* 一致：
 *   - 购买 / 续费一次 = AD_PRICE 积分 = AD_DAYS 天；
 *   - 只能管理自己名下的位置（后端按 owner 校验，前端只是不给入口）。
 *
 * 注意：文件名不用 ads.ts —— 那个已经是 Google AdSense 的配置模块。
 */

import { request } from "@/lib/net";
import { base } from "@/lib/api-base";

export interface AdOption {
  slug: string;
  name: string;
  desc: string;
  icon: string;
  url: string;
}

export interface AdSlot {
  id: string;
  slug: string;
  name: string;
  desc: string;
  icon: string;
  url: string;
  owner?: string;
  ownerHandle?: string;
  startAt: string;
  endAt: string;
  createdAt: string;
  offlineAt?: string;
  /** live = 正在展示，ended = 到期，offline = 主动下架 */
  status?: "live" | "ended" | "offline";
  daysLeft?: number;
}

export interface AdsMineData {
  price: number;
  days: number;
  balance: number;
  available: number;
  ads: AdSlot[];
  options: AdOption[];
}

export type AdsResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unauth" | "forbidden" | "net" | "error"; error?: string };

async function call<T>(path: string, init?: RequestInit): Promise<AdsResult<T>> {
  try {
    const res = await request(`${base()}${path}`, { cache: "no-store", ...init }, { retries: 0 });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>;
    if (res.status === 401) return { ok: false, reason: "unauth", error: data.error };
    if (res.status === 403) return { ok: false, reason: "forbidden", error: data.error || "只能管理自己投放的赞助位" };
    if (!res.ok || data.ok === false) return { ok: false, reason: "error", error: data.error || `请求失败（${res.status}）` };
    return { ok: true, data: data as unknown as T };
  } catch {
    return { ok: false, reason: "net", error: "网络错误，请稍后重试" };
  }
}

const post = <T>(path: string, body: Record<string, unknown>) =>
  call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fetchMyAds = () => call<AdsMineData>("/ads/mine");

export const renewAd = (id: string) => post<{ slot: AdSlot; balance: number; message: string }>("/ads/renew", { id });

export const updateAdDesc = (id: string, desc: string) =>
  post<{ slot: AdSlot; message: string }>("/ads/update", { id, desc });

export const offlineAd = (id: string) => post<{ slot: AdSlot; message: string }>("/ads/offline", { id });
