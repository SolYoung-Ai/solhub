import type { Submission } from "@/data/types";
import { submissionConfig } from "@/data/site";

/**
 * 提交系统 —— 存储适配层。
 * 表单不直接依赖任何固定数据库，通过统一接口提交：
 * 1. remote: 已配置远程提交接口（PUBLIC_SOLHUB_SUBMIT_ENDPOINT）时 POST 到该接口；
 * 2. github-issue: 已配置公开投稿仓库（PUBLIC_SOLHUB_ISSUE_REPO）时，
 *    生成包含完整信息的 GitHub Issue 预填链接，由用户自己点击提交；
 * 3. local-draft: 以上均未配置时，保存为浏览器本地草稿并提供 JSON 导出。
 *    草稿只保存在当前浏览器，不会公开给其他访问者。
 *
 * 严禁把任何密钥写入前端代码或公开配置。
 */

export type SubmissionMode = "local-draft" | "github-issue" | "remote" | "cloudbase";

export interface SubmissionResult {
  ok: boolean;
  mode: SubmissionMode;
  message: string;
  url?: string;
  data?: Submission;
}

const LOCAL_DRAFT_KEY = "solhub:submission-drafts";

export function getAvailableModes(): {
  remote: boolean;
  githubRepo: string | null;
} {
  return {
    remote: Boolean(submissionConfig.remoteEndpoint),
    githubRepo: submissionConfig.githubIssueRepo ?? null,
  };
}

export function buildIssueBody(sub: Submission): string {
  const f = sub.productFields;
  return [
    `## 产品提交：${f.name}`,
    "",
    `**一句话介绍**：${f.shortDescription}`,
    "",
    `**详细描述**：`,
    f.description,
    "",
    `**官网 URL**：${f.websiteUrl}`,
    `**分类**：${f.category}`,
    `**标签**：${f.tags.join(", ")}`,
    f.iconUrl ? `**图标 URL**：${f.iconUrl}` : "",
    `**开发者 / 团队**：${f.developerName}`,
    f.contact ? `**联系方式**：${f.contact}` : "",
    f.launchBatch ? `**发布批次**：${f.launchBatch}` : "",
    "",
    `---`,
    `由 SolHub 投稿表单生成 · ${sub.createdAt}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function buildIssueUrl(repo: string, sub: Submission): string {
  const body = encodeURIComponent(buildIssueBody(sub));
  const title = encodeURIComponent(`[SolHub] 产品提交：${sub.productFields.name}`);
  return `https://github.com/${repo}/issues/new?title=${title}&body=${body}`;
}

export async function submitSubmission(sub: Submission): Promise<SubmissionResult> {
  const { remote, githubRepo } = getAvailableModes();

  if (remote && submissionConfig.remoteEndpoint) {
    try {
      const res = await fetch(submissionConfig.remoteEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) {
        return {
          ok: false,
          mode: "remote",
          message: `远程接口返回错误（${res.status}）。你的内容没有被提交，请稍后重试或改用本地草稿。`,
        };
      }
      return {
        ok: true,
        mode: "remote",
        message: "已提交到远程接口，等待管理员核验。",
      };
    } catch {
      return {
        ok: false,
        mode: "remote",
        message: "网络错误：无法连接远程提交接口。你的内容没有被提交，请稍后重试。",
      };
    }
  }

  if (githubRepo) {
    const url = buildIssueUrl(githubRepo, sub);
    return {
      ok: true,
      mode: "github-issue",
      message: "已生成 GitHub Issue 预填链接。点击下方按钮在新标签页完成提交。",
      url,
    };
  }

  // 默认：本地草稿 + JSON 导出
  try {
    const drafts = readLocalDrafts();
    drafts.push(sub);
    localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(drafts));
    return {
      ok: true,
      mode: "local-draft",
      message:
        "已保存为本地草稿。草稿只保存在当前浏览器，不会公开给其他访问者；可导出 JSON 备份或复制内容自行提交。",
      data: sub,
    };
  } catch {
    return {
      ok: false,
      mode: "local-draft",
      message: "保存本地草稿失败（浏览器可能禁用了本地存储）。可复制下方内容自行保存。",
      data: sub,
    };
  }
}

export function readLocalDrafts(): Submission[] {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function exportSubmissionJson(sub: Submission): string {
  return JSON.stringify(sub, null, 2);
}
