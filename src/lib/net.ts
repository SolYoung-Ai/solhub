/**
 * SolHub 前端网络层。
 *
 * 背景：后端 API（Cloudflare Workers）部署在境外边缘节点，从中国大陆访问时
 * 跨境链路抖动明显——TCP/TLS 握手通常只要 0.2~0.6s，但等待首字节可能长达
 * 十几秒，个别情况还会直接丢包（连接建不起来）。
 * 裸 fetch 没有超时，一旦碰上抖动就会无限期挂住，页面卡在「加载中」；
 * 或者直接抛错，UI 只显示一句笼统的「网络错误」。
 *
 * 这里统一提供：
 *  - 超时（AbortController）——不让任何请求无限等待；
 *  - 退避重试——把「偶发一次抖动」变成「自动重试后成功」；
 *  - 统一的错误文案。
 *
 * 只对网络层异常（超时 / 断连 / 丢包）重试；HTTP 4xx/5xx 属于服务端返回的
 * 业务结果，直接交给调用方处理，不做无谓重试。
 */

import { getAuthToken } from "@/lib/session";

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_RETRIES = 2;

/** 网络不可达时的统一提示（此时已自动重试过）。 */
export const NET_ERROR =
  "网络不稳定，暂时连不上服务器（已自动重试）。请检查网络后重试，或稍后再试。";

export interface RequestOptions {
  /** 单次请求超时（毫秒） */
  timeoutMs?: number;
  /** 网络异常时的重试次数（总尝试次数 = retries + 1） */
  retries?: number;
  /** 强制不带 Cookie 发送（credentials: omit）。用于登录/注册等「建立会话」的请求：
   *  移动端 iOS Safari 的 ITP 会拦截跨站凭证请求，而这些请求本来就靠响应里的令牌工作，不需要 Cookie。 */
  omitCredentials?: boolean;
}

/** 带超时与退避重试的 fetch。网络异常会重试；HTTP 错误码原样返回。
 *  若本地持有会话令牌（移动端 iOS Safari 因 ITP 拿不到跨站 Cookie），
 *  则改用 Bearer 头携带令牌并关闭 credentials，避免被浏览器拦截。 */
export async function request(
  url: string,
  init: RequestInit = {},
  opts: RequestOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;

  let credentials: RequestCredentials = opts.omitCredentials ? "omit" : "include";
  const headers: Record<string, string> = {};
  try {
    const t = getAuthToken();
    if (t) {
      credentials = "omit";
      if (t.type === "email") headers["X-Solhub-Session"] = t.token;
      else if (t.type === "github") headers["Authorization"] = `Bearer ${t.token}`;
    }
  } catch {
    /* sessionStorage 不可用时退回 Cookie 路径 */
  }

  const finalInit: RequestInit = {
    ...init,
    credentials,
    headers: { ...(init.headers as Record<string, string> | undefined), ...headers },
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...finalInit,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        /* 退避后再试：给跨境链路一点恢复时间 */
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("network error");
}
