import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Camera,
  Check,
  ExternalLink,
  HelpCircle,
  Link as LinkIcon,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  PackagePlus,
  Pencil,
  Share2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  User,
  WifiOff,
} from "lucide-react";
import { p } from "@/lib/paths";
import { request } from "@/lib/net";
import { avatarOf, fetchMeState, logout, resizeImageToDataUrl, saveProfile, type AuthUser } from "@/lib/auth";
import { copyText, ensureHttps } from "@/lib/utils";
import { fetchFollowList, fetchProfile, type FollowUser, type PublicProfile } from "@/lib/world";
import GoldBadge from "@/components/GoldBadge";
import { base } from "@/lib/api-base";
import { skillCategories, skillCategoryName } from "@/data/skills";
import {
  listMySkills,
  ownerKey,
  removeMySkill,
  saveMySkill,
  setMySkillStatus,
  updateMySkill,
  type MySkill,
  type MySkillInput,
} from "@/lib/my-skills";
import type { Locale } from "@/i18n";

const emptySkillForm: MySkillInput = {
  name: "",
  repoUrl: "",
  installCommand: "",
  platform: "",
  shortDescription: "",
  description: "",
  category: "engineering",
  tags: "",
  author: "",
  contact: "",
};

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  created_at: string;
}

interface CommunityProduct {
  slug: string;
  name: string;
  shortDescription?: string;
  description?: string;
  websiteUrl?: string;
  category?: string;
  tags?: string[];
  developerName?: string;
  verificationStatus?: string;
  publishedAt?: string;
  /** true = 来自官方产品目录的认领项（不可在站内改/删） */
  claimed?: boolean;
}

/* ---------- 错误兜底：任何渲染异常都显示可恢复的提示，而不是空白 ---------- */

class PanelErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <div className="py-20 text-center">
          <p className="text-sm font-bold text-foreground">页面出错了</p>
          <p className="mt-2 text-xs text-muted-foreground">{this.state.err.message || "未知错误"}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-outline mt-4 !h-9 px-4 text-xs">
            刷新页面重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function parseBody(body: string | null) {
  if (!body) return {} as Record<string, string>;
  const map: Record<string, string> = {};
  const lines = body.split("\n");
  let currentKey = "";
  let currentVal = "";
  for (const line of lines) {
    const m = line.match(/^\*\*(.+?)\*\*：\s*(.*)$/);
    if (m) {
      if (currentKey) map[currentKey] = currentVal.trim();
      currentKey = m[1].trim();
      currentVal = m[2];
    } else if (currentKey && !line.startsWith("##") && !line.startsWith("---") && !line.startsWith("由 SolHub")) {
      currentVal += "\n" + line;
    }
  }
  if (currentKey) map[currentKey] = currentVal.trim();
  return map;
}

export default function MySubmissionsWithBoundary({ locale = "zh" }: { locale?: Locale }) {
  return (
    <PanelErrorBoundary>
      <MySubmissions locale={locale} />
    </PanelErrorBoundary>
  );
}

function MySubmissions({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [products, setProducts] = useState<CommunityProduct[]>([]);

  /* 资料编辑 */
  const [editingProfile, setEditingProfile] = useState(false);
  const [pf, setPf] = useState({ displayName: "", bio: "", location: "", website: "", avatar: "", handle: "", contact: "", emailPublic: false });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  /* 头部那一行的「公开 / 不公开」快捷开关 */
  const [publicBusy, setPublicBusy] = useState(false);
  const [publicError, setPublicError] = useState<string | null>(null);

  /* 一键分享个人主页链接 */
  const [shared, setShared] = useState(false);
  const shareProfile = async () => {
    if (!user) return;
    const handle = user.handle || user.login || "";
    if (!handle) return;
    /* 短链接 /@<handle>：404 页重定向到独立展示页 /u/?h=，无侧栏、可直接对外展示 */
    const url = `${window.location.origin}${p(`/@${encodeURIComponent(handle)}`)}`;
    const ok = await copyText(url);
    if (ok) {
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } else {
      /* 复制失败（如非安全上下文）则退化为让用户手动复制 */
      window.prompt(en ? "Copy this link:" : "复制下面的主页链接：", url);
    }
  };

  /* 产品管理 */
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", shortDescription: "", description: "", websiteUrl: "", tags: "" });
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /* Skill 管理：提交记录存在本机，支持新增 / 编辑 / 删除 / 标记收录状态 */
  const [mySkills, setMySkills] = useState<MySkill[]>([]);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillForm, setSkillForm] = useState<MySkillInput>(emptySkillForm);
  const [skillError, setSkillError] = useState<string | null>(null);

  /* 创作者：我的产品 / 我的 Skill / 关注 / 粉丝 */
  const [tab, setTab] = useState<"products" | "skills" | "following" | "followers">("products");
  const [world, setWorld] = useState<PublicProfile | null>(null);
  const [followList, setFollowList] = useState<FollowUser[]>([]);
  const [followLoading, setFollowLoading] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      const res = await request(`${base()}/my-products`, { cache: "no-store" }, { retries: 1 });
      if (res.ok) {
        const data = await res.json();
        setProducts(Array.isArray(data?.products) ? data.products : []);
      }
    } catch { /* 忽略，产品区显示空态 */ }
  }, []);

  /* 加载个人主页数据。
     认证服务部署在境外边缘节点，跨境链路抖动会造成偶发超时/丢包，
     这里把「取登录态」与后续请求拆开处理：
       - 登录态取不到（网络失败）→ 置 loadFailed，不能误判成「未登录」；
       - 取到之后，产品 / 帖子 / Issue 三路请求并行发起，
         避免串行叠加把首屏拖到十几秒。 */
  const load = useCallback(async () => {
    try {
      const { user: me, failed, stale } = await fetchMeState();
      setStale(stale);
      if (failed && !me) {
        /* 既没连上、也没有本地缓存 → 无法判断登录态，交给重试入口 */
        setLoadFailed(true);
        setUser(null);
        return;
      }
      setLoadFailed(false);
      setUser(me);
      if (!me) return;
      setPf({
        displayName: me.displayName || "",
        bio: me.bio || "",
        location: me.location || "",
        website: me.website || "",
        avatar: me.avatar || "",
        handle: me.handle || me.login || "",
        contact: me.contact || "",
        emailPublic: !!me.emailPublic,
      });
      await Promise.all([
        loadProducts(),
        fetchProfile(me.login)
          .then((prof) => { if (prof) setWorld(prof); })
          .catch(() => { /* 忽略，关注 / 粉丝区显示空态 */ }),
        me.authType === "github"
          ? request(`${base()}/my-issues`, { cache: "no-store" }, { retries: 1 })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => { if (data) setIssues(data); })
              .catch(() => { /* 忽略 */ })
          : Promise.resolve(),
      ]);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [loadProducts]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 支持 /my-submissions/?tab=skills 直达 Skill 标签 */
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("tab") === "skills") setTab("skills");
    } catch {
      /* 地址栏解析失败时保持默认标签 */
    }
  }, []);

  /* Skill 提交记录按账号读取（含未登录时提交的草稿） */
  useEffect(() => {
    if (!user) return;
    setMySkills(listMySkills(ownerKey(user)));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (tab === "following" || tab === "followers") {
      setFollowLoading(true);
      void fetchFollowList(user.login, tab).then((list) => {
        setFollowList(list);
        setFollowLoading(false);
      });
    }
  }, [tab, user]);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setProfileError(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setPf((v) => ({ ...v, avatar: dataUrl }));
    } catch {
      setProfileError(en ? "Failed to read image." : "图片读取失败，请换一张试试。");
    }
  };

  const saveProfileEdit = async () => {
    setProfileSaving(true);
    setProfileError(null);
    const payload: Record<string, string | boolean> = {
      displayName: pf.displayName,
      bio: pf.bio,
      location: pf.location,
      website: ensureHttps(pf.website),
      /* 联系方式与「公开邮箱」是显式开关，每次保存都同步当前值 */
      contact: pf.contact.trim(),
      emailPublic: pf.emailPublic,
    };
    /* 用户名：仅当改动过才提交，避免空值覆盖 */
    const currentHandle = user?.handle || user?.login || "";
    if (pf.handle.trim() && pf.handle.trim() !== currentHandle) payload.handle = pf.handle.trim();
    /* 只有当用户新选了头像时才提交 avatar 字段 */
    if (pf.avatar !== (user?.avatar || "")) payload.avatar = pf.avatar;
    const result = await saveProfile(payload);
    setProfileSaving(false);
    if (result.ok) {
      setUser((u) => {
        if (!u) return u;
        const next = { ...u, ...(payload as unknown as Partial<AuthUser>) };
        if (typeof payload.handle === "string" && payload.handle) next.login = payload.handle;
        return next;
      });
      setEditingProfile(false);
    } else {
      setProfileError(result.error || "保存失败");
    }
  };

  /**
   * 头部那一行的「公开 / 不公开」快捷开关。
   * 服务端 PUT /profile 是整包覆盖（缺字段会被写成空串），所以这里把当前
   * 表单里的文本字段一起带上，只翻转 emailPublic 这一个值。
   */
  const toggleEmailPublic = async () => {
    if (!user || publicBusy) return;
    const next = !user.emailPublic;
    if (next && !user.emailVerified) {
      setPublicError(en ? "Verify your email first (see Account info)." : "请先完成邮箱验证（在「账号信息」页）。");
      return;
    }
    setPublicBusy(true);
    setPublicError(null);
    const result = await saveProfile({
      displayName: pf.displayName,
      bio: pf.bio,
      location: pf.location,
      website: ensureHttps(pf.website),
      contact: pf.contact.trim(),
      emailPublic: next,
    });
    setPublicBusy(false);
    if (!result.ok) {
      setPublicError(result.error || (en ? "Update failed." : "更新失败。"));
      return;
    }
    setPf((v) => ({ ...v, emailPublic: next }));
    setUser((u) => (u ? { ...u, emailPublic: next } : u));
  };

  const startEdit = (prod: CommunityProduct) => {
    setEditingSlug(prod.slug);
    setActionError(null);
    setEditForm({
      name: prod.name || "",
      shortDescription: prod.shortDescription || "",
      description: prod.description || "",
      websiteUrl: prod.websiteUrl || "",
      tags: (prod.tags || []).join(", "),
    });
  };

  const saveProduct = async (slug: string) => {
    setSavingSlug(slug);
    setActionError(null);
    try {
      const res = await request(`${base()}/my-products/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          shortDescription: editForm.shortDescription.trim(),
          description: editForm.description.trim(),
          websiteUrl: editForm.websiteUrl.trim(),
          tags: editForm.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || `保存失败（${res.status}）`);
        return;
      }
      setProducts((prev) =>
        prev.map((x) =>
          x.slug === slug
            ? { ...x, ...editForm, tags: editForm.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) }
            : x,
        ),
      );
      setEditingSlug(null);
    } catch {
      setActionError(en ? "Network error. Please retry." : "网络错误，请稍后重试。");
    } finally {
      setSavingSlug(null);
    }
  };

  const deleteProduct = async (slug: string) => {
    if (!confirm(en ? "Delete this product? This cannot be undone." : "确定删除这个产品？删除后不可恢复。")) return;
    setSavingSlug(slug);
    setActionError(null);
    try {
      const res = await request(`${base()}/my-products/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      }, { retries: 0 });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || `删除失败（${res.status}）`);
        return;
      }
      setProducts((prev) => prev.filter((x) => x.slug !== slug));
    } catch {
      setActionError(en ? "Network error. Please retry." : "网络错误，请稍后重试。");
    } finally {
      setSavingSlug(null);
    }
  };

  /* ---------------- Skill 提交记录的本地管理 ---------------- */
  const refreshSkills = () => setMySkills(listMySkills(ownerKey(user)));

  const startSkillEdit = (s: MySkill) => {
    setEditingSkillId(s.id);
    setSkillError(null);
    setSkillForm({
      name: s.name,
      repoUrl: s.repoUrl,
      installCommand: s.installCommand,
      platform: s.platform,
      shortDescription: s.shortDescription,
      description: s.description,
      category: s.category,
      tags: s.tags,
      author: s.author,
      contact: s.contact,
    });
  };

  const startNewSkill = () => {
    setEditingSkillId("__new__");
    setSkillError(null);
    setSkillForm({ ...emptySkillForm, author: user?.displayName || user?.login || "" });
  };

  const saveSkill = () => {
    const name = skillForm.name.trim();
    const repoUrl = skillForm.repoUrl.trim();
    if (!name || !repoUrl) {
      setSkillError(en ? "Name and repo URL are required." : "请填写 Skill 名称与仓库 / 主页 URL。");
      return;
    }
    if (!/^https?:\/\//i.test(repoUrl)) {
      setSkillError(en ? "Repo URL must start with http:// or https://." : "仓库 URL 需以 http:// 或 https:// 开头。");
      return;
    }
    const payload: MySkillInput = { ...skillForm, name, repoUrl };
    if (editingSkillId === "__new__") saveMySkill(payload, ownerKey(user));
    else if (editingSkillId) updateMySkill(editingSkillId, payload);
    setEditingSkillId(null);
    setSkillError(null);
    refreshSkills();
  };

  const deleteSkill = (s: MySkill) => {
    if (!confirm(en ? `Delete “${s.name}”? This only removes your local record.` : `确定删除「${s.name}」？仅删除本机的提交记录。`)) return;
    removeMySkill(s.id);
    refreshSkills();
  };

  const toggleSkillStatus = (s: MySkill) => {
    setMySkillStatus(s.id, s.status === "listed" ? "pending" : "listed");
    refreshSkills();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {en ? "Loading…" : "加载中…"}
      </div>
    );
  }

  /* 网络异常：登录状态未知，别误导成「未登录」 */
  if (loadFailed && !user) {
    return (
      <div className="py-20 text-center">
        <WifiOff className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-sm text-muted-foreground">
          {en
            ? "Couldn't reach the auth service — the network link looks unstable."
            : "连不上认证服务，当前网络链路不太稳定。"}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => { setLoading(true); setLoadFailed(false); void load(); }}
            className="btn btn-accent !h-10 px-5"
          >
            {en ? "Retry" : "重试"}
          </button>
          <a href={p("/login/?next=" + encodeURIComponent("/my-submissions/"), locale)} className="btn btn-outline !h-10 px-5">
            {en ? "Log in / Sign up" : "登录 / 注册"}
          </a>
        </div>
      </div>
    );
  }

  /* 未登录：登录引导 */
  if (!user) {
    return (
      <div className="py-20 text-center">
        <LogIn className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-sm text-muted-foreground">
          {en
            ? "Log in with email to view and manage your products and Skills."
            : "登录后即可查看和管理你提交的产品与 Skill。"}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <a href={p("/login/?next=" + encodeURIComponent("/my-submissions/"), locale)} className="btn btn-accent !h-10 px-5">
            {en ? "Log in / Sign up" : "登录 / 注册"}
          </a>
          <a href={p("/submit/", locale)} className="btn btn-outline !h-10 px-5">
            {en ? "Submit a product" : "先去提交一个产品"}
          </a>
        </div>
        {loadFailed && (
          <p className="mt-4 text-xs text-destructive">
            {en ? "Network error, data may be stale. Try refreshing." : "网络异常，数据可能不完整，可尝试刷新。"}
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          {en
            ? "Email + password sign-in. Your session is stored in a secure cookie."
            : "使用邮箱 + 密码登录；会话保存在安全的 Cookie 中。"}
        </p>
      </div>
    );
  }

  const isGithub = user.authType === "github";
  const avatar = avatarOf(user);

  return (
    <div className="pb-10">
      {stale && (
        <p className="mb-3 flex items-center gap-1.5 rounded-[8px] bg-secondary px-3 py-2 text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {en
            ? "Network is unstable right now — showing your last known data."
            : "当前网络不稳定，以下为你上次同步的数据。"}
        </p>
      )}
      {/* ---------- X 风格个人主页头部 ---------- */}
      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        {/* 封面条 */}
        <div className="h-28 bg-gradient-to-r from-accent/25 via-accent/10 to-transparent sm:h-36" aria-hidden="true" />

        {!editingProfile ? (
          <div className="px-5 pb-5 sm:px-7 sm:pb-6">
            <div className="-mt-10 flex items-end justify-between sm:-mt-12">
              {avatar ? (
                <img src={avatar} alt="" className="h-20 w-20 rounded-full border-4 border-card bg-card object-cover sm:h-24 sm:w-24" />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-card bg-secondary sm:h-24 sm:w-24">
                  <User className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
                </span>
              )}
              {/* 窄屏用 flex-wrap + 短文案 + 收窄 padding：三个按钮放不下时换行而不是被裁掉 */}
              <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => void shareProfile()}
                  title={en ? "Copy your profile link" : "复制你的主页分享链接"}
                  className="btn btn-outline !h-8 gap-1.5 px-3 text-xs sm:px-4"
                >
                  {shared ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
                  <span className="sm:hidden">{shared ? (en ? "Copied" : "已复制") : (en ? "Share" : "分享")}</span>
                  <span className="hidden sm:inline">{shared ? (en ? "Copied" : "已复制") : (en ? "Share" : "分享主页")}</span>
                </button>
                <button onClick={() => { setEditingProfile(true); setProfileError(null); }} className="btn btn-outline !h-8 gap-1.5 px-3 text-xs sm:px-4">
                  <Pencil className="h-3 w-3" />
                  <span className="sm:hidden">{en ? "Edit" : "编辑"}</span>
                  <span className="hidden sm:inline">{en ? "Edit profile" : "编辑资料"}</span>
                </button>
                <button
                  onClick={() => { void logout().then(() => window.location.reload()); }}
                  className="btn btn-outline !h-8 gap-1.5 px-3 text-xs text-muted-foreground hover:text-destructive sm:px-4"
                >
                  <LogOut className="h-3 w-3" />
                  <span className="sm:hidden">{en ? "Log out" : "退出"}</span>
                  <span className="hidden sm:inline">{en ? "Log out" : "退出登录"}</span>
                </button>
              </div>
            </div>

            <div className="mt-3">
              <h1 className="flex flex-wrap items-center gap-1.5 font-display text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
                {user.displayName || (isGithub ? user.login : (en ? "Anonymous creator" : "匿名创作者"))}
                {/* 黄V：与公开主页（/world/?u=）口径一致，读公开资料里的 verified */}
                {world?.user.verified && <GoldBadge className="h-[18px] w-[18px] shrink-0" />}
              </h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                <a
                  href={p(`/world/?u=${encodeURIComponent(user.handle || user.login)}`, locale)}
                  className="font-medium text-accent hover:underline"
                >
                  @{user.handle || user.login}
                </a>
                {!isGithub && user.email && (
                  <span className="inline-flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground/80">
                    · {user.emailPublic
                      ? (en ? "public email" : "公开邮箱")
                      : (en ? "sign-in email (private)" : "登录邮箱（不公开）")}
                    <span>{user.email}</span>
                    <button
                      type="button"
                      onClick={() => void toggleEmailPublic()}
                      disabled={publicBusy || (!user.emailVerified && !user.emailPublic)}
                      title={
                        !user.emailVerified && !user.emailPublic
                          ? (en ? "Verify your email first" : "请先完成邮箱验证")
                          : (user.emailPublic
                              ? (en ? "Make this email private" : "把这个邮箱设为不公开")
                              : (en ? "Publish this email on your profile" : "把这个邮箱公开到主页上"))
                      }
                      className="rounded-[4px] px-1 py-px text-accent transition-colors hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground/60 disabled:no-underline"
                    >
                      {publicBusy
                        ? "…"
                        : user.emailPublic
                          ? (en ? "make private" : "设为不公开")
                          : (en ? "publish" : "公开")}
                    </button>
                  </span>
                )}
                {publicError && (
                  <span className="text-[11px] text-destructive">{publicError}</span>
                )}
              </p>
              {user.bio && <p className="mt-2 text-sm leading-6 text-foreground/80">{user.bio}</p>}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {user.location && (
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{user.location}</span>
                )}
                {user.website && (
                  <a href={ensureHttps(user.website)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    <LinkIcon className="h-3 w-3" />{user.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {user.contact && (
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" />{user.contact}
                  </span>
                )}
                {user.emailPublic && user.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />{user.email}
                    {user.emailVerified && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
                        <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                        {en ? "Verified" : "已验证"}
                      </span>
                    )}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <PackagePlus className="h-3 w-3" />
                  {en ? `${products.length} product${products.length === 1 ? "" : "s"}` : `${products.length} 个产品`}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  {en ? `${mySkills.length} Skill${mySkills.length === 1 ? "" : "s"}` : `${mySkills.length} 个 Skill`}
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* 编辑资料 */
          <div className="space-y-4 border-t border-border px-5 py-5 sm:px-7">
            <p className="text-sm font-bold text-foreground">{en ? "Edit profile" : "编辑资料"}</p>
            <div className="flex items-center gap-4">
              {pf.avatar ? (
                <img src={pf.avatar} alt="" className="h-16 w-16 rounded-full border border-border object-cover" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-secondary">
                  <User className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                </span>
              )}
              <label className="btn btn-outline cursor-pointer !h-8 gap-1.5 px-4 text-xs">
                <Camera className="h-3.5 w-3.5" />
                {en ? "Change avatar" : "更换头像"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void pickAvatar(e.target.files?.[0])}
                />
              </label>
              {pf.avatar !== (user.avatar || "") && (
                <button
                  type="button"
                  onClick={() => setPf((v) => ({ ...v, avatar: user.avatar || "" }))}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {en ? "Reset" : "还原"}
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {en ? "Square image recommended; auto-cropped to 192×192." : "建议用正方形图片，会自动居中裁剪为 192×192。"}
            </p>
            <label className="block">
              <span className="label">{en ? "Username" : "用户名"}</span>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-sm text-muted-foreground">@</span>
                <input
                  value={pf.handle}
                  onChange={(e) => setPf({ ...pf, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                  className="input w-full"
                  maxLength={20}
                  placeholder="yourname"
                  disabled={isGithub}
                />
              </div>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {isGithub
                  ? (en ? "GitHub accounts use the GitHub username." : "GitHub 账号使用 GitHub 用户名。")
                  : (en
                      ? "Your public page: solhub.solyoung.top/@username. 3–20 chars, letters/digits/underscore; changing it also renames your past posts."
                      : "公开主页地址里的名字：/@用户名。3–20 位字母数字下划线；修改后历史帖子会一起改名。")}
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={pf.displayName} onChange={(e) => setPf({ ...pf, displayName: e.target.value })} className="input w-full" maxLength={40} placeholder={en ? "Display name" : "昵称"} />
              <input value={pf.location} onChange={(e) => setPf({ ...pf, location: e.target.value })} className="input w-full" maxLength={40} placeholder={en ? "City" : "所在城市"} />
            </div>
            <textarea value={pf.bio} onChange={(e) => setPf({ ...pf, bio: e.target.value })} rows={2} maxLength={200} className="input w-full resize-y" placeholder={en ? "Short bio" : "个人简介"} />
            <input value={pf.website} onChange={(e) => setPf({ ...pf, website: e.target.value })} className="input w-full" placeholder={en ? "Website (https://…)" : "个人网站（https://…）"} />
            <div>
              <input
                value={pf.contact}
                onChange={(e) => setPf({ ...pf, contact: e.target.value })}
                className="input w-full"
                maxLength={200}
                placeholder={en ? "Contact (WeChat / Telegram / another email — optional)" : "联系方式（微信 / Telegram / 备用邮箱，可留空）"}
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {en
                  ? "Shown on your public profile so people can reach you. Leave it empty to stay invisible."
                  : "会显示在你的公开主页上，方便别人联系你；留空即不展示。"}
              </span>
            </div>
            {!isGithub && (
              <label className={`flex items-start gap-2.5 rounded-[16px] border border-border bg-secondary/40 px-3 py-2.5 ${user.emailVerified ? "cursor-pointer" : "opacity-60"}`}>
                <input
                  type="checkbox"
                  checked={pf.emailPublic}
                  disabled={!user.emailVerified}
                  onChange={(e) => setPf({ ...pf, emailPublic: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-xs leading-5 text-muted-foreground">
                  {en ? "Show my registered email on my public profile" : "在公开主页上展示我的注册邮箱"}
                  <span className="mt-0.5 block text-[11px] opacity-80">
                    {user.emailVerified
                      ? (en
                          ? "Off by default. When on, the email appears on your profile page only — never in search results, posts or comments."
                          : "默认关闭。开启后邮箱只出现在你的主页上，不会出现在搜索结果、帖子或评论里。")
                      : (en
                          ? "Verify your email first (see Account info), then you can publish it with a Verified badge."
                          : "需要先完成邮箱验证（在「账号信息」页），验证后即可公开，并显示「已验证」标识。")}
                  </span>
                </span>
              </label>
            )}
            {profileError && (
              <p className="rounded-[8px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{profileError}</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => void saveProfileEdit()} disabled={profileSaving} className="btn btn-accent !h-8 gap-1.5 px-4 text-xs">
                {profileSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {en ? "Save" : "保存"}
              </button>
              <button onClick={() => { setEditingProfile(false); setProfileError(null); }} className="btn btn-outline !h-8 px-4 text-xs">
                {en ? "Cancel" : "取消"}
              </button>
            </div>
          </div>
        )}

        {/* 公开资料卡（名片）：编辑、公开邮箱开关等都在这里；
            账号安全（邮箱安全 / 改密码 / 注销）已独立到 /account/ 页面。 */}
      </div>

      {/* ---------- 内容 Tab：产品 / 帖子 / 关注 / 粉丝 ---------- */}
      <div className="mt-8 flex items-center gap-1 overflow-x-auto border-b border-border">
        {([
          { key: "products", label: en ? "Products" : "产品", count: products.length },
          { key: "skills", label: en ? "Skills" : "Skill", count: mySkills.length },
          { key: "following", label: en ? "Following" : "关注", count: world?.followingCount ?? 0 },
          { key: "followers", label: en ? "Followers" : "粉丝", count: world?.followerCount ?? 0 },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === t.key ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            <span className="ml-1 text-[11px] text-muted-foreground">{t.count}</span>
          </button>
        ))}
        <a href={p("/world/", locale)} className="ml-auto shrink-0 px-2 text-[12px] text-accent hover:underline">
          {en ? "Open Creators →" : "进入创作者 →"}
        </a>
      </div>

      {actionError && (
        <p className="mt-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{actionError}</p>
      )}

      {/* 产品 */}
      {tab === "products" && (
        <>
      <div className="mt-5 flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-foreground">
          {en ? "My products" : "我的产品"}
        </h2>
        <a href={p("/submit/", locale)} className="btn btn-outline !h-8 gap-1.5 px-4 text-xs">
          <PackagePlus className="h-3 w-3" /> {en ? "New submission" : "提交新产品"}
        </a>
      </div>
      {products.length === 0 ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-border bg-secondary/30 py-14 text-center">
          <PackagePlus className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground/70">{en ? "No products yet" : "暂无提交的产品"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {en
              ? "Submit your product with an accessible link — it goes live instantly."
              : "去提交产品吧：官网链接可正常打开即可自动收录上线。"}
          </p>
          <a href={p("/submit/", locale)} className="btn btn-accent mt-4 !h-9 px-5 text-xs">
            {en ? "Submit a product" : "去提交产品"}
          </a>
        </div>
      ) : (
        <ul className="mt-4 grid gap-4">
          {products.map((prod) => {
            const editingThis = editingSlug === prod.slug;
            if (editingThis) {
              return (
                <li key={prod.slug} className="card space-y-3 p-5">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input w-full" placeholder={en ? "Name" : "名称"} maxLength={80} />
                  <input value={editForm.websiteUrl} onChange={(e) => setEditForm({ ...editForm, websiteUrl: e.target.value })} className="input w-full font-mono !text-[13px]" placeholder="https://example.com" />
                  <input value={editForm.shortDescription} onChange={(e) => setEditForm({ ...editForm, shortDescription: e.target.value })} className="input w-full" placeholder={en ? "One-line description" : "一句话介绍"} maxLength={120} />
                  <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={4} className="input w-full resize-y" placeholder={en ? "Detailed description" : "详细描述"} maxLength={500} />
                  <input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} className="input w-full" placeholder={en ? "Tags, comma-separated" : "标签，逗号分隔"} />
                  <p className="text-[11px] text-muted-foreground">
                    {en ? "If the website URL is changed, it must open correctly before saving." : "修改官网链接时，新链接必须可正常打开才能保存。"}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => void saveProduct(prod.slug)} disabled={savingSlug === prod.slug} className="btn btn-accent !h-8 gap-1.5 px-4 text-xs">
                      {savingSlug === prod.slug ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      {en ? "Save" : "保存"}
                    </button>
                    <button onClick={() => setEditingSlug(null)} className="btn btn-outline !h-8 px-4 text-xs">
                      {en ? "Cancel" : "取消"}
                    </button>
                  </div>
                </li>
              );
            }
            return (
              <li key={prod.slug} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a href={ensureHttps(prod.websiteUrl || "")} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-bold text-foreground hover:text-accent">
                        {prod.name}
                      </a>
                      <span
                        className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${
                          prod.verificationStatus === "verified"
                            ? "bg-success/10 text-success"
                            : "bg-warning/10 text-warning"
                        }`}
                      >
                        {prod.verificationStatus === "verified" ? (en ? "Live" : "已上线") : (en ? "Pending" : "待核验")}
                      </span>
                    </div>
                    {prod.shortDescription && (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{prod.shortDescription}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {prod.websiteUrl && (
                        <a href={ensureHttps(prod.websiteUrl)} target="_blank" rel="noopener noreferrer" className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                          {en ? "Visit" : "访问"} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {prod.claimed ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                          {en ? "From official catalog" : "来自官方目录"}
                        </span>
                      ) : (
                        <>
                          <button onClick={() => startEdit(prod)} className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                            <Pencil className="h-3 w-3" /> {en ? "Edit" : "编辑"}
                          </button>
                          <button
                            onClick={() => void deleteProduct(prod.slug)}
                            className="btn btn-outline !h-7 gap-1.5 px-3 text-xs text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3 w-3" /> {en ? "Delete" : "删除"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
        </>
      )}

      {/* 我的 Skill：提交记录的查看 / 编辑 / 删除 / 状态标记 */}
      {tab === "skills" && (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-foreground">
              {en ? "My Skills" : "我的 Skill"}
            </h2>
            <div className="flex flex-wrap gap-2">
              <a href={p("/skills/?guide=1", locale)} className="btn btn-outline !h-8 gap-1.5 px-3 text-xs">
                <HelpCircle className="h-3 w-3" /> {en ? "How to use" : "使用教程"}
              </a>
              <button type="button" onClick={startNewSkill} className="btn btn-outline !h-8 gap-1.5 px-3 text-xs">
                <PackagePlus className="h-3 w-3" /> {en ? "Add a record" : "手动登记"}
              </button>
              <a href={p("/submit/?type=skill", locale)} className="btn btn-accent !h-8 gap-1.5 px-3 text-xs">
                <Sparkles className="h-3 w-3" /> {en ? "Submit a Skill" : "提交 Skill"}
              </a>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            {en
              ? "Skill submissions go through email review, so these records are stored in this browser rather than in the cloud. Edit, delete or mark them as listed here; clearing browser data will remove them."
              : "Skill 提交走邮件人工核验，因此这些记录保存在当前浏览器，不是云端同步。可在此编辑、删除或标记为「已收录」；清除浏览器数据会一并清空。"}
          </p>
          {skillError && (
            <p className="mt-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{skillError}</p>
          )}

          {editingSkillId === "__new__" && (
            <div className="card mt-4 space-y-3 p-5">
              <p className="text-sm font-bold text-foreground">
                {en ? "Add a Skill submission" : "手动登记一条 Skill 提交"}
              </p>
              <SkillFormFields form={skillForm} onChange={setSkillForm} en={en} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveSkill} className="btn btn-accent !h-8 gap-1.5 px-4 text-xs">
                  <Check className="h-3 w-3" /> {en ? "Save" : "保存"}
                </button>
                <button type="button" onClick={() => { setEditingSkillId(null); setSkillError(null); }} className="btn btn-outline !h-8 px-4 text-xs">
                  {en ? "Cancel" : "取消"}
                </button>
              </div>
            </div>
          )}

          {mySkills.length === 0 && editingSkillId !== "__new__" ? (
            <div className="mt-4 rounded-[16px] border border-dashed border-border bg-secondary/30 py-14 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground/70">{en ? "No Skill submissions yet" : "暂无提交的 Skill"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {en
                  ? "Submit a Skill and it will show up here so you can edit or delete it."
                  : "提交 Skill 后会自动出现在这里，可随时编辑或删除。"}
              </p>
              <a href={p("/submit/?type=skill", locale)} className="btn btn-accent mt-4 !h-9 px-5 text-xs">
                {en ? "Submit a Skill" : "去提交 Skill"}
              </a>
            </div>
          ) : (
            mySkills.length > 0 && (
              <ul className="mt-4 grid gap-4">
                {mySkills.map((s) => {
                  if (editingSkillId === s.id) {
                    return (
                      <li key={s.id} className="card space-y-3 p-5">
                        <p className="text-sm font-bold text-foreground">
                          {en ? `Edit “${s.name}”` : `编辑「${s.name}」`}
                        </p>
                        <SkillFormFields form={skillForm} onChange={setSkillForm} en={en} />
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={saveSkill} className="btn btn-accent !h-8 gap-1.5 px-4 text-xs">
                            <Check className="h-3 w-3" /> {en ? "Save" : "保存"}
                          </button>
                          <button type="button" onClick={() => { setEditingSkillId(null); setSkillError(null); }} className="btn btn-outline !h-8 px-4 text-xs">
                            {en ? "Cancel" : "取消"}
                          </button>
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={s.id} className="card p-5">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <a
                            href={ensureHttps(s.repoUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 max-w-full truncate text-sm font-bold text-foreground hover:text-accent"
                          >
                            {s.name}
                          </a>
                          <span
                            className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${
                              s.status === "listed" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                            }`}
                          >
                            {s.status === "listed" ? (en ? "Listed" : "已收录") : (en ? "Pending" : "待核验")}
                          </span>
                          <span className="shrink-0 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {skillCategoryName(s.category, en ? "en" : "zh")}
                          </span>
                        </div>
                        {s.shortDescription && (
                          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{s.shortDescription}</p>
                        )}
                        {s.description && (
                          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground/80">{s.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {s.platform && <span>{en ? "Works with" : "兼容"}：{s.platform}</span>}
                          {s.tags && <span>{en ? "Tags" : "标签"}：{s.tags}</span>}
                          {s.author && <span>{en ? "Author" : "作者"}：{s.author}</span>}
                        </div>
                        {s.installCommand && (
                          <div className="mt-3 flex min-w-0 items-center gap-2 rounded-[7px] border border-border bg-secondary/40 px-2.5 py-1.5">
                            <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">{s.installCommand}</code>
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <a href={ensureHttps(s.repoUrl)} target="_blank" rel="noopener noreferrer" className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                            {en ? "Repo" : "仓库"} <ExternalLink className="h-3 w-3" />
                          </a>
                          <a href={p(`/skills/?q=${encodeURIComponent(s.name)}`, locale)} className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                            <Sparkles className="h-3 w-3" /> {en ? "In Skill library" : "在 Skill 库查看"}
                          </a>
                          <button type="button" onClick={() => startSkillEdit(s)} className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                            <Pencil className="h-3 w-3" /> {en ? "Edit" : "编辑"}
                          </button>
                          <button type="button" onClick={() => toggleSkillStatus(s)} className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                            <Check className="h-3 w-3" />
                            {s.status === "listed" ? (en ? "Mark pending" : "设为待核验") : (en ? "Mark listed" : "标记已收录")}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSkill(s)}
                            className="btn btn-outline !h-7 gap-1.5 px-3 text-xs text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3 w-3" /> {en ? "Delete" : "删除"}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </>
      )}

      {/* 关注 / 粉丝 */}
      {(tab === "following" || tab === "followers") && (
        <div className="mt-5">
          <h2 className="font-display text-base font-bold text-foreground">
            {tab === "following" ? (en ? "Following" : "我关注的人") : (en ? "Followers" : "关注我的人")}
          </h2>
          {followLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {en ? "Loading…" : "加载中…"}
            </div>
          ) : followList.length === 0 ? (
            <div className="mt-4 rounded-[16px] border border-dashed border-border bg-secondary/30 py-14 text-center">
              <p className="text-sm font-medium text-foreground/70">
                {tab === "following"
                  ? (en ? "You're not following anyone yet" : "还没有关注任何人")
                  : (en ? "No followers yet" : "还没有粉丝")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tab === "following"
                  ? (en ? "Find creators in the directory and follow them." : "去「创作者」里找到感兴趣的人，点关注即可。")
                  : (en ? "Submit a product to get discovered." : "提交作品，会有人找到你。")}
              </p>
              <a href={p("/world/", locale)} className="btn btn-outline mt-4 !h-9 px-5 text-xs">
                {en ? "Explore creators" : "逛逛创作者"}
              </a>
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {followList.map((u) => (
                <li key={u.login} className="flex items-center gap-3 rounded-[16px] border border-border bg-card px-4 py-3">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" className="h-9 w-9 rounded-full border border-border object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary font-display text-[13px] font-bold uppercase text-foreground">
                      {(u.name || u.login).slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-foreground">{u.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">@{u.login}</p>
                  </div>
                  <a href={p(`/world/?u=${encodeURIComponent(u.login)}`, locale)} className="btn btn-outline !h-7 shrink-0 px-3 text-[11px]">
                    {en ? "View" : "查看"}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* GitHub Issue 投稿记录（仅 GitHub 登录） */}
      {isGithub && (
        <>
          <h2 className="mt-10 font-display text-base font-bold text-foreground">
            {en ? "Issue submissions" : "Issue 投稿记录"}
          </h2>
          {issues.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {en ? "No GitHub issue submissions." : "还没有通过 GitHub Issue 投稿的记录。"}
            </p>
          ) : (
            <ul className="mt-4 grid gap-4">
              {issues.map((issue) => {
                const f = parseBody(issue.body);
                const name = f["产品提交"] || issue.title.replace(/^\[SolHub\]\s*产品提交：/, "");
                return (
                  <li key={issue.number} className="card p-5">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-bold text-foreground">{name}</h3>
                      <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${issue.state === "open" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                        {issue.state === "open" ? (en ? "Open" : "公开") : (en ? "Closed" : "已关闭")}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                      {f["一句话介绍"] || f["详细描述"] || ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !h-7 px-3 text-xs">
                        GitHub <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** 新增 / 编辑 Skill 提交记录时共用的表单字段 */
function SkillFormFields({
  form, onChange, en,
}: {
  form: MySkillInput;
  onChange: (next: MySkillInput) => void;
  en: boolean;
}) {
  const set = (key: keyof MySkillInput, value: string) => onChange({ ...form, [key]: value });
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={form.name} onChange={(e) => set("name", e.target.value)} className="input w-full" maxLength={80} placeholder={en ? "Skill name" : "Skill 名称"} />
        <input value={form.repoUrl} onChange={(e) => set("repoUrl", e.target.value)} className="input w-full font-mono !text-[13px]" placeholder="https://github.com/owner/repo" />
      </div>
      <input value={form.installCommand} onChange={(e) => set("installCommand", e.target.value)} className="input w-full font-mono !text-[13px]" maxLength={200} placeholder={en ? "Install command (npx skills add …)" : "安装命令（npx skills add …）"} />
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={form.platform} onChange={(e) => set("platform", e.target.value)} className="input w-full" maxLength={120} placeholder={en ? "Compatible agents" : "兼容平台"} />
        <select
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          className="input w-full cursor-pointer !py-0"
          aria-label={en ? "Skill category" : "Skill 分类"}
        >
          {skillCategories.map((c) => (
            <option key={c.slug} value={c.slug}>{en ? c.nameEn : c.name}</option>
          ))}
        </select>
      </div>
      <input value={form.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} className="input w-full" maxLength={200} placeholder={en ? "One-line description" : "一句话介绍"} />
      <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} className="input w-full resize-y" maxLength={2000} placeholder={en ? "Trigger scenarios & details" : "触发场景与详细描述"} />
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={form.tags} onChange={(e) => set("tags", e.target.value)} className="input w-full" placeholder={en ? "Tags, comma-separated" : "标签，逗号分隔"} />
        <input value={form.author} onChange={(e) => set("author", e.target.value)} className="input w-full" maxLength={80} placeholder={en ? "Author / team" : "作者 / 团队"} />
      </div>
      <input value={form.contact} onChange={(e) => set("contact", e.target.value)} className="input w-full" maxLength={200} placeholder={en ? "Contact (optional)" : "联系方式（可选）"} />
    </div>
  );
}
