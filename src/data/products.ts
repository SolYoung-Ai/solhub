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
    id: "videolab",
    slug: "videolab",
    name: "VideoLAB",
    shortDescription: "文案 + 素材 → 自动成片：面向短视频创作者的自动化剪辑系统。",
    description:
      "VideoLAB 是 SolYoung 开发的自动化剪辑工作台：粘贴脚本、上传素材即可自动成片。内置自动拆句理解、画面匹配、配音字幕、多轨时间轴真实编辑、6 套字体与 6 种字幕风格预设，支持 WebCodecs + MP4 Muxer 真实导出 MP4 与 SRT 字幕。当前处于测试体验阶段。",
    websiteUrl: "https://solyoung.top/video/",
    category: "ai-tools",
    tags: ["video", "auto-edit", "ai"],
    developerName: "Sol Young",
    publishedAt: "2026-10-16",
    launchBatch: "Curated W42",
    verificationStatus: "verified",
    verificationMethod:
      "人工访问 https://solyoung.top/video/，核对产品功能描述与可用性后核验通过。",
    verifiedAt: "2026-10-16",
    rankPosition: 1,
    isDemo: false,
  },
  {
    id: "myos",
    slug: "myos",
    name: "My.OS",
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

  // ---- 以下为演示数据（isDemo=true，verificationStatus 一律 unverified）----
  {
    id: "launchpulse",
    slug: "launchpulse",
    name: "LaunchPulse",
    shortDescription: "独立产品发布倒计时与订阅提醒（演示数据）。",
    description:
      "这是一条演示数据：用于展示 SolHub 产品详情页的信息架构。LaunchPulse 是一个虚构的发布倒计时产品，帮助独立开发者管理产品上线节奏与早期订阅者。",
    websiteUrl: "https://example.com/launchpulse",
    category: "growth-marketing",
    tags: ["launch", "countdown", "demo"],
    developerName: "Demo Studio",
    publishedAt: "2026-10-16",
    launchBatch: "Demo",
    verificationStatus: "unverified",
    isDemo: true,
  },
  {
    id: "draftdesk",
    slug: "draftdesk",
    name: "DraftDesk",
    shortDescription: "把草稿变成成稿的 AI 写作助手（演示数据）。",
    description:
      "这是一条演示数据：DraftDesk 是虚构的 AI 写作产品，用于展示 SolHub 产品列表的条目形态。真实产品请通过 Submit 提交。",
    websiteUrl: "https://example.com/draftdesk",
    category: "ai-tools",
    tags: ["ai-writing", "draft", "demo"],
    developerName: "Demo Studio",
    publishedAt: "2026-10-16",
    launchBatch: "Demo",
    verificationStatus: "unverified",
    isDemo: true,
  },
  {
    id: "pixelmerge",
    slug: "pixelmerge",
    name: "PixelMerge",
    shortDescription: "批量图片拼接与网格合成（演示数据）。",
    description:
      "这是一条演示数据：PixelMerge 是虚构的图片处理工具，用于展示 SolHub 分类与标签的呈现方式。",
    websiteUrl: "https://example.com/pixelmerge",
    category: "design-tools",
    tags: ["image", "merge", "demo"],
    developerName: "Demo Studio",
    publishedAt: "2026-10-16",
    launchBatch: "Demo",
    verificationStatus: "unverified",
    isDemo: true,
  },
  {
    id: "metaroute",
    slug: "metaroute",
    name: "MetaRoute",
    shortDescription: "关键词路线图与内容选题规划（演示数据）。",
    description:
      "这是一条演示数据：MetaRoute 是虚构的 SEO 规划产品，用于展示 SolHub 榜单的数据结构。",
    websiteUrl: "https://example.com/metaroute",
    category: "growth-marketing",
    tags: ["seo", "keywords", "demo"],
    developerName: "Demo Studio",
    publishedAt: "2026-10-16",
    launchBatch: "Demo",
    verificationStatus: "unverified",
    isDemo: true,
  },
  {
    id: "flownote",
    slug: "flownote",
    name: "FlowNote",
    shortDescription: "极简记录与灵感收集（演示数据）。",
    description:
      "这是一条演示数据：FlowNote 是虚构的笔记产品，用于展示 SolHub 首页新品发布区域的卡片样式。",
    websiteUrl: "https://example.com/flownote",
    category: "productivity",
    tags: ["notes", "minimal", "demo"],
    developerName: "Demo Studio",
    publishedAt: "2026-10-16",
    launchBatch: "Demo",
    verificationStatus: "unverified",
    isDemo: true,
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
