import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Lock, Play, X } from "lucide-react";
import {
  fetchCommunitySubmissions,
  getHostedToolUrl,
  normalizeCommunity,
  type CommunitySubmissionRow,
} from "@/lib/cloudbase";
import type { CloudBaseSubmission } from "@/data/types";
import { isValidHttpUrl, getLocale } from "@/lib/utils";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

/**
 * 社区提交动态区（客户端渲染，实时读取 CloudBase 已公开数据）。
 * kind 为 "product" / "tool" / undefined（全部）。
 */
export default function CommunityFeed({
  kind,
  limit = 8,
  title,
  showMore = true,
  locale,
}: {
  kind?: "product" | "tool";
  limit?: number;
  title?: string;
  showMore?: boolean;
  locale?: Locale;
}) {
  const lc = locale ?? getLocale();
  const en = lc === "en";
  const [rows, setRows] = useState<CloudBaseSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState<CloudBaseSubmission | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCommunitySubmissions(kind, limit)
      .then((data: CommunitySubmissionRow[]) => {
        if (cancelled) return;
        setRows(data.map(normalizeCommunity));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, limit]);

  const openHosted = useCallback(async (item: CloudBaseSubmission) => {
    setOpened(item);
    setHostedUrl(null);
    if (item.hostedKey) {
      const url = await getHostedToolUrl(item.hostedKey);
      setHostedUrl(url);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpened(null);
        setHostedUrl(null);
      }
    };
    if (opened) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opened]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {en ? "Loading community submissions…" : "正在加载社区提交…"}
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <section aria-label={en ? "Community submissions" : "社区提交"} className="mt-12">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {title ?? (kind === "tool" ? (en ? "Community tools" : "社区工具") : en ? "Community submissions" : "社区提交")}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {en ? "Submitted directly by developers, auto-published · not manually verified, judge for yourself" : "由开发者直接提交，自动公开 · 未经人工核验，请自行判断"}
          </p>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((item) => (
          <li key={item.id} className="card p-4">
            <div className="flex items-start gap-3">
              {item.iconUrl && isValidHttpUrl(item.iconUrl) ? (
                <img
                  src={item.iconUrl}
                  alt=""
                  loading="lazy"
                  className="h-10 w-10 shrink-0 rounded-[3px] border border-border object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] border border-border bg-secondary text-sm font-bold text-accent">
                  {item.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-bold text-foreground">{item.name}</h3>
                  <span className="shrink-0 rounded-sm border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {item.kind === "tool" ? (item.toolType === "hosted" ? (en ? "Hosted" : "托管工具") : en ? "Tool" : "工具") : en ? "Product" : "产品"}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                  {item.shortDescription || item.description}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  {item.toolType === "hosted" ? (
                    <button
                      type="button"
                      onClick={() => void openHosted(item)}
                      className="btn btn-accent !h-7 gap-1.5 px-3 text-xs"
                    >
                      <Play className="h-3 w-3" aria-hidden="true" /> {en ? "Open tool" : "打开工具"}
                    </button>
                  ) : item.url && isValidHttpUrl(item.url) ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline !h-7 gap-1.5 px-3 text-xs"
                    >
                      {en ? "Visit" : "访问"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{en ? "No link" : "暂无链接"}</span>
                  )}
                  {item.developer && (
                    <span className="truncate text-[11px] text-muted-foreground">by {item.developer}</span>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {showMore && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          {en ? `Showing the latest ${rows.length} submissions. Want on the list? ` : `展示最近 ${rows.length} 条社区提交。想要上榜？去 `}
          <a href={p("/submit/", lc)} className="text-accent underline-offset-2 hover:underline">
            {en ? "Submit your product / tool" : "提交你的产品 / 工具"}
          </a>
          {en ? "." : "。"}
        </p>
      )}

      {/* 托管工具沙箱弹窗 */}
      {opened && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${en ? "Tool" : "工具"}：${opened.name}`}
          onClick={() => {
            setOpened(null);
            setHostedUrl(null);
          }}
        >
          <div
            className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-[4px] border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{opened.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  <Lock className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
                  {en ? "Sandboxed · cannot access SolHub main-site data" : "沙箱隔离运行 · 无法访问 SolHub 主站数据"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpened(null);
                  setHostedUrl(null);
                }}
                className="btn btn-ghost !h-8 !w-8 !p-0"
                aria-label={en ? "Close tool" : "关闭工具"}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="relative flex-1 bg-white">
              {hostedUrl ? (
                <iframe
                  title={opened.name}
                  src={hostedUrl}
                  className="h-full w-full border-0"
                  sandbox="allow-scripts allow-downloads allow-modals allow-forms"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {en ? "Loading tool…" : "正在加载工具…"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
