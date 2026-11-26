/**
 * 活动（浏览器侧）
 *
 * 后端见 worker/index.js 的 /events 与 /admin/events：
 *   - 官方活动由管理员创建，直接发布；用户活动先草稿/待审核；
 *   - 状态不落库，按当前时间算 upcoming / ongoing / ended；
 *   - 报名成功后不立刻回读（KV 最终一致约 30s），本地先更新按钮状态。
 */

import { request } from "@/lib/net";
import { base } from "@/lib/api-base";

export type EventState =
  | "draft"
  | "pending"
  | "offline"
  | "rejected"
  | "upcoming"
  | "ongoing"
  | "ended";

export type RegistrationStatus = "pending" | "approved" | "rejected" | "won" | "cancelled";

export interface EventCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  cover: string;
  category: string;
  tags: string[];
  ownerType: "official" | "user";
  ownerHandle: string;
  ownerName: string;
  startAt: string;
  endAt: string;
  signupDeadline: string;
  capacity: number;
  registrationMode: "open" | "approval";
  durationDays?: number;
  price?: number;
  status: string;
  reviewStatus: string;
  featured: boolean;
  used: number;
  regCount: number;
  createdAt: string;
  /** 列表接口算好的展示状态 */
  state?: EventState;
  signupOpen?: boolean;
}

export interface EventEligibility {
  requireEmailVerified?: boolean;
  requireProduct?: boolean;
  customText?: string;
}

/** 报名表单字段：发起者自定义，key 由前端生成、后端校验，用于 answers 取值 */
export interface EventField {
  key: string;
  label: string;
  type: "text" | "textarea" | "url" | "email" | "tel" | "number";
  required: boolean;
  placeholder?: string;
}

export interface EventResult {
  summary: string;
  winners: { id: string; name: string; handle: string }[];
  publishedAt: string;
}

export interface EventDetailData extends EventCard {
  description: string;
  audience: string;
  eligibility: EventEligibility;
  formFields?: EventField[];
  location: string;
  contactEmail: string;
  reviewReason: string;
  result: EventResult | null;
  approvedCount: number;
  pendingCount?: number;
}

export interface MyRegistration {
  id: string;
  status: RegistrationStatus;
  at: string;
  note: string;
}

export interface RegistrationRecord {
  id: string;
  sid: string;
  handle: string;
  name: string;
  email: string;
  /** 报名时已通过邮箱验证（后端强制，恒为 true） */
  emailVerified?: boolean;
  avatar?: string;
  bio?: string;
  website?: string;
  products?: { slug: string; name: string }[];
  note: string;
  answers?: Record<string, string>;
  status: RegistrationStatus;
  at: string;
}

export const EVENT_CATEGORIES = [
  { key: "recruit", zh: "招募", en: "Recruiting" },
  { key: "meetup", zh: "线下聚会", en: "Meetup" },
  { key: "workshop", zh: "工作坊", en: "Workshop" },
  { key: "contest", zh: "比赛", en: "Contest" },
  { key: "other", zh: "其他", en: "Other" },
] as const;

/** 活动时长与价格：与 worker/index.js 的 EVENT_DURATIONS 必须一致 */
export const EVENT_PLANS = [
  { days: 7, price: 500 },
  { days: 15, price: 1000 },
  { days: 30, price: 1800 },
  { days: 60, price: 3000 },
] as const;

export function categoryLabel(key: string, en = false): string {
  const hit = EVENT_CATEGORIES.find((c) => c.key === key);
  return hit ? (en ? hit.en : hit.zh) : en ? "Other" : "其他";
}

export function stateLabel(state: string | undefined, en = false): string {
  switch (state) {
    case "upcoming":
      return en ? "Open for signup" : "报名中";
    case "ongoing":
      return en ? "Live" : "进行中";
    case "ended":
      return en ? "Ended" : "已结束";
    case "draft":
      return en ? "Draft" : "草稿";
    case "pending":
      return en ? "In review" : "审核中";
    case "offline":
      return en ? "Hidden" : "已下架";
    case "rejected":
      return en ? "Rejected" : "已驳回";
    default:
      return en ? "Event" : "活动";
  }
}

export function regStatusLabel(status: string, en = false): string {
  switch (status) {
    case "approved":
      return en ? "Approved" : "已通过";
    case "pending":
      return en ? "Pending" : "待确认";
    case "rejected":
      return en ? "Not selected" : "未通过";
    case "won":
      return en ? "Selected" : "已入选";
    case "cancelled":
      return en ? "Cancelled" : "已取消";
    default:
      return status;
  }
}

function fmtDate(iso: string, en: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return en
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function rangeText(startAt: string, endAt: string, en = false): string {
  const a = fmtDate(startAt, en);
  const b = fmtDate(endAt, en);
  if (!a && !b) return "";
  return `${a} – ${b}`;
}

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const res = await request(`${base()}${path}`, { cache: "no-store", ...init }, { retries: 1 });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.ok === false) {
      return { ok: false, status: res.status, error: String(data.error || `请求失败（${res.status}）`) };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "网络错误，请稍后重试" };
  }
}

export function listEvents(params: {
  state?: string;
  type?: string;
  category?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "" && v !== "all") qs.set(k, String(v));
  });
  const tail = qs.toString();
  return call<{ total: number; limit: number; offset: number; events: EventCard[] }>(
    `/events${tail ? `?${tail}` : ""}`,
  );
}

export function getEvent(slug: string) {
  return call<{ event: EventDetailData; canManage: boolean; myRegistration: MyRegistration | null }>(
    `/events/${encodeURIComponent(slug)}`,
  );
}

export interface EventPayload {
  title: string;
  summary: string;
  description: string;
  cover: string;
  category: string;
  tags: string[];
  durationDays: number;
  audience: string;
  eligibility: EventEligibility;
  capacity: number;
  registrationMode: "open" | "approval";
  formFields?: EventField[];
  location: string;
  contactEmail: string;
  submit?: boolean;
  featured?: boolean;
}

export function createEvent(payload: EventPayload) {
  return call<{ id: string; slug: string; status: string; price: number; balance?: number }>("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function editEvent(id: string, payload: Partial<EventPayload>) {
  return call<{ event: EventDetailData; message: string }>(`/events/${encodeURIComponent(id)}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function eventAction(id: string, action: "submit" | "offline" | "restore") {
  return call<{ message: string }>(`/events/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function registerEvent(id: string, answers: Record<string, string> = {}) {
  return call<{ status: RegistrationStatus; message: string }>(
    `/events/${encodeURIComponent(id)}/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    },
  );
}

export function cancelRegistration(id: string) {
  return call<{ message: string }>(`/events/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function myEvents() {
  return call<{
    created: EventCard[];
    joined: { event: EventCard; reg: { id: string; status: RegistrationStatus; at: string } }[];
  }>("/events/mine");
}

export function eventRegistrations(id: string) {
  return call<{
    event: { id: string; title: string; slug: string; capacity: number; registrationMode: string };
    registrations: RegistrationRecord[];
  }>(`/events/${encodeURIComponent(id)}/registrations`);
}

export function reviewRegistration(id: string, regId: string, action: "approve" | "reject") {
  return call<{ status: string; message: string }>(
    `/events/${encodeURIComponent(id)}/registrations/${encodeURIComponent(regId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
}

export function publishEventResult(id: string, summary: string, winners: string[]) {
  return call<{ result: EventResult; message: string }>(`/events/${encodeURIComponent(id)}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary, winners }),
  });
}
