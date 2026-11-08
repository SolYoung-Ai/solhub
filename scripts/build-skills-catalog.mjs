#!/usr/bin/env node
/**
 * 生成「全网真实 Skill 索引」快照 → public/data/skills-catalog.json
 *
 * 口径（重要，避免把普通仓库当成 Skill）：
 *   1. 只收录 GitHub 仓库中真实存在的 `SKILL.md` 文件（Agent Skills 规范：一个 Skill = 一个含 SKILL.md 的目录）。
 *   2. 名称与简介**直接读取该 SKILL.md 的 YAML frontmatter 原文**，不生成、不翻译、不推测。
 *   3. 每条都带可点击核验的 GitHub 源文件链接、所属仓库与其真实 star 数。
 *   4. 没有 frontmatter / 简介过短的条目直接丢弃；不写死任何安装命令。
 *
 * 数据源都是全网公开核实过的仓库，按可信度分层；0 个 SKILL.md 的仓库只作为「来源」记录，不产出条目。
 * 运行：node scripts/build-skills-catalog.mjs
 * 环境变量：GITHUB_TOKEN（可选，提高 API 限额）、SKILLS_TARGET（默认 1000）、SKILLS_MAX_CANDIDATES（默认 6000）
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data", "skills-catalog.json");
const TARGET = Number(process.env.SKILLS_TARGET || 1000);
const MAX_CANDIDATES = Number(process.env.SKILLS_MAX_CANDIDATES || 6000);

const TOKEN = process.env.GITHUB_TOKEN || "";
const API_HEADERS = {
  "User-Agent": "solhub-skills-catalog",
  Accept: "application/vnd.github+json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};
const RAW_HEADERS = { "User-Agent": "solhub-skills-catalog" };

/** tier 越小越可信，决定去重时谁优先保留 */
const SOURCES = [
  { repo: "anthropics/skills", label: "Anthropic 官方", labelEn: "Anthropic official", tier: 0, official: true },
  { repo: "openai/skills", label: "OpenAI 官方", labelEn: "OpenAI official", tier: 0, official: true },
  { repo: "agentskills/agentskills", label: "Agent Skills 规范", labelEn: "Agent Skills spec", tier: 0, official: true },
  { repo: "mattpocock/skills", label: "Matt Pocock", labelEn: "Matt Pocock", tier: 1 },
  { repo: "obra/superpowers", label: "Superpowers", labelEn: "Superpowers", tier: 1 },
  { repo: "vercel-labs/skills", label: "Vercel Labs", labelEn: "Vercel Labs", tier: 1 },
  { repo: "fralapo/awesome-agent-skills", label: "Awesome Agent Skills", labelEn: "Awesome Agent Skills", tier: 2 },
  { repo: "alirezarezvani/claude-skills", label: "Claude Skills", labelEn: "Claude Skills", tier: 2 },
  { repo: "ComposioHQ/awesome-claude-skills", label: "Awesome Claude Skills", labelEn: "Awesome Claude Skills", tier: 2 },
  { repo: "sickn33/antigravity-awesome-skills", label: "Antigravity Awesome Skills", labelEn: "Antigravity Awesome Skills", tier: 3 },
  { repo: "VoltAgent/awesome-agent-skills", label: "VoltAgent 精选目录", labelEn: "VoltAgent curated list", tier: 2 },
  { repo: "milad-ahmd/awesome-agent-skills", label: "Awesome Agent Skills (社区)", labelEn: "Awesome Agent Skills (community)", tier: 2 },
];

/** 页面上展示的「官方与标准源头 / 聚合搜索站」，均已逐一联网核实 */
const REFERENCES = [
  { group: "official", name: "Anthropic 官方 Skills 仓库", nameEn: "Anthropic official skills", url: "https://github.com/anthropics/skills", note: "Agent Skills 参考实现，20 个官方 SKILL.md", noteEn: "Reference implementation with 20 official SKILL.md files" },
  { group: "official", name: "Agent Skills 开放标准", nameEn: "Agent Skills open standard", url: "https://agentskills.io", note: "Anthropic 开放，SKILL.md 可跨 agent 复用", noteEn: "Opened by Anthropic; SKILL.md works across agents" },
  { group: "official", name: "Agent Skills 规范仓库", nameEn: "Agent Skills spec repo", url: "https://github.com/agentskills/agentskills", note: "规范与开放开发", noteEn: "Specification and open development" },
  { group: "official", name: "OpenAI Codex Skills", nameEn: "OpenAI Codex Skills", url: "https://github.com/openai/skills", note: "44 个官方 SKILL.md", noteEn: "44 official SKILL.md files" },
  { group: "aggregator", name: "FindSkills", nameEn: "FindSkills", url: "https://findskills.org", note: "117,914 条索引，含质量/安全评分与 CLI", noteEn: "117,914 indexed skills with quality/safety scores and CLI" },
  { group: "aggregator", name: "skills.sh", nameEn: "skills.sh", url: "https://skills.sh", note: "安装量榜，npx skills add", noteEn: "Install-count leaderboard, npx skills add" },
  { group: "aggregator", name: "AI DevKit Skills", nameEn: "AI DevKit Skills", url: "https://ai-devkit.com/docs/7-skills", note: "SKILL.md 注册表与本地缓存", noteEn: "SKILL.md registries with local caching" },
  { group: "aggregator", name: "SkillMD", nameEn: "SkillMD", url: "https://skillmd.com", note: "插件化 Skill 目录", noteEn: "Plugin-style skill directory" },
  { group: "aggregator", name: "ClaudePluginHub · DevKit", nameEn: "ClaudePluginHub · DevKit", url: "https://www.claudepluginhub.com/plugins/curiouslearner-devkit", note: "52 个开发类 Skill 插件", noteEn: "52 engineering skills as a plugin" },
  { group: "aggregator", name: "OpenSkills", nameEn: "OpenSkills", url: "https://openskills.space", note: "Skill 搜索站", noteEn: "Skill discovery site" },
  { group: "aggregator", name: "agent-skills.md", nameEn: "agent-skills.md", url: "https://agent-skills.md", note: "Skill 发现站", noteEn: "Skill discovery site" },
  { group: "directory", name: "VoltAgent/awesome-agent-skills", nameEn: "VoltAgent/awesome-agent-skills", url: "https://github.com/VoltAgent/awesome-agent-skills", note: "社区精选列表", noteEn: "Community curated list" },
  { group: "directory", name: "milad-ahmd/awesome-agent-skills", nameEn: "milad-ahmd/awesome-agent-skills", url: "https://github.com/milad-ahmd/awesome-agent-skills", note: "51 个实用 Skill 列表", noteEn: "List of 51 practical skills" },
  { group: "directory", name: "fralapo/awesome-agent-skills", nameEn: "fralapo/awesome-agent-skills", url: "https://github.com/fralapo/awesome-agent-skills", note: "22 个语料蒸馏 Skill", noteEn: "22 corpus-distilled skills" },
  { group: "directory", name: "GitHub · agent-skills topic", nameEn: "GitHub · agent-skills topic", url: "https://github.com/topics/agent-skills", note: "40,000+ 真实仓库", noteEn: "40,000+ real repositories" },
];

const CATEGORY_RULES = [
  ["docs", /(pdf|docx|xlsx|pptx|document|spreadsheet|slide|excel|word|powerpoint|markdown|文档|表格|演示)/i],
  ["design", /(design|ui|ux|css|canvas|visual|image|art|frontend|figma|typography|color|设计|视觉|插画|海报)/i],
  ["writing", /(writ|copy|blog|content|seo|email|newsletter|文案|写作|润色|标题|翻译)/i],
  ["research", /(research|data|analy|sql|chart|ml|ai model|science|统计|科研|数据|分析|论文)/i],
  ["growth", /(marketing|growth|social|sales|launch|brand|ads|twitter|linkedin|营销|增长|社媒|推广)/i],
  ["automation", /(automat|workflow|ci\/cd|deploy|docker|git |github action|test|debug|refactor|agent|mcp|自动|部署|工作流|测试|调试)/i],
];
function classify(name, description) {
  const text = `${name} ${description}`;
  for (const [slug, re] of CATEGORY_RULES) if (re.test(text)) return slug;
  return "engineering";
}

async function gh(url) {
  const res = await fetch(url, { headers: API_HEADERS, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url}`);
  return res.json();
}

async function fetchText(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: RAW_HEADERS, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      /* 网络抖动重试一次 */
    }
  }
  return null;
}

/** 解析 SKILL.md 的 YAML frontmatter：只取 name / description，支持块标量（| 与 >） */
function parseFrontmatter(md, fallbackName) {
  if (!md || !md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end < 0) return null;
  const lines = md.slice(3, end).split(/\r?\n/);

  const field = (key) => {
    const idx = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
    if (idx < 0) return "";
    let first = lines[idx].replace(new RegExp(`^${key}\\s*:\\s*`), "").trim();
    if (/^[|>][+-]?\s*$/.test(first) || first === "") {
      const out = [];
      for (let j = idx + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "") { out.push(""); continue; }
        if (!/^\s/.test(l)) break;
        out.push(l.trim());
      }
      return out.join(" ").replace(/\s+/g, " ").trim();
    }
    if ((first.startsWith('"') && first.endsWith('"')) || (first.startsWith("'") && first.endsWith("'"))) {
      first = first.slice(1, -1);
    }
    return first;
  };

  const rawName = field("name") || fallbackName;
  const rawDesc = field("description");
  const name = rawName.trim().slice(0, 80).replace(/^["']|["']$/g, "");
  const description = rawDesc.replace(/\s+/g, " ").trim().slice(0, 420);
  if (!name || name.length < 2 || description.length < 12) return null;
  /* 明显是模板 / 占位 / 纯编号的 SKILL.md 不算可收录的真实技能 */
  if (/^(template|example|placeholder|untitled|test)[-_ ]?skill$/i.test(name) || /^\d+$/.test(name)) return null;
  if (/replace with|placeholder description|your description|todo:|example only/i.test(description)) return null;
  return { name, description };
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

const CACHE_DIR = path.join(ROOT, "scripts", ".cache", "skills-sources");
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

/** GitHub 未认证核心 API 只有 60 次/小时，仓库树抓一次就缓存 7 天，保证可反复重跑 */
async function loadSource(src) {
  const file = path.join(CACHE_DIR, `${src.repo.replace("/", "__")}.json`);
  try {
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (cached.cachedAt && Date.now() - cached.cachedAt < CACHE_TTL) return { ...cached.data, fromCache: true };
  } catch {
    /* 无缓存 / 缓存损坏 → 重新请求 */
  }
  const info = await gh(`https://api.github.com/repos/${src.repo}`);
  const tree = await gh(
    `https://api.github.com/repos/${src.repo}/git/trees/${encodeURIComponent(info.default_branch)}?recursive=1`,
  );
  const data = {
    branch: info.default_branch,
    stars: info.stargazers_count,
    topics: (info.topics || []).slice(0, 6),
    pushedAt: info.pushed_at,
    truncated: !!tree.truncated,
    paths: (tree.tree || [])
      .filter((x) => x.type === "blob" && /(^|\/)SKILL\.md$/i.test(x.path))
      .map((x) => x.path)
      .sort(),
  };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ cachedAt: Date.now(), data }), "utf8");
  return { ...data, fromCache: false };
}

async function main() {
  console.log(`目标：${TARGET} 条真实 SKILL.md（token: ${TOKEN ? "有" : "无"}）`);
  const candidates = [];
  const sourceMeta = [];

  for (const src of SOURCES) {
    try {
      const s = await loadSource(src);
      const { branch, stars, topics, pushedAt, truncated, paths: files } = s;
      sourceMeta.push({
        repo: src.repo,
        label: src.label,
        labelEn: src.labelEn,
        tier: src.tier,
        official: !!src.official,
        url: `https://github.com/${src.repo}`,
        stars,
        branch,
        skillMdCount: files.length,
        truncated,
      });
      for (const p of files) {
        candidates.push({
          ...src,
          branch,
          filePath: p,
          dirName: p.split("/").slice(-2, -1)[0] || src.repo.split("/")[1],
          stars,
          repoUrl: `https://github.com/${src.repo}`,
          topics,
          pushedAt,
        });
      }
      console.log(`  ${src.repo.padEnd(42)} SKILL.md=${String(files.length).padEnd(5)} stars=${stars}${s.fromCache ? " (cache)" : ""}`);
    } catch (e) {
      console.warn(`  ${src.repo} 跳过：${e.message}`);
      sourceMeta.push({ repo: src.repo, label: src.label, labelEn: src.labelEn, tier: src.tier, official: !!src.official, url: `https://github.com/${src.repo}`, stars: 0, skillMdCount: 0, error: e.message });
    }
  }

  /* 高可信来源优先；同一来源内路径有序，保证结果可复现 */
  candidates.sort((a, b) => a.tier - b.tier || a.repo.localeCompare(b.repo) || a.filePath.localeCompare(b.filePath));
  const pool = candidates.slice(0, MAX_CANDIDATES);
  console.log(`候选 SKILL.md：${pool.length} / 总 ${candidates.length}`);

  const items = [];
  const seen = new Set();
  const BATCH = 40;

  for (let i = 0; i < pool.length && items.length < TARGET; i += BATCH) {
    const batch = pool.slice(i, i + BATCH);
    const parsed = await Promise.all(
      batch.map(async (c) => {
        const raw = `https://raw.githubusercontent.com/${c.repo}/${c.branch}/${encPath(c.filePath)}`;
        const md = await fetchText(raw);
        const fm = parseFrontmatter(md, c.dirName);
        if (!fm) return null;
        const key = fm.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-");
        return { key, c, fm };
      }),
    );
    for (const r of parsed) {
      if (!r || seen.has(r.key)) continue;
      seen.add(r.key);
      const { c, fm } = r;
      const fileUrl = `https://github.com/${c.repo}/blob/${c.branch}/${encPath(c.filePath)}`;
      items.push({
        id: `${c.repo}#${c.filePath}`,
        name: fm.name,
        description: fm.description,
        repo: c.repo,
        sourceLabel: c.label,
        sourceLabelEn: c.labelEn,
        official: !!c.official,
        category: classify(fm.name, fm.description),
        stars: c.stars,
        topics: c.topics,
        pushedAt: c.pushedAt,
        url: fileUrl,
        github: c.repoUrl,
        path: c.filePath,
      });
      if (items.length >= TARGET) break;
    }
    process.stdout.write(`\r  已收录 ${items.length}/${TARGET}（扫描 ${Math.min(i + BATCH, pool.length)}/${pool.length}）   `);
  }
  console.log("");

  if (items.length < TARGET) {
    console.error(`只拿到 ${items.length} 条，未达 ${TARGET} 条；可提高 SKILLS_MAX_CANDIDATES 后重试。`);
    process.exit(1);
  }

  const bySource = {};
  for (const it of items) bySource[it.repo] = (bySource[it.repo] || 0) + 1;
  for (const s of sourceMeta) s.included = bySource[s.repo] || 0;

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      snapshot: new Date().toISOString().slice(0, 10),
      total: items.length,
      scannedCandidates: pool.length,
      totalCandidates: candidates.length,
      method: "Enumerate real SKILL.md files from public GitHub repository trees, then read each file's YAML frontmatter (name + description) verbatim. No generated names, descriptions, star counts or install commands.",
      methodZh: "枚举公开 GitHub 仓库目录树中真实存在的 SKILL.md，逐条读取该文件 YAML frontmatter 的 name 与 description 原文；名称、简介、Star、链接均来自真实数据，不生成、不翻译、不推测安装命令。",
      sources: sourceMeta,
      references: REFERENCES,
    },
    items,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload)}\n`, "utf8");
  /* 构建期只需要 meta（几 KB），完整数据由客户端按需 fetch，避免每个页面内联 1000 条 */
  const META_OUT = path.join(ROOT, "src", "data", "skills-catalog-meta.json");
  await mkdir(path.dirname(META_OUT), { recursive: true });
  await writeFile(META_OUT, `${JSON.stringify(payload.meta)}\n`, "utf8");
  console.log(`\n✅ 写出 ${OUT}`);
  console.log(`   条目 ${items.length} 条 / 来源 ${Object.keys(bySource).length} 个仓库 / 文件 ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`);
  console.log(`   分布：${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
