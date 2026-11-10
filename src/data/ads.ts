/* ============================================================
   广告位数据（赞助位）
   ------------------------------------------------------------
   规则（与 /sponsors/join/ 页面文案保持一致，改一处必须改另一处）：
   - 自由出价，不设档位；出价越高排得越前
   - 每期固定 30 天，到期自动下架（构建时过滤 + 前端再兜一层）
   - 金额不公开展示，只在入驻页给一个参考价，避免变成公开竞价
   - 这里可以宣传任何东西：产品、服务、活动、招募、开源项目

   将来接后台时，把 ADS 换成 KV / 接口读取即可，函数签名不用动。
   ============================================================ */

export const AD_DAYS = 30;

export interface Ad {
  /** 独立页面路径用：/sponsors/<id>/ */
  id: string;
  name: string;
  /** 一句话，卡片上用 */
  tagline: { zh: string; en: string };
  /** 长描述，独立页用 */
  body: { zh: string; en: string };
  /** 展示出来的域名（不显示完整 URL，卡片更干净） */
  displayUrl: string;
  url: string;
  icon?: string;
  initial: string;
  accent: string;
  /** 广告类型，仅作文案 */
  kind: { zh: string; en: string };
  /** 搜索关键词（中文 + 英文 + 拼音首字母都放进来） */
  keywords: string[];
  /** 赞助金额（人民币 / 30 天），只用于排序，不展示 */
  amount: number;
  /** 起投日 ISO（含时区），+30 天即到期 */
  startsAt: string;
}

export const ADS: Ad[] = [
  {
    id: "lunasol",
    name: "LunaSol",
    tagline: {
      zh: "AI 智能包装设计平台 · 从创意到印刷文件一站完成",
      en: "AI packaging design studio — from idea to print-ready files",
    },
    body: {
      zh: "LunaSol（AI Packaging Studio）是一站式 AI 包装设计平台：不需要设计经验，把想法告诉 AI 设计师 Luna，由她梳理需求、给出配色与结构建议，再完成版式设计、多种盒型的刀版展开图与印前检查，产出可交付的印刷文件。内置插舌盒、盖盒、飞机盒、自立袋等盒型，支持风格模板、AI 效果图以及出血与条码校验。",
      en: "LunaSol (AI Packaging Studio) is a one-stop AI packaging design platform. Describe the idea to Luna, the AI designer, and she works out the requirements, suggests colours and structure, then produces the layout, dielines for several box types and a prepress check — output you can hand to a printer. Built in: tuck-end, lidded, mailer and stand-up pouch dielines, style templates, AI mockups, bleed and barcode validation.",
    },
    displayUrl: "luna.solyoung.top",
    url: "https://luna.solyoung.top",
    icon: "/icons/lunasol.png",
    initial: "L",
    accent: "#e87028",
    kind: { zh: "产品", en: "Product" },
    keywords: ["lunasol", "luna", "包装", "包装设计", "设计", "印刷", "刀版", "印前", "ai设计", "包装盒", "自立袋", "packaging", "design", "dieline", "prepress"],
    amount: 20,
    startsAt: "2026-11-10T00:00:00+08:00",
  },
];

/** 到期时间：起投日 + 30 天 */
export function expiresAt(ad: Ad): Date {
  return new Date(new Date(ad.startsAt).getTime() + AD_DAYS * 86_400_000);
}

/** 剩余天数（向上取整，最后一天显示 1） */
export function daysLeft(ad: Ad, now: Date = new Date()): number {
  const ms = expiresAt(ad).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function isActive(ad: Ad, now: Date = new Date()): boolean {
  return new Date(ad.startsAt).getTime() <= now.getTime() && daysLeft(ad, now) > 0;
}

/**
 * 排序：出价高者在前；同价先到先得（startsAt 早的在前）；
 * 都相同再按 id 稳定排序，保证构建结果可复现。
 */
export function rankAds(list: Ad[] = ADS, now: Date = new Date()): Ad[] {
  return list
    .filter((ad) => isActive(ad, now))
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      const t = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      if (t !== 0) return t;
      return a.id.localeCompare(b.id);
    });
}

/** 参考价：当前排在第一位的出价，入驻页用它给一个锚点 */
export function floorPrice(list: Ad[] = ADS, now: Date = new Date()): number {
  const ranked = rankAds(list, now);
  return ranked.length > 0 ? ranked[0].amount : 0;
}

/** 最便宜的在售价格，用于「¥xx 起」 */
export function lowestPrice(list: Ad[] = ADS, now: Date = new Date()): number {
  const active = list.filter((ad) => isActive(ad, now));
  if (active.length === 0) return 0;
  return Math.min(...active.map((a) => a.amount));
}
