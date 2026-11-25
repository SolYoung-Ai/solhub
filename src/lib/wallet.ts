/**
 * 钱包 / 积分 / 邀请（浏览器侧）
 *
 * 后端口径见 worker/index.js 的 /wallet 与 settleReferral()：
 *   - 每次成功邀请：邀请人和被邀请人各 +100，各写一条明细，一人一生只发一次；
 *   - 邀请码是「按账号算出来的」（SH-XXXXXX），不是随机发号，
 *     所以同一账号在任何设备上看到的码都一样。
 */

import { request } from "@/lib/net";
import { base } from "@/lib/api-base";

export interface WalletLedgerItem {
  id: string;
  at: string;
  amount: number;
  /** invite = 邀请奖励；其它类型留给后续消费 */
  type: string;
  note: string;
  ref?: string;
}

export interface WalletData {
  balance: number;
  available: number;
  earned: number;
  code: string;
  link: string;
  invitePoints: number;
  invitedCount: number;
  invited: { login: string; at: string }[];
  ledger: WalletLedgerItem[];
}

export type WalletResult =
  | { ok: true; data: WalletData }
  | { ok: false; reason: "unauth" | "net" | "error"; error?: string };

export const WALLET_CACHE_KEY = "solhub:wallet:v1";

/** 读取钱包（登录态）。401 明确返回 unauth，交给界面提示登录而不是报错。 */
export async function fetchWallet(): Promise<WalletResult> {
  try {
    const res = await request(`${base()}/wallet`, { cache: "no-store" }, { retries: 1 });
    if (res.status === 401) return { ok: false, reason: "unauth" };
    if (!res.ok) return { ok: false, reason: "error", error: `HTTP ${res.status}` };
    const data = (await res.json()) as WalletData & { ok?: boolean };
    if (!data || typeof data.balance !== "number") return { ok: false, reason: "error" };
    try {
      sessionStorage.setItem(WALLET_CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    } catch {
      /* 缓存失败无所谓 */
    }
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "net" };
  }
}

/** 会话内的钱包快照（recruit 区块首屏直接用，避免闪一下加载） */
export function cachedWallet(): WalletData | null {
  try {
    const raw = sessionStorage.getItem(WALLET_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; data?: WalletData };
    if (!parsed || !parsed.data || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > 5 * 60 * 1000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** 解析邀请码对应的邀请人（公开接口，join 页横幅用） */
export async function resolveInviter(
  code: string,
): Promise<{ login: string; name: string; avatar?: string } | null> {
  const clean = String(code || "").trim();
  if (!clean) return null;
  try {
    const res = await request(`${base()}/ref/resolve?code=${encodeURIComponent(clean)}`, { cache: "no-store" }, { retries: 1 });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; inviter?: { login: string; name: string; avatar?: string } };
    return data && data.ok && data.inviter ? data.inviter : null;
  } catch {
    return null;
  }
}

/** 邀请码在本地留一份：先点邀请链接、后来才注册也不丢归因 */
export const REF_STORE_KEY = "solhub:ref";
