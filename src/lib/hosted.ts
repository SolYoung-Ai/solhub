import { base } from "@/lib/api-base";

/** 公开托管工具（/hosted/list 返回的元信息，不含 html 与上传者账号） */
export interface HostedTool {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  createdAt: string;
  /** 官方工具署名（普通用户提交为空） */
  author?: string;
  /** 图标地址（走 /hosted/logo/<id>），没有图标时为空 */
  logoUrl?: string;
}

interface HostedListResponse {
  ok?: boolean;
  total?: number;
  hasMore?: boolean;
  tools?: HostedTool[];
}

/**
 * 拉取公开托管工具目录（一次拉全，产品页不做分页）。
 * 接口单页最多 100 条，所以按 offset 翻页直到 hasMore=false；接口异常时
 * 返回已经拿到的部分 —— 产品页是静态渲染的，不能因为接口挂了整页报错。
 */
export async function fetchHostedTools(limit = 100): Promise<HostedTool[]> {
  const all: HostedTool[] = [];
  let offset = 0;
  try {
    for (let page = 0; page < 20; page++) {
      const res = await fetch(`${base()}/hosted/list?limit=${limit}&offset=${offset}`, { cache: "no-store" });
      if (!res.ok) break;
      const data = (await res.json()) as HostedListResponse;
      const list = (Array.isArray(data.tools) ? data.tools : []).filter((t) => t && t.id && t.name);
      all.push(...list);
      if (!data.hasMore || list.length === 0) break;
      offset += list.length;
    }
  } catch {
    /* 网络异常：返回已拿到的部分 */
  }
  return all;
}
