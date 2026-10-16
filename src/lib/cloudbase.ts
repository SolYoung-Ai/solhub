/**
 * SolHub × CloudBase 数据接入层（浏览器端专用）。
 *
 * 架构：GitHub Pages 纯静态前端 → CloudBase PostgreSQL（app.rdb() PostgREST 风格 API）
 * 身份：Publishable Key 即 anon 公开身份，RLS 控制读写边界：
 *   - anon 可 INSERT status='approved' 的行（提交即自动公开）
 *   - anon 可 SELECT status='approved' 的行（公开读取）
 *   - 托管工具 HTML 存 pgstore 桶 solhub-tools（仅 text/html，≤1MB），
 *     读取走临时签名 URL，运行于沙箱 iframe。
 *
 * 安全边界：本模块不包含任何秘密。严禁在此处放置 API Key / service_role 凭据。
 */
import type { CloudBaseSubmission } from "@/data/types";

const ENV_ID = import.meta.env.PUBLIC_CLOUDBASE_ENV_ID as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.PUBLIC_CLOUDBASE_PUBLISHABLE_KEY as string | undefined;

export function isCloudBaseConfigured(): boolean {
  return Boolean(ENV_ID && PUBLISHABLE_KEY);
}

/** 懒加载并返回 { app, db }；仅在浏览器端且已配置时可用。带 10 秒超时，防止 SDK init 挂起。 */
async function getClient(): Promise<{ app: any; db: any } | null> {
  if (typeof window === "undefined" || !isCloudBaseConfigured()) return null;
  try {
    const cloudbase = await Promise.race([
      import("@cloudbase/js-sdk"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("CloudBase SDK init timeout")), 10000),
      ),
    ]);
    const app = cloudbase.init({
      env: ENV_ID,
      accessKey: PUBLISHABLE_KEY,
      auth: { detectSessionInUrl: true },
    });
    return { app, db: app.rdb() };
  } catch (e) {
    console.error("[SolHub] getClient failed", e);
    return null;
  }
}

export interface CommunitySubmissionRow {
  id: number;
  kind: "product" | "tool";
  name: string;
  short_description: string | null;
  description: string | null;
  url: string | null;
  category: string | null;
  tags: string[] | null;
  icon_url: string | null;
  developer: string | null;
  contact: string | null;
  tool_type: "external" | "hosted" | null;
  hosted_key: string | null;
  status: "approved" | "hidden" | "rejected";
  created_at: string;
}

/** 读取已公开（approved）的社区提交，按时间倒序。 */
export async function fetchCommunitySubmissions(
  kind?: "product" | "tool",
  limit = 20,
): Promise<CommunitySubmissionRow[]> {
  const client = await getClient();
  if (!client) return [];
  try {
    let q = client.db
      .from("submissions")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (kind) q = q.eq("kind", kind);
    const { data, error } = await q;
    if (error) {
      console.error("[SolHub] fetchCommunitySubmissions error", error);
      return [];
    }
    return (data ?? []) as CommunitySubmissionRow[];
  } catch (e) {
    console.error("[SolHub] fetchCommunitySubmissions failed", e);
    return [];
  }
}

/** 社区提交载荷（由表单组装，字段与 submissions 表对齐）。 */
export interface CloudbaseSubmissionPayload {
  kind: "product" | "tool";
  name: string;
  short_description?: string;
  description?: string;
  url?: string;
  category?: string;
  tags?: string[];
  icon_url?: string;
  developer?: string;
  contact?: string;
  tool_type?: "external" | "hosted";
  hosted_key?: string;
}

/** 提交到 CloudBase（匿名 anon 身份；status 由数据库 DEFAULT 为 approved 并受 RLS 强制）。 */
export async function submitToCloudbase(
  payload: CloudbaseSubmissionPayload,
): Promise<{ ok: boolean; message: string; row?: CommunitySubmissionRow }> {
  const client = await getClient();
  if (!client) return { ok: false, message: "无法连接 CloudBase（初始化超时或网络不可达），请稍后重试。" };
  try {
    const insertPayload: Record<string, unknown> = {
      kind: payload.kind,
      name: payload.name.trim(),
      tags: payload.tags && payload.tags.length ? payload.tags : [],
    };
    if (payload.short_description) insertPayload.short_description = payload.short_description.trim();
    if (payload.description) insertPayload.description = payload.description.trim();
    if (payload.url) insertPayload.url = payload.url.trim();
    if (payload.category) insertPayload.category = payload.category;
    if (payload.icon_url) insertPayload.icon_url = payload.icon_url.trim();
    if (payload.developer) insertPayload.developer = payload.developer.trim();
    if (payload.contact) insertPayload.contact = payload.contact.trim();
    if (payload.tool_type) insertPayload.tool_type = payload.tool_type;
    if (payload.hosted_key) insertPayload.hosted_key = payload.hosted_key;
    // 注意：不传 status —— 数据库 DEFAULT 'approved' 且 RLS WITH CHECK 强制其为 approved。

    const { data, error } = await client.db.from("submissions").insert(insertPayload).select();
    if (error) {
      console.error("[SolHub] submitToCloudbase error", error);
      const msg = String(error?.message ?? error);
      if (/duplicate|violates|constraint/i.test(msg)) {
        return { ok: false, message: "提交被数据库拒绝：请检查必填字段（名称、链接格式、长度限制）。" };
      }
      return { ok: false, message: `提交失败：${msg}` };
    }
    const row = (Array.isArray(data) && data[0]) as CommunitySubmissionRow | undefined;
    return {
      ok: true,
      message: "提交成功，已自动公开到 SolHub 社区列表。",
      row,
    };
  } catch (e) {
    console.error("[SolHub] submitToCloudbase failed", e);
    return { ok: false, message: "网络错误：无法连接 CloudBase，请稍后重试。" };
  }
}

/** 上传托管工具 HTML 到 pgstore 桶；返回存储 key。 */
export async function uploadHostedTool(
  file: File,
  slug: string,
): Promise<{ ok: boolean; key?: string; message?: string }> {
  const client = await getClient();
  if (!client) return { ok: false, message: "CloudBase 未配置，无法上传。" };
  if (file.size > 1 * 1024 * 1024) return { ok: false, message: "HTML 文件不能超过 1MB。" };
  if (!/^text\/html|\.html$/i.test(file.type || file.name)) {
    return { ok: false, message: "仅支持 HTML 文件（自包含工具页面）。" };
  }
  const key = `hosted/${Date.now().toString(36)}-${slug.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "tool"}.html`;
  try {
    const { error } = await client.app.storage.from("solhub-tools").upload(key, file, {
      contentType: "text/html",
    });
    if (error) {
      console.error("[SolHub] uploadHostedTool error", error);
      return { ok: false, message: `上传失败：${String(error?.message ?? error)}` };
    }
    return { ok: true, key };
  } catch (e) {
    console.error("[SolHub] uploadHostedTool failed", e);
    return { ok: false, message: "上传失败：网络错误，请稍后重试。" };
  }
}

/** 获取托管工具临时访问 URL（签名 URL）。 */
export async function getHostedToolUrl(key: string): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    const res = await client.app.storage.from("solhub-tools").createSignedUrl(key, 3600);
    const url = res?.data?.signedUrl ?? res?.data?.signedURL ?? res?.signedUrl ?? null;
    return typeof url === "string" ? url : null;
  } catch (e) {
    console.error("[SolHub] getHostedToolUrl failed", e);
    return null;
  }
}

/** 供页面调用：把社区提交行归一化为统一展示结构。 */
export function normalizeCommunity(row: CommunitySubmissionRow): CloudBaseSubmission {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    shortDescription: row.short_description ?? "",
    description: row.description ?? "",
    url: row.url ?? "",
    category: row.category ?? "",
    tags: row.tags ?? [],
    iconUrl: row.icon_url ?? "",
    developer: row.developer ?? "",
    contact: row.contact ?? "",
    toolType: row.tool_type ?? undefined,
    hostedKey: row.hosted_key ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}
