/** 用户认证徽章（橙色锯齿徽章 + 白色对勾，Twitter 风格 seal 形状）。
 *  形状取自 lucide BadgeCheck 的锯齿外圈，实心填充 + 白勾；
 *  颜色沿用品牌橙黄 #F08A4B（用户账号认证专用，产品认证请用 VerifiedBadge）。 */
export default function GoldBadge({ className = "h-[15px] w-[15px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Verified" role="img">
      {/* 锯齿徽章外圈：橙色实心填充 */}
      <path
        fill="#F08A4B"
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
      />
      {/* 白色对勾：微内收，避免碰到锯齿边缘 */}
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
