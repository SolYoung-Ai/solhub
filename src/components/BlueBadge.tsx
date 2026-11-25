/**
 * 官方账号徽章（蓝色锯齿徽章 + 白色对勾）。
 *
 * 认证分轨（2026-11-26 起）：
 *   - 蓝V（本组件）= 官方账号：SolHub 官方、SolHub 编辑部这类由站方维护、
 *     用于收录与发布的账号；
 *   - 黄V（GoldBadge）= 创作者账号：真实提交过产品的个人开发者；
 *   - 绿V（VerifiedBadge）= 产品核验，不代表账号身份，三者不可互用。
 *
 * 形状与 GoldBadge 一致（lucide BadgeCheck 的锯齿外圈），只换填充色，
 * 让「认证」这件事在不同身份下保持同一个视觉语言。
 */
export default function BlueBadge({ className = "h-[15px] w-[15px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Official account" role="img">
      <path
        fill="#2F80ED"
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
      />
      <path
        stroke="#fff"
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        d="M8.6 12.2l2.3 2.3 4.5-4.5"
      />
    </svg>
  );
}
