/**
 * Skill 页底部「数据来源与核验」用的静态清单。
 *
 * 以前这里的数据来自 scripts/build-skills-catalog.mjs 的产物 meta，
 * 那份脚本同时会生成 1300+ 条 SKILL.md 索引。索引下线后，页面只需要这张
 * 来源表，改成静态数据，构建不再依赖任何采集产物。
 *
 * 收录口径：只放**逐个联网核实过**的官方源头、聚合站与社区目录，
 * 不放无法验证的链接；note 里的数量与日期是核验当时的快照，过期需重新核对。
 */
export type SkillSourceGroup = "official" | "aggregator" | "directory";

export interface SkillSourceLink {
  group: SkillSourceGroup;
  name: string;
  nameEn: string;
  url: string;
  note: string;
  noteEn: string;
}

export const SKILL_SOURCE_GROUPS: { key: SkillSourceGroup; zh: string; en: string }[] = [
  { key: "official", zh: "官方与标准源头", en: "Official & standards" },
  { key: "aggregator", zh: "聚合搜索站 / 市场", en: "Aggregators & marketplaces" },
  { key: "directory", zh: "社区目录仓库", en: "Community lists" },
];

export const SKILL_SOURCES: SkillSourceLink[] = [
  {
    group: "official",
    name: "Anthropic 官方 Skills 仓库",
    nameEn: "Anthropic official skills",
    url: "https://github.com/anthropics/skills",
    note: "Agent Skills 参考实现，20 个官方 SKILL.md",
    noteEn: "Reference implementation with 20 official SKILL.md files",
  },
  {
    group: "official",
    name: "Agent Skills 开放标准",
    nameEn: "Agent Skills open standard",
    url: "https://agentskills.io",
    note: "Anthropic 开放，SKILL.md 可跨 agent 复用",
    noteEn: "Opened by Anthropic; SKILL.md works across agents",
  },
  {
    group: "official",
    name: "Agent Skills 规范仓库",
    nameEn: "Agent Skills spec repo",
    url: "https://github.com/agentskills/agentskills",
    note: "规范与开放开发",
    noteEn: "Specification and open development",
  },
  {
    group: "official",
    name: "OpenAI Codex Skills",
    nameEn: "OpenAI Codex Skills",
    url: "https://github.com/openai/skills",
    note: "44 个官方 SKILL.md",
    noteEn: "44 official SKILL.md files",
  },
  {
    group: "aggregator",
    name: "FindSkills",
    nameEn: "FindSkills",
    url: "https://findskills.org",
    note: "117,914 条索引，含质量/安全评分与 CLI",
    noteEn: "117,914 indexed skills with quality/safety scores and CLI",
  },
  {
    group: "aggregator",
    name: "skills.sh",
    nameEn: "skills.sh",
    url: "https://skills.sh",
    note: "安装量榜，npx skills add",
    noteEn: "Install-count leaderboard, npx skills add",
  },
  {
    group: "aggregator",
    name: "AI DevKit Skills",
    nameEn: "AI DevKit Skills",
    url: "https://ai-devkit.com/docs/7-skills",
    note: "SKILL.md 注册表与本地缓存",
    noteEn: "SKILL.md registries with local caching",
  },
  {
    group: "aggregator",
    name: "SkillMD",
    nameEn: "SkillMD",
    url: "https://skillmd.com",
    note: "插件化 Skill 目录",
    noteEn: "Plugin-style skill directory",
  },
  {
    group: "aggregator",
    name: "ClaudePluginHub · DevKit",
    nameEn: "ClaudePluginHub · DevKit",
    url: "https://www.claudepluginhub.com/plugins/curiouslearner-devkit",
    note: "52 个开发类 Skill 插件",
    noteEn: "52 engineering skills as a plugin",
  },
  {
    group: "aggregator",
    name: "OpenSkills",
    nameEn: "OpenSkills",
    url: "https://openskills.space",
    note: "Skill 搜索站",
    noteEn: "Skill discovery site",
  },
  {
    group: "aggregator",
    name: "agent-skills.md",
    nameEn: "agent-skills.md",
    url: "https://agent-skills.md",
    note: "Skill 发现站",
    noteEn: "Skill discovery site",
  },
  {
    group: "directory",
    name: "VoltAgent/awesome-agent-skills",
    nameEn: "VoltAgent/awesome-agent-skills",
    url: "https://github.com/VoltAgent/awesome-agent-skills",
    note: "社区精选列表",
    noteEn: "Community curated list",
  },
  {
    group: "directory",
    name: "milad-ahmd/awesome-agent-skills",
    nameEn: "milad-ahmd/awesome-agent-skills",
    url: "https://github.com/milad-ahmd/awesome-agent-skills",
    note: "51 个实用 Skill 列表",
    noteEn: "List of 51 practical skills",
  },
  {
    group: "directory",
    name: "fralapo/awesome-agent-skills",
    nameEn: "fralapo/awesome-agent-skills",
    url: "https://github.com/fralapo/awesome-agent-skills",
    note: "22 个语料蒸馏 Skill",
    noteEn: "22 corpus-distilled skills",
  },
  {
    group: "directory",
    name: "GitHub · agent-skills topic",
    nameEn: "GitHub · agent-skills topic",
    url: "https://github.com/topics/agent-skills",
    note: "40,000+ 真实仓库",
    noteEn: "40,000+ real repositories",
  },
];
