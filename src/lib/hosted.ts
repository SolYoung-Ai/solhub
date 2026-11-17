import { base } from "@/lib/api-base";

/** 公开托管工具（/hosted/list 返回的元信息，不含 html 与上传者账号） */
export interface HostedTool {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  createdAt: string;
}

interface HostedListResponse {
  ok?: boolean;
  total?: number;
  hasMore?: boolean;
  tools?: HostedTool[];
}

/**
 * 拉取公开托管工具目录。
 * 接口异常时返回空数组 —— 产品页是静态渲染的，不能因为接口挂了整页报错。
 */
export async function fetchHostedTools(limit = 100): Promise<HostedTool[]> {
  try {
    const res = await fetch(`${base()}/hosted/list?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as HostedListResponse;
    const list = Array.isArray(data.tools) ? data.tools : [];
    return list.filter((t) => t && t.id && t.name);
  } catch {
    return [];
  }
}
