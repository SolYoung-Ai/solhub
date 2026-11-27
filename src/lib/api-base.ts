/**
 * 认证服务接口基址
 * =================
 *
 * 全站只有一个地方需要知道「后端在哪」—— 集中在这里，避免各处硬编码域名。
 *
 * 2026-11-02 起后端从 Cloudflare Worker（solhub-auth.solyoung.top，机房在 LAX，
 * 国内访问 TTFB 3.8~13.2 秒，登录与个人主页经常超时）迁到 CloudBase 上海
 * （ap-shanghai），实测接口响应 0.13 秒。
 *
 * 路径说明：网关路由挂在 /api 前缀下，所以基址自带 /api，
 * 后面拼 /me、/auth/login、/world 等路径即可。
 *
 * 需要指向别的环境时，用 PUBLIC_SOLHUB_API 环境变量覆盖（构建期注入）。
 */
export const API_BASE =
  (import.meta.env.PUBLIC_SOLHUB_API as string | undefined) ||
  "https://solyoung-d4gpp1f7s4e075f6d-1499756427.ap-shanghai.app.tcloudbase.com/api";

/** 去掉末尾斜杠，方便后面直接拼路径 */
export function base(): string {
  return API_BASE.replace(/\/$/, "");
}

/**
 * 热点接口基址（可以是另一个后端）
 * ================================
 *
 * /hot 是纯读接口：数据每 30 分钟由定时任务整批覆盖，读慢了只是内容旧一点，
 * 不涉及登录态和写入。所以它可以单独指向 Cloudflare Worker（境外节点便宜），
 * 而登录、报名、钱包这些必须走 CloudBase 上海（快、稳）。
 *
 * 默认回退到 API_BASE —— 没配置时就还是单后端，行为与以前完全一致。
 */
export const HOT_API_BASE =
  (import.meta.env.PUBLIC_SOLHUB_HOT_API as string | undefined) || API_BASE;

export function hotBase(): string {
  return HOT_API_BASE.replace(/\/$/, "");
}
