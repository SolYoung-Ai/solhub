/* ============================================================
   Google AdSense 配置
   ------------------------------------------------------------
   默认关闭：只有构建时存在合法的 PUBLIC_ADSENSE_CLIENT 才会注入
   AdSense 脚本和广告位，未配置时整站零广告请求、零 <ins> 占位，
   隐私页也自动不声明广告 —— 所以本地开发和未过审阶段不受影响。

   构建在 GitHub Actions 上跑，变量要同时配到仓库 Variables，
   详见 docs/ADSENSE.md（scripts/setup-adsense.mjs 会打印步骤）。
   ============================================================ */

/** 广告位类型：文内（详情页）/ 列表页底部 */
export type AdUnit = "article" | "list";

/** ca-pub- 后面是 16 位数字，这里放宽到 10~20 位以兼容 Google 未来的调整 */
export function normalizeClient(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  return /^ca-pub-\d{10,20}$/.test(v) ? v : "";
}

/** 广告单元 id 是纯数字，长度 10 位左右 */
export function normalizeSlot(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  return /^\d{6,20}$/.test(v) ? v : "";
}

/** ads.txt 里必须写的那一行（pub- 前缀不带 ca-） */
export function adsTxtRecord(client: string): string {
  const id = normalizeClient(client).replace(/^ca-/, "");
  return id ? `google.com, ${id}, DIRECT, f08c47fec0942fa0` : "";
}

export const adsClient = normalizeClient(import.meta.env.PUBLIC_ADSENSE_CLIENT);

/** 是否启用广告：全站唯一开关 */
export const adsEnabled = adsClient !== "";

const UNITS: Record<AdUnit, string> = {
  article: normalizeSlot(import.meta.env.PUBLIC_ADSENSE_SLOT_ARTICLE),
  list: normalizeSlot(import.meta.env.PUBLIC_ADSENSE_SLOT_LIST),
};

/** 取广告单元 id；未配置返回空串，AdSlot 据此整块不渲染 */
export function adSlot(unit: AdUnit): string {
  return UNITS[unit] ?? "";
}
