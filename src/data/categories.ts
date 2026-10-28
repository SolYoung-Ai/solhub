import type { Category } from "./types";

/** 工具分类（首页分类入口、工具详情、筛选共用） */
export const categories: Category[] = [
  {
    id: "developer-tools",
    slug: "developer-tools",
    name: "Developer Tools",
    description: "面向开发者的日常效率工具：JSON、代码、编码与生成类。",
    icon: "Code2",
  },
  {
    id: "seo-web",
    slug: "seo-web",
    name: "SEO & Web",
    description: "网页与搜索引擎相关的工具：URL、robots、结构化数据。",
    icon: "Globe",
  },
  {
    id: "text-content",
    slug: "text-content",
    name: "Text & Content",
    description: "文本统计与内容处理工具。",
    icon: "FileText",
  },
  {
    id: "images",
    slug: "images",
    name: "Images",
    description: "图片生成、压缩与二维码等图像工具。",
    icon: "Image",
  },
  {
    id: "converters-calculators",
    slug: "converters-calculators",
    name: "Converters & Calculators",
    description: "时间戳、颜色、比例等转换与计算工具。",
    icon: "Calculator",
  },
  {
    id: "growth-marketing",
    slug: "growth-marketing",
    name: "Growth & Marketing",
    description: "推广与增长相关工具：UTM 链接构建等。",
    icon: "TrendingUp",
  },
];

export function getCategory(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}

export function categoryName(slug: string): string {
  return getCategory(slug)?.name ?? slug;
}
