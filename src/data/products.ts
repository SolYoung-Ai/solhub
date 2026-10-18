import type { Product } from "./types";

/**
 * SolHub 产品数据。
 *
 * 数据诚实性约定：
 * 1. isDemo=true 的产品是演示数据，仅用于展示产品形态，页面会显示「演示数据」标记，
 *    且不会被授予任何核验状态（verificationStatus 一律为 unverified）。
 * 2. verificationStatus="verified" 仅授予 SolHub 编辑已实际核验的产品：
 *    人工访问官网 → 核对产品名称、描述、站点可访问性 → 记录核验时间与方法。
 * 3. publishedAt 表示「SolHub 收录时间」（即加入本平台的时间），不是产品自身的发布日期，
 *    避免编造无法核实的发布时间；榜单批次 launchBatch 表示人工精选批次。
 * 4. rankPosition 是人工精选顺序，规则见 src/lib/ranking.ts，与数据分离。
 */
export const products: Product[] = [
  {
    id: "solyoung",
    slug: "solyoung",
    name: "SolYoung",
    icon: "/solhub/icons/solyoung.jpg",
    shortDescription: "一个把想法变成作品的人 —— 个人数字空间，持续运营。",
    description:
      "SolYoung 是独立创作者宋杨（Sol Young）的个人网站：以数字档案式排版承载作品集、此刻时间线、思考文章与产品入口，是个人品牌的主阵地。内容覆盖影像创作、AI 实践与轻量产品开发，持续更新。",
    websiteUrl: "https://solyoung.top",
    category: "creator-space",
    tags: ["personal-site", "portfolio", "content"],
    developerName: "Sol Young",
    publishedAt: "2026-10-16",
    launchBatch: "Curated W42",
    verificationStatus: "verified",
    verificationMethod:
      "人工访问 https://solyoung.top，核对产品名称、定位与页面内容后核验通过。",
    verifiedAt: "2026-10-16",
    rankPosition: 2,
    isDemo: false,
  },
  {
    id: "solyoung-studio",
    slug: "solyoung-studio",
    name: "SolYoung Studio",
    icon: "/solhub/icons/solyoung-studio.png",
    shortDescription: "AI 个人网站、数字空间与轻量产品制作服务。",
    description:
      "SolYoung Studio 是面向创作者、自由职业者和小型品牌的服务型站点：从需求梳理、视觉设计到 AI 辅助制作与部署，把想法逐步变成真实可用的作品，并提供品牌与商业合作入口。",
    websiteUrl: "https://solyoung.top/studio/",
    category: "services",
    tags: ["website", "brand", "ai-assisted"],
    developerName: "Sol Young",
    publishedAt: "2026-10-16",
    launchBatch: "Curated W42",
    verificationStatus: "verified",
    verificationMethod:
      "人工访问 https://solyoung.top/studio/，核对服务定位与页面内容后核验通过。",
    verifiedAt: "2026-10-16",
    rankPosition: 3,
    isDemo: false,
  },
  {
    id: "myos",
    slug: "myos",
    name: "My.OS",
    icon: "/solhub/icons/myos.png",
    shortDescription: "属于独立创作者的本地工作台：记录 → 思考 → 创作 → 交付 → 归档。",
    description:
      "My.OS 是一套在线可用的个人创作系统：把记录、灵感、创作、项目、此刻与档案收拢在同一个入口，减少想法散落的焦虑，免费开放使用。",
    websiteUrl: "https://solyoung.top/OS/",
    category: "productivity",
    tags: ["personal-os", "notes", "productivity"],
    developerName: "Sol Young",
    publishedAt: "2026-10-16",
    launchBatch: "Curated W42",
    verificationStatus: "verified",
    verificationMethod:
      "人工访问 https://solyoung.top/OS/，核对产品功能与可用性后核验通过。",
    verifiedAt: "2026-10-16",
    isDemo: false,
  },
  {
    id: "verity",
    slug: "verity",
    name: "Verity",
    icon: "/solhub/icons/verity.png",
    shortDescription: "把 13 套人格测试收拢在一个站点，选一套就能开始测。",
    description:
      "Verity 是在线可用的测试集合站：结构统一的性格测试入口，结果即时生成，免费开放。适合想快速了解自己的人。",
    websiteUrl: "https://solyoung.top/Verity/",
    category: "fun-tools",
    tags: ["personality", "quiz", "free"],
    developerName: "Sol Young",
    publishedAt: "2026-10-16",
    launchBatch: "Curated W42",
    verificationStatus: "verified",
    verificationMethod:
      "人工访问 https://solyoung.top/Verity/，核对测试功能与可用性后核验通过。",
    verifiedAt: "2026-10-16",
    isDemo: false,
  },
  {
    id: "camsim",
    slug: "camsim",
    name: "CamSim",
    icon: "/solhub/icons/camsim.png",
    shortDescription: "相机参数模拟器：从想拍的效果反推光圈、快门与 ISO。",
    description:
      "CamSim 是面向摄影新手的交互工具：告诉它你想拍成什么样，得到一组可参考的光圈 / 快门 / ISO 参数，免费开放使用。",
    websiteUrl: "https://solyoung.top/CamSim/",
    category: "creator-tools",
    tags: ["photography", "simulator", "free"],
    developerName: "Sol Young",
    publishedAt: "2026-10-16",
    launchBatch: "Curated W42",
    verificationStatus: "verified",
    verificationMethod:
      "人工访问 https://solyoung.top/CamSim/，核对工具功能与可用性后核验通过。",
    verifiedAt: "2026-10-16",
    isDemo: false,
  },
];

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function getRealProducts(): Product[] {
  return products.filter((p) => !p.isDemo);
}

export function getDemoProducts(): Product[] {
  return products.filter((p) => p.isDemo);
}
