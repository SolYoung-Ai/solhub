/**
 * 通过 GitHub Git Data API 推送当前 commit 的改动（绕过 git HTTPS 被代理拦截的情况）。
 * 用法: node scripts/_push_api.mjs "<commit message>" file1 file2 ...
 * 仅用于网络受限时的兜底，正常情况请用 git push。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO = "SolYoung-Ai/solhub";
const gcPath = path.join(os.homedir(), ".git-credentials");
const gc = readFileSync(gcPath, "utf8");
const m = gc.match(/(ghp_[A-Za-z0-9]+)@github\.com/);
const TOKEN = m ? m[1] : null;
if (!TOKEN) { console.error("✗ 找不到 GitHub token"); process.exit(1); }

const API = `https://api.github.com/repos/${REPO}`;
const auth = { Authorization: `Bearer ${TOKEN}`, "User-Agent": "solhub-push", "Content-Type": "application/json" };

async function gh(method, p, body) {
  const res = await fetch(API + p, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const message = process.argv[2];
const files = process.argv.slice(3);
if (!message || files.length === 0) { console.error("usage: node _push_api.mjs \"msg\" f1 f2 ..."); process.exit(1); }

async function main() {
  const ref = await gh("GET", "/git/refs/heads/main");
  const parentSha = ref.object.sha;
  const parentCommit = await gh("GET", `/git/commits/${parentSha}`);
  const baseTreeSha = parentCommit.tree.sha;
  console.log("parent:", parentSha);

  const treeEntries = [];
  for (const f of files) {
    const buf = readFileSync(path.resolve(f));
    const b64 = buf.toString("base64");
    const blob = await gh("POST", "/git/blobs", { content: b64, encoding: "base64" });
    treeEntries.push({ path: f, mode: "100644", type: "blob", sha: blob.sha });
    console.log("blob:", f, blob.sha.slice(0, 10));
  }

  const tree = await gh("POST", "/git/trees", { base_tree: baseTreeSha, tree: treeEntries });
  const commit = await gh("POST", "/git/commits", { message, tree: tree.sha, parents: [parentSha] });
  console.log("commit:", commit.sha);

  await gh("PATCH", "/git/refs/heads/main", { sha: commit.sha, force: false });
  console.log("✓ 已通过 API 更新 main ->", commit.sha);
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
