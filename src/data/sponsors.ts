/* ============================================================
   赞助位（Sponsorship）
   ------------------------------------------------------------
   这里是唯一真源：档位定义 + 赞助商名单。
   以后接后台改档期，只需把 sponsors 换成后端读取，页面组件不用动。

   价格公开写在页面上：小站议价空间本来就小，透明反而能过滤掉
   「先问价再说」的低预算客户，也避免同一档位对不同人报不同价的尴尬。

   示例卡（status: "sample"）一律带「示例」角标，不会让访客误以为是
   已成交的广告；真实成交后把 status 改成 "live" 即可。
   ============================================================ */

export type SponsorTierId = "headline" | "inline" | "partner";

export interface SponsorTier {
  id: SponsorTierId;
  name: { zh: string; en: string };
  /** 月价（人民币），0 表示面议 */
  price: number;
  slot: { zh: string; en: string };
  perks: { zh: string; en: string }[];
  seats: { zh: string; en: string };
  /** 主推档位：卡片高亮 + 「最常买」角标 */
  featured?: boolean;
  /** 该档位对应的卡片形态，示例区按这个形态渲染 */
  cardVariant: "strip" | "card" | "bar";
}

export const sponsorTiers: SponsorTier[] = [
  {
    id: "headline",
    name: { zh: "头图位", en: "Headline" },
    price: 1200,
    slot: { zh: "首页首屏，整宽横幅", en: "Homepage hero, full width" },
    perks: [
      { zh: "首页首屏整宽横幅，30 天常驻", en: "Full-width banner in the homepage hero, 30 days" },
      { zh: "上线当天一条站点公告", en: "One site announcement on launch day" },
      { zh: "可带一条读者专属优惠码", en: "One reader-only offer code" },
      { zh: "曝光、点击月度回执", en: "Monthly impressions and clicks report" },
    ],
    seats: { zh: "每站 1 席", en: "1 seat per site" },
    cardVariant: "strip",
  },
  {
    id: "inline",
    name: { zh: "列表插入位", en: "Inline" },
    price: 600,
    slot: { zh: "产品列表 / Skill 库第 3 位", en: "3rd slot in products / skills" },
    perks: [
      { zh: "列表第 3 位，独立卡片样式，不挤占自然结果", en: "3rd slot, its own card style, no reflow of organic results" },
      { zh: "标注「赞助」，不参与排序、不影响核验状态", en: "Labelled sponsored; never affects ranking or verification" },
      { zh: "可选一条读者专属优惠", en: "Optional reader-only discount" },
      { zh: "曝光 + 点击双指标回执", en: "Impressions and clicks report" },
    ],
    seats: { zh: "每页 1 席", en: "1 seat per page" },
    featured: true,
    cardVariant: "card",
  },
  {
    id: "partner",
    name: { zh: "社区伙伴", en: "Community partner" },
    price: 300,
    slot: { zh: "页脚 + 关于页常驻", en: "Footer + About page" },
    perks: [
      { zh: "页脚常驻文字链", en: "Persistent footer link" },
      { zh: "关于页「支持者」名单", en: "Listed as a supporter on the About page" },
      { zh: "每季一次合作信提及", en: "Mentioned once per quarter" },
      { zh: "适合换资源：折扣码、开源赞助、联名", en: "Good for barters: codes, open-source sponsorship, co-branding" },
    ],
    seats: { zh: "不限席位", en: "Unlimited seats" },
    cardVariant: "bar",
  },
];

export type SponsorStatus = "sample" | "live";

export interface Sponsor {
  id: string;
  name: string;
  tagline: { zh: string; en: string };
  offer?: { zh: string; en: string };
  /** 站外/站内链接；空串表示暂无链接（示例卡按钮改为预订入口） */
  url: string;
  icon?: string;
  /** 无图标时的首字母方块 */
  initial: string;
  /** 图标方块底色 */
  accent: string;
  tier: SponsorTierId;
  status: SponsorStatus;
  /** 角标文案，例如「示例 · 站内产品」 */
  badge?: { zh: string; en: string };
}

export const sponsors: Sponsor[] = [
  {
    id: "nebula",
    name: "Nebula",
    tagline: { zh: "一条命令把项目部署到任何云", en: "Deploy to any cloud in one command" },
    offer: { zh: "独立开发者首年免费", en: "First year free for indie devs" },
    url: "",
    initial: "N",
    accent: "#7F77DD",
    tier: "headline",
    status: "sample",
    badge: { zh: "示例 · 头图位", en: "Sample · headline" },
  },
  {
    id: "pixelforge",
    name: "PixelForge",
    tagline: { zh: "给独立开发者的一套设计系统", en: "A design system built for indie devs" },
    offer: { zh: "SolHub 读者 8 折", en: "20% off for SolHub readers" },
    url: "",
    initial: "P",
    accent: "#1D9E75",
    tier: "inline",
    status: "sample",
    badge: { zh: "示例 · 列表位", en: "Sample · inline" },
  },
  {
    id: "solclip",
    name: "SolClip",
    tagline: { zh: "多平台短视频解析、下载与文案提取", en: "Parse, download and transcribe short videos" },
    offer: { zh: "已收录产品，可直接点开核验", en: "Listed product — open it to verify" },
    url: "/products/solclip/",
    icon: "/icons/solclip.png",
    initial: "S",
    accent: "#e87028",
    tier: "partner",
    status: "sample",
    badge: { zh: "示例 · 站内产品", en: "Sample · listed product" },
  },
];

/** 真正成交的赞助商；空数组时页面显示「首期招募中」 */
export const liveSponsors = sponsors.filter((s) => s.status === "live");

export function tierOf(id: SponsorTierId): SponsorTier {
  return sponsorTiers.find((t) => t.id === id) ?? sponsorTiers[0];
}
