/**
 * SolHub 官方账号管理（Node，仅本地 / CI 运行，不进前端包）。
 *
 * 官方账号是一个真实的邮箱用户（solhub@solyoung.top，前端显示为 @solhub），
 * 用来在世界里发布产品更新日志。每次部署后调用 scripts/changelog.mjs 即可发一条。
 *
 * 凭据保存在仓库外的 .env.changelog（已被 .gitignore 忽略），不会进版本库。
 * 也可通过环境变量覆盖：SOLHUB_API / OFFICIAL_EMAIL / OFFICIAL_PASSWORD / OFFICIAL_AVATAR_DATAURL。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";

const API = process.env.SOLHUB_API || "https://solhub-auth.solyoung.top";
const CONFIG_PATH = path.resolve(process.cwd(), ".env.changelog");
const AVATAR_SRC = path.resolve(process.cwd(), "scripts/official-avatar.png");

export const DEFAULT_EMAIL = "solhub@solyoung.top";
const OFFICIAL_NAME = "SolHub 官方";
const OFFICIAL_BIO = "SolHub 官方账号 · 每一次产品更新都会在这里同步发布";
const OFFICIAL_WEBSITE = "https://solhub.solyoung.top";

function loadConfig() {
  const cfg = {
    OFFICIAL_EMAIL: process.env.OFFICIAL_EMAIL || DEFAULT_EMAIL,
    OFFICIAL_PASSWORD: process.env.OFFICIAL_PASSWORD || "",
    OFFICIAL_AVATAR_DATAURL: process.env.OFFICIAL_AVATAR_DATAURL || "",
  };
  if (existsSync(CONFIG_PATH)) {
    for (const line of readFileSync(CONFIG_PATH, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && cfg[m[1]] === "") cfg[m[1]] = m[2];
    }
  }
  return cfg;
}

function saveConfig(cfg) {
  writeFileSync(
    CONFIG_PATH,
    `OFFICIAL_EMAIL=${cfg.OFFICIAL_EMAIL}\nOFFICIAL_PASSWORD=${cfg.OFFICIAL_PASSWORD}\n`,
  );
}

function genPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.randomBytes(24);
  let s = "";
  for (let i = 0; i < 24; i++) s += chars[b[i] % chars.length];
  return s;
}

/** 把源 PNG 压成 240×240 的 JPEG data URL（Worker 头像上限 300KB）。 */
function avatarDataUrl() {
  const tmp = path.join("/tmp", `official-avatar-${Date.now()}.jpg`);
  execFileSync("sips", ["-z", "240", "240", AVATAR_SRC, "--out", tmp, "--setProperty", "format", "jpeg"]);
  const b64 = readFileSync(tmp).toString("base64");
  return `data:image/jpeg;base64,${b64}`;
}

async function call(url, { method = "GET", body, cookie } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, cookie: res.headers.get("set-cookie") };
}

async function login(email, password) {
  const r = await call(`${API}/auth/login`, { method: "POST", body: { email, password } });
  if (!r.ok) return null;
  return r.cookie ? r.cookie.split(";")[0] : null;
}

/**
 * 确保官方账号存在并资料完整：不存在就注册，随后更新昵称 / 简介 / 网站 / 头像。
 * 返回会话 Cookie（用于后续发帖）。
 */
export async function ensureOfficial() {
  const cfg = loadConfig();
  if (!cfg.OFFICIAL_PASSWORD) {
    cfg.OFFICIAL_PASSWORD = genPassword();
    saveConfig(cfg);
    console.log("✓ 已生成并保存官方账号密码到 .env.changelog");
  }

  let cookie = await login(cfg.OFFICIAL_EMAIL, cfg.OFFICIAL_PASSWORD);
  if (!cookie) {
    const reg = await call(`${API}/auth/register`, {
      method: "POST",
      body: { email: cfg.OFFICIAL_EMAIL, password: cfg.OFFICIAL_PASSWORD, displayName: OFFICIAL_NAME },
    });
    if (!reg.ok) {
      // 已经存在但密码不匹配：提示用户
      if (reg.status === 409) {
        throw new Error(
          `账号 ${cfg.OFFICIAL_EMAIL} 已存在但密码不匹配，请删除 .env.changelog 中的 OFFICIAL_PASSWORD 或核对凭据`,
        );
      }
      throw new Error(`注册官方账号失败（${reg.status}）: ${JSON.stringify(reg.data)}`);
    }
    cookie = reg.cookie ? reg.cookie.split(";")[0] : null;
    if (!cookie) throw new Error("注册成功但未返回会话 Cookie");
    console.log(`✓ 已注册官方账号 ${cfg.OFFICIAL_EMAIL}`);
  }

  const avatar = cfg.OFFICIAL_AVATAR_DATAURL || avatarDataUrl();
  const prof = await call(`${API}/profile`, {
    method: "PUT",
    cookie,
    body: { displayName: OFFICIAL_NAME, bio: OFFICIAL_BIO, website: OFFICIAL_WEBSITE, avatar },
  });
  if (!prof.ok) throw new Error(`更新官方账号资料失败（${prof.status}）: ${JSON.stringify(prof.data)}`);

  return cookie;
}

/** 以官方账号身份发布一条更新日志。 */
export async function postChangelog(text) {
  const cookie = await ensureOfficial();
  const r = await call(`${API}/world/posts`, { method: "POST", cookie, body: { text } });
  if (!r.ok) throw new Error(`发布更新日志失败（${r.status}）: ${JSON.stringify(r.data)}`);
  return r.data;
}
