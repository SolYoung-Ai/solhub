import { useEffect, useMemo, useState } from "react";

interface Props {
  locale?: "zh" | "en";
}

const STORE_KEY = "solhub:recruit-ref";

/**
 * 拉新 / 邀请机制（v1，纯前端）
 * - 读取 URL 上的 ?ref=<code>：若有人通过你的专属链接进来，显示「你是由 XXX 邀请的」横幅；
 * - 生成本机稳定的专属邀请码（首次访问写入 localStorage，之后复用），拼成
 *   `${origin}${pathname}?ref=<code>` 的邀请链接，一键复制。
 *
 * 注意：当前只是「结构上具备 referral 能力」，真正的「邀请归因 / 奖励」需要后端统计，
 * 不在 v1 范围内（后端接入点见 docs/OPERATIONS.md）。前端先把链路跑通，避免将来返工。
 */
function loadOrCreateCode(): string {
  try {
    const existing = localStorage.getItem(STORE_KEY);
    if (existing) return existing;
    const code = "SH-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    localStorage.setItem(STORE_KEY, code);
    return code;
  } catch {
    return "SH-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  }
}

export default function RecruitShare({ locale = "zh" }: Props) {
  const en = locale === "en";
  const [inviter, setInviter] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) setInviter(ref.slice(0, 24));
    setCode(loadOrCreateCode());
  }, []);

  const inviteLink = useMemo(() => {
    if (typeof window === "undefined" || !code) return "";
    const base = window.location.origin + window.location.pathname;
    return `${base}?ref=${code}`;
  }, [code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = inviteLink;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      } catch {
        /* 复制失败：保持按钮原样，用户可手动选择 */
      }
    }
  };

  return (
    <div>
      {inviter && (
        <div
          className="mb-4 flex items-center gap-2 rounded-[10px] border border-accent/25 bg-accent/5 px-3.5 py-2.5 text-[13px] text-foreground/80"
          role="status"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 21s-7.5-4.6-9.9-9.2C.4 8.4 2 5 5.3 5c2 0 3.4 1.1 4.2 2.4l.5.8.5-.8C11.3 6.1 12.7 5 14.7 5 18 5 19.6 8.4 21.9 11.8 19.5 16.4 12 21 12 21Z"
            />
          </svg>
          <span>
            {en
              ? `You were invited to SolHub by ${inviter}.`
              : `你是由 ${inviter} 邀请加入 SolHub 的`}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <p className="label mb-1.5">
            {en ? "Your invite link" : "你的专属邀请链接"}
          </p>
          <input
            readOnly
            value={inviteLink}
            onFocus={(e) => e.currentTarget.select()}
            className="input font-mono !text-[12.5px]"
            aria-label={en ? "Your invite link" : "你的专属邀请链接"}
          />
        </div>
        <button
          type="button"
          onClick={copy}
          className="btn btn-accent h-10 shrink-0 px-5"
          aria-live="polite"
        >
          {copied ? (en ? "Copied" : "已复制") : en ? "Copy link" : "复制链接"}
        </button>
      </div>

      <p className="mt-3 text-[12.5px] leading-6 text-muted-foreground">
        {en
          ? "Share this link with fellow creators. Referral attribution and rewards are coming — the link already carries your code so nothing breaks later."
          : "把这个链接分享给更多创作者。邀请归因与奖励功能即将上线——链接已经带上你的专属码，将来接入后端时无需更换。"}
      </p>
    </div>
  );
}
