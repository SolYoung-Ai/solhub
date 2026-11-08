/**
 * 「我的 Skill」提交记录。
 *
 * Skill 走邮件 + 人工核验，收录到静态快照 src/data/skills.ts，服务端目前没有
 * 按账号存 Skill 的表。为了让用户能立刻管理自己提交过的 Skill，提交表单会把
 * 一份记录写进 localStorage，个人中心的 Skill 标签读取并支持编辑 / 删除 / 标记状态。
 *
 * 注意：这是「本浏览器」的数据，不是云同步；收录状态由用户手动标记（核验通过
 * 后条目才会出现在公开 Skill 库）。若将来接入后端，只需把这里换成 API 调用。
 */

export type MySkillStatus = "pending" | "listed";

export interface MySkill {
  id: string;
  /** 提交时登录账号的 login / email；未登录为 "guest" */
  owner: string;
  name: string;
  repoUrl: string;
  installCommand: string;
  platform: string;
  shortDescription: string;
  description: string;
  category: string;
  /** 逗号分隔，原样保存方便回填表单 */
  tags: string;
  author: string;
  contact: string;
  status: MySkillStatus;
  createdAt: string;
  updatedAt: string;
}

export type MySkillInput = Omit<MySkill, "id" | "owner" | "status" | "createdAt" | "updatedAt">;

const KEY = "solhub:my-skills:v1";

export function ownerKey(user?: { login?: string; email?: string } | null): string {
  return user?.login || user?.email || "guest";
}

function safeParse(raw: string | null): MySkill[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (x): x is MySkill =>
        !!x && typeof x === "object" && typeof (x as MySkill).id === "string" && typeof (x as MySkill).name === "string",
    );
  } catch {
    return [];
  }
}

export function readAllMySkills(): MySkill[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParse(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

function writeAll(list: MySkill[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式 / 配额满：仅本次会话内可用，不阻断提交 */
  }
}

/** 当前账号可见的记录：本人 + 未登录时提交的历史草稿 */
export function listMySkills(owner: string): MySkill[] {
  return readAllMySkills()
    .filter((s) => s.owner === owner || (owner !== "guest" && s.owner === "guest"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 新增或按「同名 + 同仓库 + 同账号」更新，避免重复提交堆出多条 */
export function saveMySkill(input: MySkillInput, owner: string): MySkill {
  const all = readAllMySkills();
  const now = new Date().toISOString();
  const idx = all.findIndex(
    (s) =>
      s.owner === owner &&
      s.name.trim().toLowerCase() === input.name.trim().toLowerCase() &&
      s.repoUrl.trim().toLowerCase() === input.repoUrl.trim().toLowerCase(),
  );
  if (idx >= 0) {
    const next = { ...all[idx], ...input, updatedAt: now };
    all[idx] = next;
    writeAll(all);
    return next;
  }
  const record: MySkill = {
    ...input,
    id: `sk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    owner,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  writeAll([record, ...all]);
  return record;
}

export function updateMySkill(id: string, patch: Partial<MySkillInput>): void {
  writeAll(
    readAllMySkills().map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
    ),
  );
}

export function setMySkillStatus(id: string, status: MySkillStatus): void {
  writeAll(
    readAllMySkills().map((s) =>
      s.id === id ? { ...s, status, updatedAt: new Date().toISOString() } : s,
    ),
  );
}

export function removeMySkill(id: string): void {
  writeAll(readAllMySkills().filter((s) => s.id !== id));
}
