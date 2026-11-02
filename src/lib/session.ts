/**
 * 前端持有的会话令牌（Bearer transport）。
 *
 * 背景：认证 API 部署在 app.tcloudbase.com，站点是 solhub.solyoung.top，
 * 属于跨站。iOS Safari 的 ITP（防跨站跟踪）会直接拦截这个第三方 Cookie，
 * 导致 /me 这类带凭证的请求被浏览器掐掉（报「连不上认证服务」）。
 *
 * 解决：邮箱 / GitHub 登录成功后，后端额外回传一个令牌，前端存在 sessionStorage，
 * 之后每个请求用请求头带上去（邮箱走 X-Solhub-Session，GitHub 走 Authorization: Bearer）。
 * 这是「跨域请求 + 自定义头」，ITP 不会拦，移动端 Safari 也能正常登录。
 *
 * 注意：令牌存在 sessionStorage（非 HttpOnly），理论上比 Cookie 更怕 XSS；
 * 权衡之后选择这种方案是因为它能让移动端真正可用，且只对已登录会话有效、
 * 站点本身又是静态站、风险可控。桌面端仍保留 HttpOnly Cookie 作为兜底。
 */

export type AuthTokenType = "email" | "github";

export interface AuthToken {
  type: AuthTokenType;
  token: string;
}

const KEY = "solhub:auth";

export function getAuthToken(): AuthToken | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as AuthToken;
    if (t && (t.type === "email" || t.type === "github") && typeof t.token === "string" && t.token) {
      return t;
    }
    return null;
  } catch {
    return null;
  }
}

export function setAuthToken(t: AuthToken | null): void {
  try {
    if (t && t.token) sessionStorage.setItem(KEY, JSON.stringify(t));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* 隐私模式 / 配额不足时忽略 */
  }
}

export function clearAuthToken(): void {
  setAuthToken(null);
}
