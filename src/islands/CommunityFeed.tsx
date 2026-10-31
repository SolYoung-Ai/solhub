import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Play, X } from "lucide-react";
import { isValidHttpUrl, getLocale } from "@/lib/utils";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";
import { submissionConfig } from "@/data/site";

/** GitHub Issue 原始结构（API 返回） */
interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  user?: { login?: string; avatar_url?: string };
  labels?: { name: string }[];
}

/** 解析 Issue body 提取产品字段 */
function parseIssueBody(body: string | null) {
  if (!body) return {} as Record<string, string>;
  const map: Record<string, string> = {};
  const lines = body.split("\n");
  let currentKey = "";
  let currentVal = "";
  for (const line of lines) {
    const m = line.match(/^\*\*(.+?)\*\*：\s*(.*)$/);
    if (m) {
      if (currentKey) map[currentKey] = currentVal.trim();
      currentKey = m[1].trim();
      currentVal = m[2];
    } else if (currentKey && !line.startsWith("##") && !line.startsWith("---") && !line.startsWith("由 SolHub")) {
      currentVal += "\n" + line;
    }
  }
  if (currentKey) map[currentKey] = currentVal.trim();
  return map;
}

function fetchIssues(kind?: "product" | "tool", limit = 8): Promise<GhIssue[]> {
  const repo = submissionConfig.githubIssueRepo;
  if (!repo) return Promise.resolve([]);
  const url = `https://api.github.com/repos/${repo}/issues?labels=submission&state=open&per_page=${Math.min(limit, 30)}`;
  return fetch(url, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : []))
    .then((data) => (Array.isArray(data) ? data : []));
}

/** 映射到 UI 用的 item 结构 */
function issueToItem(issue: GhIssue) {
  const f = parseIssueBody(issue.body);
  return {
    id: `gh-${issue.number}`,
    name: f["产品提交"] || issue.title.replace(/^\[SolHub\]\s*产品提交：/, ""),
    shortDescription: f["一句话介绍"] || "",
    description: f["详细描述"] || "",
    url: f["官网 URL"] || issue.html_url,
    iconUrl: f["图标 URL"] || "",
    developer: f["开发者 / 团队"] || issue.user?.login || "",
    kind: "product" as const,
    toolType: "external" as const,
    createdAt: issue.created_at,
    issueUrl: issue.html_url,
  };
}

type FeedItem = ReturnType<typeof issueToItem>;

/**
 * 社区提交动态区（客户端渲染，从 GitHub Issues 读取）。
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
  const [rows, setRows] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchIssues(kind, limit)
      .then((issues) => {
        if (cancelled) return;
        setRows(issues.map(issueToItem));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, limit]);

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
            {en ? "Submitted via GitHub Issues · curated by SolHub" : "通过 GitHub Issues 提交 · 由 SolHub 人工精选"}
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
                  className="h-10 w-10 shrink-0 rounded-[8px] border border-border object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border bg-secondary text-sm font-bold text-accent">
                  {item.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={item.issueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-bold text-foreground hover:text-accent hover:underline underline-offset-2"
                  >
                    {item.name}
                  </a>
                  <span className="shrink-0 rounded-sm border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {en ? "Product" : "产品"}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                  {item.shortDescription || item.description}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  {item.url && isValidHttpUrl(item.url) && item.url !== item.issueUrl ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline !h-7 gap-1.5 px-3 text-xs"
                    >
                      {en ? "Visit" : "访问"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <a
                      href={item.issueUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline !h-7 gap-1.5 px-3 text-xs"
                    >
                      {en ? "View on GitHub" : "GitHub 查看"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
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
    </section>
  );
}
