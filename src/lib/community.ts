/**
 * 社区产品（站内提交、已收录的那部分）。
 *
 * 背景：产品列表是静态构建的，社区产品来自构建那一刻的 src/data/community.json。
 * 用户在产品页删掉自己的产品后，云端 KV 已经删了，但如果仓库同步没成功（PAT 过期等），
 * 静态页会一直挂着这条已删除的产品 —— 用户看到的就是「删了还在」。
 *
 * 所以列表页挂载后再拉一次 /community，把「社区那部分」整体换成实时数据：
 * 删除立刻消失、新提交立刻出现，都不依赖重新构建。
 * 接口不可用时返回 null，前端继续用构建期数据（不能因为接口挂了整页变空）。
 */

import { base } from "@/lib/api-base";
import type { Product } from "@/data/types";

interface CommunityResponse {
  ok?: boolean;
  products?: Product[];
}

export async function fetchLiveCommunity(timeoutMs = 8000): Promise<Product[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}/community`, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as CommunityResponse;
    if (!data || !Array.isArray(data.products)) return null;
    return data.products.filter((p) => p && p.slug && p.name);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
