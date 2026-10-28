import type { Product } from "@/data/types";

/**
 * SolHub 榜单排序规则 —— 与数据分离，页面只消费排序结果与规则说明。
 *
 * 规则（透明、可解释，v1 以人工精选 + 核验状态为主，不包含任何随机分数）：
 * 1. 核验状态权重：verified(0) > pending(1) > unverified(2)；
 * 2. 配置了 rankPosition（人工精选顺序）的产品按 rankPosition 升序；
 * 3. 其余产品按 publishedAt（收录时间）倒序；
 * 4. 未来接入公开投票后，投票将用于同权重产品之间的辅助排序，不参与核验判定，
 *    不允许通过付费购买排名。
 */
export function rankProducts(list: Product[]): Product[] {
  return [...list].sort((a, b) => {
    const demo = Number(a.isDemo) - Number(b.isDemo);
    if (demo !== 0) return demo;
    const v = verificationWeight(a.verificationStatus) - verificationWeight(b.verificationStatus);
    if (v !== 0) return v;
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

/** 排序规则说明（用于榜单页向访问者解释排名机制） */
export const rankingRules: { title: string; detail: string }[] = [
  {
    title: "核验优先",
    detail: "已通过实际核验（Verified）的产品排在待核验与未核验之前。",
  },
  {
    title: "人工精选",
    detail: "每周由 SolHub 编辑挑选值得关注的产品，配置明确的精选顺序（rankPosition）。",
  },
  {
    title: "不购买排名",
    detail: "当前没有投票与付费排序机制；未来若引入公开投票，投票仅用于同权重产品之间的辅助排序。",
  },
];
