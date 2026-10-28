/** 密码生成纯逻辑（浏览器原生安全随机数） */

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?";

export function generatePassword(options: PasswordOptions): { ok: true; password: string } | { ok: false; error: string } {
  const length = Math.floor(options.length);
  if (!Number.isFinite(length) || length < 4 || length > 128) {
    return { ok: false, error: "密码长度需在 4–128 之间。" };
  }
  const pools: string[] = [];
  if (options.uppercase) pools.push(UPPER);
  if (options.lowercase) pools.push(LOWER);
  if (options.numbers) pools.push(NUMBERS);
  if (options.symbols) pools.push(SYMBOLS);
  if (pools.length === 0) {
    return { ok: false, error: "至少选择一种字符类型。" };
  }
  const all = pools.join("");
  const random = (max: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  };

  // 先确保每种已选字符至少出现一次（Fisher-Yates 之后保证分布）
  const chars: string[] = [];
  for (const pool of pools) {
    chars.push(pool[random(pool.length)]);
  }
  while (chars.length < length) {
    chars.push(all[random(all.length)]);
  }
  // 洗牌
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return { ok: true, password: chars.join("") };
}
