/** Verified 徽章（橙色线描圆标 + 描边对勾，统一用户认证标志样式）。
 *  用于世界页、个人主页、搜索与管理后台——所有「用户/作者账号认证」处统一此样式。 */
export default function GoldBadge({ className = "h-[15px] w-[15px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Verified" role="img" fill="none">
      {/* 圆形外圈：橙色描边，透明填充（正圆，不歪不扁） */}
      <circle
        cx={12}
        cy={12}
        r={9.5}
        stroke="#F08A4B"
        strokeWidth={2}
      />
      {/* 内部对勾：橙色描边，居中 */}
      <path
        stroke="#F08A4B"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.4 12.1l2.4 2.4 4.8-4.8"
      />
    </svg>
  );
}
