/** Verified 徽章（金色圆标 + 白勾，X 风格）。用于世界页、个人主页、搜索与管理后台。 */
export default function GoldBadge({ className = "h-[15px] w-[15px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Verified" role="img">
      <path
        fill="#E2A500"
        d="M12 1.6l2.6 2.2 3.4-.4 1.1 3.2 3 1.7-1 3.2 1 3.2-3 1.7-1.1 3.2-3.4-.4L12 22.4l-2.6-2.2-3.4.4-1.1-3.2-3-1.7 1-3.2-1-3.2 3-1.7 1.1-3.2 3.4.4z"
      />
      <path fill="#fff" d="M10.7 15.2l-2.9-2.9 1.3-1.3 1.6 1.6 4-4 1.3 1.3z" />
    </svg>
  );
}
