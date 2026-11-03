/** Verified 徽章（橙色线描圆标 + 描边对勾，统一用户认证标志样式）。
 *  用于世界页、个人主页、搜索与管理后台——所有「用户/作者账号认证」处统一此样式。 */
export default function GoldBadge({ className = "h-[15px] w-[15px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Verified" role="img" fill="none">
      {/* 星齿/花瓣外圈：橙色描边，透明填充 */}
      <path
        stroke="#F08A4B"
        strokeWidth={2}
        strokeLinejoin="round"
        d="M12 1.6l2.6 2.2 3.4-.4 1.1 3.2 3 1.7-1 3.2 1 3.2-3 1.7-1.1 3.2-3.4-.4L12 22.4l-2.6-2.2-3.4.4-1.1-3.2-3-1.7 1-3.2-1-3.2 3-1.7 1.1-3.2 3.4.4z"
      />
      {/* 内部对勾：橙色描边 */}
      <path
        stroke="#F08A4B"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.5 12.2l2.3 2.3 4.7-4.7"
      />
    </svg>
  );
}
