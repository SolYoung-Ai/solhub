import { ShieldCheck } from "lucide-react";

/** 产品核验标志：绿色胶囊 + 盾形对勾 + Verified 文字。
 *  设计约定：用户认证 = 橙色黄V（GoldBadge），产品认证 = 绿色 Verified（本组件）。
 *  用于个人主页 / 公开主页的产品卡片，与用户黄V 明确区分。 */
export default function VerifiedBadge({
  label = "Verified",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-success ${className}`}
      aria-label={label}
    >
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}
