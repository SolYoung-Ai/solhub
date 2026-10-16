/**
 * SolHub 统一数据模型
 * 所有页面（首页 / 榜单 / 工具 / 搜索 / 详情）都从统一数据源读取。
 */

export type VerificationStatus = "verified" | "pending" | "unverified";

export interface Product {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  websiteUrl: string;
  /** 图标 URL；为空时使用首字母占位符 */
  icon?: string;
  /** 分类 slug，对应 Category.slug */
  category: string;
  tags: string[];
  developerName: string;
  /** ISO 日期 */
  publishedAt: string;
  launchBatch: string;
  verificationStatus: VerificationStatus;
  /** 核验方式说明 */
  verificationMethod?: string;
  verifiedAt?: string;
  /** 榜单排序值（人工精选顺序），可选 */
  rankPosition?: number;
  /** 是否为演示数据。演示数据不会获得虚假核验状态。 */
  isDemo: boolean;
}

export interface Tool {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  /** Lucide 图标名 */
  icon: string;
  /** 对应 src/islands/tools/ 下的组件 key */
  component: string;
  /** 是否真正实现（注册表里不允许有只有卡片没有逻辑的工具） */
  isImplemented: boolean;
  relatedToolIds: string[];
  keywords: string[];
  /** 限制 / 隐私说明（用于工具详情页） */
  note?: string;
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

export interface SearchIndexEntry {
  kind: "product" | "tool";
  slug: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  tags: string[];
  keywords?: string[];
  isDemo?: boolean;
}
