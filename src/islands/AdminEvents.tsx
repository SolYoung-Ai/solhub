import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Lock, ShieldCheck, X } from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import { request } from "@/lib/net";
import { base } from "@/lib/api-base";
import { getAdminKey, setAdminKey, unlockAdmin } from "@/lib/admin";
import { rangeText, stateLabel, type EventCard } from "@/lib/events";

/** 活动审核队列（/guanli/events/）：沿用后台口令，待审核排在最前。 */
export default function AdminEvents({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [key, setKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [items, setItems] = useState<EventCard[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [reasonFor, setReasonFor] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${base()}/admin/events`, {
        cache: "no-store",
        headers: { "X-Admin-Key": getAdminKey() },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setUnlocked(false);
        setError(data.needKey ? "需要管理口令" : "请先登录管理员账号");
      } else if (res.status === 403) {
        setError("当前账号不是管理员");
      } else if (!res.ok) {
        setError(data.error || `请求失败（${res.status}）`);
      } else {
        setItems(data.events || []);
        setPending(data.pending || 0);
      }
    } catch {
      setError("网络错误，请稍后重试");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const saved = getAdminKey();
    if (!saved) {
      setChecking(false);
      return;
    }
    void unlockAdmin(saved).then((res) => {
      if (res.status === "ok") {
        setUnlocked(true);
        void load();
      }
      setChecking(false);
    });
  }, [load]);

  async function onUnlock() {
    setError("");
    const res = await unlockAdmin(key);
    if (res.status === "ok") {
      setUnlocked(true);
      setKey("");
      void load();
    } else {
      setError(res.error || (res.status === "forbidden" ? "当前账号不是管理员" : "口令不正确"));
    }
  }

  async function review(id: string, action: "approve" | "reject" | "offline", why = "") {
    setBusyId(id);
    setMessage("");
    try {
      const res = await request(
        `${base()}/admin/events/${encodeURIComponent(id)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Admin-Key": getAdminKey() },
          body: JSON.stringify({ action, reason: why }),
        },
        { retries: 0 },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(data.error || "操作失败");
      else {
        setMessage(data.message || "已更新");
        setReasonFor("");
        setReason("");
        void load();
      }
    } catch {
      setMessage("网络错误");
    }
    setBusyId("");
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载中…
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="container-page max-w-sm py-16">
        <div className="rounded-[16px] border border-border bg-card p-6">
          <ShieldCheck className="h-6 w-6 text-accent" />
          <h1 className="mt-3 font-display text-lg font-bold text-foreground">活动审核</h1>
          <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
            需要管理员账号与后台口令。
          </p>
          <div className="mt-4 flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onUnlock()}
              placeholder="管理口令"
              className="h-9 min-w-0 flex-1 rounded-[8px] border border-border bg-background px-2.5 text-[13px] outline-none focus:border-accent/60"
            />
            <button type="button" onClick={onUnlock} className="btn !h-9 px-3 text-xs">
              <Lock className="mr-1 h-3.5 w-3.5" />
              解锁
            </button>
          </div>
          {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container-page max-w-4xl py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-tight text-foreground">活动审核</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            共 {items.length} 场，{pending} 场待审核。用户活动通过后才会公开。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="btn btn-outline !h-8 px-3 text-xs"
            disabled={loading}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminKey("");
              setUnlocked(false);
            }}
            className="btn btn-outline !h-8 px-3 text-xs"
          >
            锁上
          </button>
        </div>
      </header>

      {error && <p className="mb-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
      {message && <p className="mb-3 rounded-[8px] bg-secondary px-3 py-2 text-[12.5px] text-foreground/75">{message}</p>}

      {items.length === 0 ? (
        <p className="rounded-[14px] border border-border bg-card px-4 py-12 text-center text-[12.5px] text-muted-foreground">
          还没有活动。
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((e) => (
            <li key={e.id} className="rounded-[14px] border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    e.status === "pending"
                      ? "rounded-full bg-amber-400/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700"
                      : e.status === "published"
                        ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700"
                        : e.status === "rejected"
                          ? "rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-medium text-destructive"
                          : "rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground"
                  }
                >
                  {stateLabel(e.state || e.status, false)}
                </span>
                <span className="text-[13px] font-semibold text-foreground">{e.title}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {e.ownerType === "official" ? "官方" : `@${e.ownerHandle}`}
                </span>
                <a
                  href={p(`/events/detail/?slug=${encodeURIComponent(e.slug)}`, "zh")}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline"
                >
                  预览
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{rangeText(e.startAt, e.endAt, false)}</p>

              {e.status === "pending" && (
                <div className="mt-2.5">
                  {reasonFor === e.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={reason}
                        onChange={(ev) => setReason(ev.target.value)}
                        placeholder="驳回理由（会展示给作者）"
                        className="h-8 min-w-0 flex-1 rounded-[7px] border border-border bg-background px-2.5 text-[12px] outline-none focus:border-accent/60"
                      />
                      <button
                        type="button"
                        onClick={() => review(e.id, "reject", reason)}
                        disabled={busyId === e.id}
                        className="btn !h-8 px-3 text-xs"
                      >
                        确认驳回
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReasonFor("");
                          setReason("");
                        }}
                        className="btn btn-outline !h-8 px-3 text-xs"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => review(e.id, "approve")}
                        disabled={busyId === e.id}
                        className="inline-flex h-8 items-center gap-1 rounded-[7px] bg-emerald-500/12 px-3 text-[11.5px] font-medium text-emerald-700 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        通过并发布
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReasonFor(e.id);
                          setReason("");
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-[7px] bg-secondary px-3 text-[11.5px] text-muted-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                        驳回
                      </button>
                    </div>
                  )}
                </div>
              )}

              {e.status === "published" && (
                <button
                  type="button"
                  onClick={() => review(e.id, "offline")}
                  disabled={busyId === e.id}
                  className="mt-2 inline-flex h-7 items-center rounded-[7px] bg-secondary px-2.5 text-[11.5px] text-muted-foreground disabled:opacity-50"
                >
                  下架
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
