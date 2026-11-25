import type { Product } from "@/data/types";
import type { ClickMap } from "@/lib/clicks";

/**
 * SolHub 产品排序规则 —— 与数据分离，页面只消费排序结果与规则说明。
 *
 * 规则（透明、可解释，不含任何随机分数，也没有付费位）：
 * 1. 核验状态权重：verified(0) > pending(1) > unverified(2)；
 * 2. 同一核验等级内**按点击量倒序**（口径见 /stats/click：只有「访问官网 /
 *    全屏使用」这类真实点击才计数，同一访客 10 分钟只计一次）；
 * 3. 点击量相同（刚收录、还没人点过）时按 rankPosition（全球精选顺序）；
 * 4. 最后按 publishedAt（收录时间）倒序兜底，保证列表稳定不跳动。
 *
 * 演示数据永远排最后。
 */
export function rankProducts(list: Product[], clicks?: ClickMap): Product[] {
  const c = clicks || {};
  return [...list].sort((a, b) => {
    const demo = Number(a.isDemo) - Number(b.isDemo);
    if (demo !== 0) return demo;
    const v = verificationWeight(a.verificationStatus) - verificationWeight(b.verificationStatus);
    if (v !== 0) return v;
    const ca = Number(c[a.slug]) || 0;
    const cb = Number(c[b.slug]) || 0;
    if (ca !== cb) return cb - ca;
    const ra = a.rankPosition ?? Number.MAX_SAFE_INTEGER;
    const rb = b.rankPosition ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

function verificationWeight(s: Product["verificationStatus"]): number {
  switch (s) {
    case "verified":
      return 0;
    case "pending":
      return 1;
    case "unverified":
      return 2;
  }
}

/** 排序规则说明（用于产品页 / 关于页向访问者解释排序机制） */
export const rankingRules: { title: string; detail: string }[] = [
  {
    title: "核验优先",
    detail: "已通过实际核验（Verified）的产品排在待核验与未核验之前。核验只代表链接真实可达，不是质量背书。",
  },
  {
    title: "全球精选",
    detail: "收录范围覆盖全球独立创作者的产品与在线工具，由 SolHub 编辑维护精选批次；点击量持平时按精选顺序排列。",
  },
  {
    title: "按点击量排名",
    detail: "同核验等级内按真实点击量排序：打开官网、进入工具都计一次，同一访客 10 分钟内只计一次；不设付费位。",
  },
];
