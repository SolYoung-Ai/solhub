#!/usr/bin/env node
/**
 * 生成「全网真实 Skill 索引」快照 → public/data/skills-catalog.json
 *
 * 口径（重要，避免把普通仓库当成 Skill）：
 *   1. 只收录 GitHub 仓库中真实存在的 `SKILL.md` 文件（Agent Skills 规范：一个 Skill = 一个含 SKILL.md 的目录）。
 *   2. 名称与简介**直接读取该 SKILL.md 的 YAML frontmatter 原文**，不生成、不翻译、不推测。
 *   3. 每条都带可点击核验的 GitHub 源文件链接、所属仓库与其真实 star 数。
 *   4. 没有 frontmatter / 简介过短的条目直接丢弃；不写死任何安装命令。
 *   5. 热度 = 所属仓库 star（对数归一，75%）+ 最近推送新鲜度（指数衰减，25%），
 *      官方来源加 5 分；最终按热度降序输出并写死 rank，前端默认就按它排。
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
/** 按热度取前 1000，多采 30% 再截断，避免「第 1001 条其实更热」 */
const COLLECT = Math.ceil(TARGET * 1.3);
/** --refresh：忽略 7 天缓存，重新抓 star / pushed_at（热度排序依赖这两个值的新鲜度） */
const FORCE_REFRESH = process.argv.includes("--refresh");
/** GitHub 搜索补充的热门仓库个数（0 = 只用固定来源，省 API 额度） */
const DISCOVER = Number(process.env.SKILLS_DISCOVER ?? 6);
/** 轮转轮数上限，只是防止某个仓库文件数无限时的兜底；
    真正的分散靠「每个仓库轮流取一条」实现：
    取 1.3 倍候选时各仓库条数自然接近，最终榜单单仓占比通常 < 10%。 */
const MAX_PER_REPO = Number(process.env.SKILLS_MAX_PER_REPO || 1000);

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
async function loadSource(src, force = false) {
  const file = path.join(CACHE_DIR, `${src.repo.replace("/", "__")}.json`);
  try {
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (!force && cached.cachedAt && Date.now() - cached.cachedAt < CACHE_TTL) return { ...cached.data, fromCache: true };
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

/* ---------------------------------------------------------------
   热度：star 是对数归一的「体量」，pushed_at 是「还活着吗」。
   全网 Skill 没有统一安装量，仓库 star 是最能横向比较的信号；
   新鲜度做指数衰减（300 天剩约 37%），避免多年不维护的老仓霸榜。
   --------------------------------------------------------------- */
const STAR_REF = 50000;
/**
 * 热度 0–100。
 * star 用「本榜最冷/最热仓库」做 min-max（对数刻度）归一，而不是除一个写死的常量：
 * 这些仓库动辄 3 万星起，除以常量会让整段饱和在 95+，数字失去区分度；
 * 用本榜区间归一，第 1 名 100、榜尾接近 0，卡片上的分才有意义。
 */
function heatOf(stars, pushedAt, official, logLo = 0, logHi = 6) {
  const log = Math.log10(1 + Math.max(0, stars || 0));
  const starScore = logHi > logLo ? Math.min(1, Math.max(0, (log - logLo) / (logHi - logLo))) : 1;
  const t = pushedAt ? Date.parse(pushedAt) : 0;
  const days = t ? Math.max(0, (Date.now() - t) / 86400000) : 730;
  const fresh = Math.exp(-days / 300);
  const raw = 0.75 * starScore + 0.25 * fresh + (official ? 0.05 : 0);
  return Math.round(Math.min(1, raw) * 100);
}

/** 用 GitHub 搜索把「全网最热但不在固定名单里」的仓库捞进来（消耗 search 额度，非 core） */
async function discoverHotRepos(limit) {
  if (limit <= 0) return [];
  const queries = ["topic:agent-skills", "topic:claude-skills"];
  const found = new Map();
  for (const q of queries) {
    try {
      const res = await gh(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=50`,
      );
      for (const r of res.items || []) {
        if (!found.has(r.full_name)) found.set(r.full_name, r);
      }
    } catch (e) {
      console.warn(`  搜索「${q}」失败：${e.message}`);
    }
  }
  const known = new Set(SOURCES.map((s) => s.repo));
  const picked = [...found.values()]
    .filter((r) => !known.has(r.full_name) && r.stargazers_count >= 50)
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, limit)
    .map((r) => ({ repo: r.full_name, label: r.full_name, labelEn: r.full_name, tier: 4 }));
  if (picked.length) {
    console.log(`搜索补充 ${picked.length} 个热门仓库：${picked.map((p) => `${p.repo}(${found.get(p.repo).stargazers_count}★)`).join(", ")}`);
  }
  return picked;
}

async function main() {
  console.log(`目标：${TARGET} 条真实 SKILL.md（token: ${TOKEN ? "有" : "无"}）`);
  const candidates = [];
  const sourceMeta = [];

  const discovered = await discoverHotRepos(DISCOVER);
  const sources = [...SOURCES, ...discovered];

  for (const src of sources) {
    try {
      const s = await loadSource(src, FORCE_REFRESH);
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

  /* 官方来源优先，其余按仓库 star 从高到低；同一仓库内路径有序，保证可复现 */
  candidates.sort(
    (a, b) =>
      Number(!!b.official) - Number(!!a.official) ||
      b.stars - a.stars ||
      a.repo.localeCompare(b.repo) ||
      a.filePath.localeCompare(b.filePath),
  );

  /* 按仓库轮转取样（round-robin）：
     第 1 轮各仓库各取 1 条，第 2 轮再各取 1 条……最多 MAX_PER_REPO 轮。
     好处是热门仓库不会把榜单前排全占满，且每个仓库的条数上限天然是
     MAX_PER_REPO（=10%），不用事后剪枝。 */
  const buckets = new Map();
  for (const c of candidates) {
    if (!buckets.has(c.repo)) buckets.set(c.repo, []);
    buckets.get(c.repo).push(c);
  }
  const repoOrder = [...buckets.keys()];
  const pool = [];
  for (let round = 0; round < MAX_PER_REPO && pool.length < MAX_CANDIDATES; round += 1) {
    for (const repo of repoOrder) {
      const item = buckets.get(repo)[round];
      if (item) pool.push(item);
      if (pool.length >= MAX_CANDIDATES) break;
    }
  }
  console.log(
    `候选 SKILL.md：${pool.length} / 总 ${candidates.length}（${repoOrder.length} 个仓库，最多轮转 ${MAX_PER_REPO} 轮）`,
  );

  let items = [];
  const seen = new Set();
  const perRepo = new Map();
  const BATCH = 40;

  for (let i = 0; i < pool.length && items.length < COLLECT; i += BATCH) {
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
      if ((perRepo.get(c.repo) || 0) >= MAX_PER_REPO) continue;
      perRepo.set(c.repo, (perRepo.get(c.repo) || 0) + 1);
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
        heat: 0, // 采集完拿到全量分布后再统一算，见下方 starMax
        url: fileUrl,
        github: c.repoUrl,
        path: c.filePath,
      });
      if (items.length >= COLLECT) break;
    }
    process.stdout.write(`\r  已收录 ${items.length}/${COLLECT}（扫描 ${Math.min(i + BATCH, pool.length)}/${pool.length}）   `);
  }
  console.log("");

  if (items.length < 600) {
    console.error(`只拿到 ${items.length} 条，远少于 ${TARGET} 条；可提高 SKILLS_MAX_CANDIDATES 或 SKILLS_DISCOVER 后重试。`);
    process.exit(1);
  }
  if (items.length < TARGET) {
    console.warn(`⚠️ 只拿到 ${items.length} 条（目标 ${TARGET}），先按现有条数出榜。`);
  }

  /* 采集完才知道分布：用本榜 star 的对数区间做归一，重算一次热度 */
  const logs = items.map((it) => Math.log10(1 + (it.stars || 0)));
  const logLo = Math.min(...logs);
  const logHi = Math.max(...logs);
  for (const it of items) it.heat = heatOf(it.stars, it.pushedAt, it.official, logLo, logHi);

  /* 全部条目按热度降序，写死 rank：前端默认就按这个顺序展示，不依赖客户端再算 */
  const ranked = items
    .sort((a, b) => b.heat - a.heat || b.stars - a.stars || a.name.localeCompare(b.name))
    .slice(0, TARGET);
  ranked.forEach((it, i) => {
    it.rank = i + 1;
  });
  const dropped = items.length - ranked.length;
  items = ranked;

  /* 再算一次热度：第一次的区间取自「采集到的全部候选」，里面混着 star 个位数的
     小仓库，会把区间底部压到 0，导致真正的榜单区间被挤在 80–100。
     入榜的都是头部仓库，用入榜后的区间重算，分数才有区分度（最低的约 25，
     因为新鲜度那 25% 分几乎人人都有）。顺序不变：热度对同一仓库是常量、
     对仓库 star 单调，所以不用重排。 */
  const finalLogs = items.map((it) => Math.log10(1 + (it.stars || 0)));
  const fLo = Math.min(...finalLogs);
  const fHi = Math.max(...finalLogs);
  for (const it of items) it.heat = heatOf(it.stars, it.pushedAt, it.official, fLo, fHi);

  const bySource = {};
  for (const it of items) bySource[it.repo] = (bySource[it.repo] || 0) + 1;
  for (const s of sourceMeta) s.included = bySource[s.repo] || 0;

  /* 与 SKILLS_SNAPSHOT 保持同一时区口径（北京时间），否则 UTC 日期会比精选快照早一天，
     页面上出现两个不同「快照」日期。用 Intl 显式指定时区，CI 在 UTC 也一致。 */
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const dateOf = (type) => dateParts.find((p) => p.type === type)?.value ?? "";
  const snapshot = `${dateOf("year")}-${dateOf("month")}-${dateOf("day")}`;

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      snapshot,
      total: items.length,
      scannedCandidates: pool.length,
      totalCandidates: candidates.length,
      method: "Enumerate real SKILL.md files from public GitHub repository trees, then read each file's YAML frontmatter (name + description) verbatim. No generated names, descriptions, star counts or install commands.",
      methodZh: "枚举公开 GitHub 仓库目录树中真实存在的 SKILL.md，逐条读取该文件 YAML frontmatter 的 name 与 description 原文；名称、简介、Star、链接均来自真实数据，不生成、不翻译、不推测安装命令。",
      sortedBy: "heat",
      heatMethod: "heat = 100 x (0.75 x minmax(log10(1+repoStars)) + 0.25 x exp(-daysSincePush/300) + 0.05 if official), clamped to 0-100; minmax is taken over the repositories in this list; candidates are drawn round-robin across repositories so one aggregator repo cannot dominate",
      heatMethodZh: "热度 = 所属仓库 Star（在本榜仓库区间内做对数归一，占 75%）+ 最近推送时间（指数衰减，占 25%），官方来源加 5 分；条目按热度降序，rank 即榜单名次。候选按仓库轮流取样，避免单个聚合仓霸榜。Star 属于仓库而非单个 SKILL.md，用于横向比较量级；因此同一仓库下的条目热度相同。",
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
  console.log(
    `   热度：Top1=${items[0].heat}（${items[0].name} / ${items[0].stars}★）· Top100=${items[99]?.heat} · 榜尾=${items[items.length - 1].heat}${dropped > 0 ? ` · 按热度淘汰 ${dropped} 条` : ""}`,
  );

  /* 快照是整体重写的，译文在 src/data/skills-zh.json 里另存。
     这里立刻合并一次，避免重跑快照后页面忽然全变英文。 */
  await runMergeZh();
}

async function runMergeZh() {
  try {
    const { execFileSync } = await import("node:child_process");
    const script = path.join(ROOT, "scripts", "merge-skills-zh.mjs");
    const out = execFileSync(process.execPath, [script], { encoding: "utf8" });
    process.stdout.write(out.replace(/^/gm, "   "));
  } catch (e) {
    console.warn("⚠ 中文简介合并失败（不影响快照本身）：", e?.message ?? e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
