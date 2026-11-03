/**
 * SolHub 统一数据模型
 * 所有页面（首页 / 产品 / 搜索 / 详情）都从统一数据源读取。
 */

export type VerificationStatus = "verified" | "pending" | "unverified";

export interface Product {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  /** 英文版一句话介绍 / 描述 */
  shortDescriptionEn?: string;
  descriptionEn?: string;
  websiteUrl: string;
  /** 图标 URL；为空时使用首字母占位符 */
  icon?: string;
  /** 分类 slug，对应 Category.slug */
  category: string;
  tags: string[];
  developerName: string;
  /**
   * 开发者账号（登录名 / 邮箱）。有值时产品详情页的「开发者」会链接到
   * 该账号的创作者主页（/world/?u=<login>）；为空则只显示纯文本。
   */
  developerLogin?: string;
  /** 社区产品的提交者账号（由 Worker 写入 community.json，作为 developerLogin 的兜底） */
  submittedBy?: string;
  /** ISO 日期 */
  publishedAt: string;
  launchBatch: string;
  verificationStatus: VerificationStatus;
  /** 核验方式说明 */
  verificationMethod?: string;
  verifiedAt?: string;
  /** 精选排序值（人工精选顺序），可选 */
  rankPosition?: number;
  /** 是否为演示数据。演示数据不会获得虚假核验状态。 */
  isDemo: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Lucide 图标名 */
  icon: string;
}

export interface Submission {
  id: string;
  productFields: {
    name: string;
    websiteUrl: string;
    shortDescription: string;
    description: string;
    category: string;
    tags: string[];
    iconUrl?: string;
    developerName: string;
    contact?: string;
    launchBatch?: string;
  };
  status: "draft" | "submitted";
  createdAt: string;
  submissionProvider: string;
}

/**
 * CloudBase 社区提交的归一化结构（对应 submissions 表）。
 * 产品与工具统一存储：kind 区分，tool_type 区分外链 / 托管。
 */
export interface CloudBaseSubmission {
  id: number;
  kind: "product" | "tool";
  name: string;
  shortDescription: string;
  description: string;
  url: string;
  category: string;
  tags: string[];
  iconUrl: string;
  developer: string;
  contact: string;
  toolType?: "external" | "hosted";
  hostedKey?: string;
  status: "approved" | "hidden" | "rejected";
  createdAt: string;
}

export interface SearchIndexEntry {
  kind: "product";
  slug: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  tags: string[];
  keywords?: string[];
  isDemo?: boolean;
}
