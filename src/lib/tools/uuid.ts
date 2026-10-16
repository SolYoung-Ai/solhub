/** UUID 生成纯逻辑（基于 Web Crypto API） */

export function generateUuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 降级：crypto.getRandomValues + 手动构造 v4
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateUuids(count: number): string[] {
  const n = Math.max(1, Math.min(Math.floor(count), 5000));
  return Array.from({ length: n }, () => generateUuidV4());
}
