import { useState } from "react";
import { Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import EmailSecurity from "@/components/EmailSecurity";
import { changePassword, deleteAccount, logout } from "@/lib/auth";
import { p } from "@/lib/paths";

/**
 * 账号信息面板：把与「账号本身」相关的操作集中在一处，
 *   1) 邮箱安全 —— 验证当前邮箱 / 更换登录邮箱（复用 EmailSecurity）
 *   2) 登录密码 —— 登录态下用当前密码改密（服务端会踢掉其它设备）
 *   3) 注销账号 —— 危险操作，需密码 + 勾选确认
 * 挂在个人主页（/my-submissions/）里，作为统一的账号安全入口。
 */
export default function AccountPanel({
  email,
  verified,
  locale = "zh",
  onEmailChanged,
}: {
  email: string;
  verified: boolean;
  locale?: "zh" | "en";
  onEmailChanged: (email: string) => void;
}) {
  const en = locale === "en";

  /* ---------- 修改密码 ---------- */
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);

  const resetPw = () => {
    setPwOpen(false);
    setCurPw("");
    setNewPw("");
    setNewPw2("");
    setPwErr(null);
  };

  const submitPw = async () => {
    if (newPw.length < 8) {
      setPwErr(en ? "The new password needs at least 8 characters." : "新密码至少 8 位。");
      return;
    }
    if (newPw !== newPw2) {
      setPwErr(en ? "The two new passwords do not match." : "两次输入的新密码不一致。");
      return;
    }
    setPwBusy(true);
    setPwErr(null);
    const r = await changePassword(curPw, newPw);
    setPwBusy(false);
    if (!r.ok) {
      setPwErr(r.error || (en ? "Could not change your password." : "修改密码失败。"));
      return;
    }
    setPwOk(en ? "Password updated. Other devices have been signed out." : "密码已修改，其它设备已退出登录。");
    resetPw();
  };

  /* ---------- 注销账号 ---------- */
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delAck, setDelAck] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const resetDel = () => {
    setDelOpen(false);
    setDelPw("");
    setDelAck(false);
    setDelErr(null);
  };

  const submitDel = async () => {
    if (!delAck) {
      setDelErr(en ? "Please confirm you understand this cannot be undone." : "请先勾选确认，再执行注销。");
      return;
    }
    setDelBusy(true);
    setDelErr(null);
    const r = await deleteAccount(delPw);
    setDelBusy(false);
    if (!r.ok) {
      setDelErr(r.error || (en ? "Could not delete your account." : "注销失败。"));
      return;
    }
    /* 账号已被服务端清除，清掉会话并回首页 */
    await logout();
    window.location.href = p("/", locale);
  };

  return (
    <div className="scroll-mt-24 overflow-hidden rounded-[16px] border border-border bg-card" id="account">
      {/* 区块标题 */}
      <div className="px-5 pb-1 pt-5 sm:px-7 sm:pt-6">
        <p className="text-sm font-bold text-foreground">{en ? "Account info" : "账号信息"}</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {en
            ? "Manage your sign-in email, password and account deletion. Your email is never shown publicly unless you turn it on."
            : "管理登录邮箱、登录密码与账号注销。邮箱默认不公开，只有你主动开启才会展示在主页上。"}
        </p>
      </div>

      {/* 1) 邮箱安全（验证 / 更换邮箱） */}
      <EmailSecurity
        email={email}
        verified={verified}
        locale={locale}
        onChanged={onEmailChanged}
      />

      {/* 2) 登录密码 */}
      <div className="border-t border-border px-5 py-5 sm:px-7">
        <p className="text-sm font-bold text-foreground">{en ? "Password" : "登录密码"}</p>

        {pwOpen ? (
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="label">{en ? "Current password" : "当前密码"}</span>
              <input
                type="password"
                value={curPw}
                onChange={(e) => { setCurPw(e.target.value); setPwErr(null); }}
                autoComplete="current-password"
                className="input mt-1.5 !h-11"
                placeholder="••••••••"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">{en ? "New password" : "新密码"}</span>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => { setNewPw(e.target.value); setPwErr(null); }}
                  autoComplete="new-password"
                  className="input mt-1.5 !h-11"
                  placeholder={en ? "At least 8 characters" : "至少 8 位"}
                />
              </label>
              <label className="block">
                <span className="label">{en ? "Confirm new password" : "确认新密码"}</span>
                <input
                  type="password"
                  value={newPw2}
                  onChange={(e) => { setNewPw2(e.target.value); setPwErr(null); }}
                  autoComplete="new-password"
                  className="input mt-1.5 !h-11"
                  placeholder={en ? "Repeat it" : "再输入一次"}
                />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {en
                ? "After the change, every other device is signed out. This device stays signed in."
                : "修改后其它设备会全部退出登录，当前设备保持登录。"}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submitPw()}
                disabled={pwBusy}
                className="btn btn-accent !h-8 gap-1.5 px-4 text-xs"
              >
                {pwBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {en ? "Save" : "确认修改"}
              </button>
              <button type="button" onClick={resetPw} className="btn btn-outline !h-8 px-4 text-xs">
                {en ? "Cancel" : "取消"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-foreground">{en ? "Password set" : "已设置密码"}</span>
            <button
              type="button"
              onClick={() => { setPwOpen(true); setPwErr(null); setPwOk(null); }}
              className="btn btn-outline !h-8 px-4 text-xs"
            >
              {en ? "Change password" : "修改密码"}
            </button>
          </div>
        )}

        {pwErr && <p className="mt-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{pwErr}</p>}
        {pwOk && <p className="mt-3 rounded-[8px] bg-accent/10 px-3 py-2 text-xs text-accent" role="status">{pwOk}</p>}
      </div>

      {/* 3) 注销账号（危险操作） */}
      <div className="border-t border-border px-5 py-5 sm:px-7">
        <p className="text-sm font-bold text-foreground">{en ? "Delete account" : "注销账号"}</p>

        {delOpen ? (
          <div className="mt-3 space-y-3">
            <p className="rounded-[8px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive">
              {en
                ? "This permanently deletes your account, profile, posts, follows and submitted products. It cannot be undone."
                : "这会永久删除你的账号、公开资料、帖子、关注关系与已收录的产品，且无法恢复。"}
            </p>
            <label className="block">
              <span className="label">{en ? "Confirm with your password" : "用当前密码确认"}</span>
              <input
                type="password"
                value={delPw}
                onChange={(e) => { setDelPw(e.target.value); setDelErr(null); }}
                autoComplete="current-password"
                className="input mt-1.5 !h-11"
                placeholder="••••••••"
              />
            </label>
            <label className="flex items-start gap-2.5 rounded-[16px] border border-border bg-secondary/40 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={delAck}
                onChange={(e) => { setDelAck(e.target.checked); setDelErr(null); }}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-xs leading-5 text-muted-foreground">
                {en ? "I understand my account and all its content will be erased." : "我已知晓账号及其全部内容都会被清除。"}
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submitDel()}
                disabled={delBusy}
                className="btn !h-8 gap-1.5 bg-destructive px-4 text-xs text-white hover:opacity-90"
              >
                {delBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {en ? "Delete permanently" : "确认注销"}
              </button>
              <button type="button" onClick={resetDel} className="btn btn-outline !h-8 px-4 text-xs">
                {en ? "Cancel" : "取消"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-[11px] text-muted-foreground">
              {en ? "Want to leave SolHub for good?" : "确定要离开 SolHub？"}
            </p>
            <button
              type="button"
              onClick={() => { setDelOpen(true); setDelErr(null); }}
              className="btn btn-outline !h-8 gap-1.5 px-4 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" /> {en ? "Delete account" : "注销账号"}
            </button>
          </div>
        )}

        {delErr && <p className="mt-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{delErr}</p>}
      </div>
    </div>
  );
}
