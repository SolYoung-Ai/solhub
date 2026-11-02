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
