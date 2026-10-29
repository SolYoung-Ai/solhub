import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  LogIn,
  MapPin,
  Pencil,
  Trash2,
  User,
} from "lucide-react";
import { p } from "@/lib/paths";
import { fetchMe, logout, saveProfile, type AuthUser } from "@/lib/auth";
import type { Locale } from "@/i18n";

const apiBase =
  (import.meta.env.PUBLIC_SOLHUB_API as string | undefined) ||
  "https://solhub-auth.solyoung.top";

function base(): string {
  return apiBase.replace(/\/$/, "");
}

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

export default function MySubmissions({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [products, setProducts] = useState<CommunityProduct[]>([]);

  /* 资料编辑 */
  const [editingProfile, setEditingProfile] = useState(false);
  const [pf, setPf] = useState({ displayName: "", bio: "", location: "", website: "" });
  const [profileSaving, setProfileSaving] = useState(false);

  /* 产品管理 */
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", shortDescription: "", description: "", websiteUrl: "", tags: "" });
  const [savingSlug, setSavingSlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch(`${base()}/my-products`, { credentials: "include", cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setProducts(Array.isArray(data?.products) ? data.products : []);
      }
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      setUser(me);
      setLoading(false);
      if (!me) return;
      setPf({
        displayName: me.displayName || "",
        bio: me.bio || "",
        location: me.location || "",
        website: me.website || "",
      });
      if (me.authType === "github") {
        try {
          const res = await fetch(`${base()}/my-issues`, { credentials: "include", cache: "no-store" });
          if (res.ok) setIssues(await res.json());
        } catch { /* 忽略 */ }
      }
      await loadProducts();
    })();
  }, [loadProducts]);

  const saveProfileEdit = async () => {
    setProfileSaving(true);
    const result = await saveProfile(pf);
    setProfileSaving(false);
    if (result.ok) {
      setUser((u) => (u ? { ...u, ...pf } : u));
      setEditingProfile(false);
    }
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
      const res = await fetch(`${base()}/my-products/${encodeURIComponent(slug)}`, {
        method: "PUT",
        credentials: "include",
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
      const res = await fetch(`${base()}/my-products/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        credentials: "include",
      });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {en ? "Loading…" : "加载中…"}
      </div>
    );
  }

  /* 未登录：登录引导（邮箱注册 / 登录） */
  if (!user) {
    return (
      <div className="py-20 text-center">
        <LogIn className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-sm text-muted-foreground">
          {en
            ? "Log in with email to view and manage your submissions."
            : "登录后即可查看和管理你提交的产品与工具。"}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <a href={p("/login/?next=" + encodeURIComponent("/my-submissions/"), locale)} className="btn btn-accent !h-10 px-5">
            {en ? "Log in / Sign up" : "登录 / 注册"}
          </a>
          <a href={p("/submit/", locale)} className="btn btn-outline !h-10 px-5">
            {en ? "Submit a product" : "先去提交一个产品"}
          </a>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {en
            ? "Email + password sign-in. Your session is stored in a secure cookie."
            : "使用邮箱 + 密码登录；会话保存在安全的 Cookie 中。"}
        </p>
      </div>
    );
  }

  const isGithub = user.authType === "github";

  return (
    <div className="py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {en ? "My account" : "个人中心"}
      </h1>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {en
            ? "Manage your profile and everything you've submitted to SolHub."
            : "管理你的个人资料与提交到 SolHub 的全部内容。"}
        </p>
        <button
          onClick={() => { void logout().then(() => window.location.reload()); }}
          className="btn btn-outline !h-8 px-4 text-xs text-muted-foreground hover:text-destructive"
        >
          {en ? "Log out" : "退出登录"}
        </button>
      </div>

      {/* 个人资料卡 */}
      <div className="card mt-6 p-5">
        {!editingProfile ? (
          <div className="flex items-start gap-4">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-14 w-14 rounded-full border border-border" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-secondary">
                <User className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-bold text-foreground">
                  {user.displayName || (isGithub ? user.login : (en ? "Anonymous creator" : "匿名创作者"))}
                </h2>
                <span className="truncate text-xs text-muted-foreground">
                  {isGithub ? `@${user.login}` : user.email}
                </span>
                {!isGithub && (
                  <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {en ? "Email" : "邮箱账号"}
                  </span>
                )}
              </div>
              {user.bio && <p className="mt-1 text-sm text-foreground/70">{user.bio}</p>}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {user.location && (
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{user.location}</span>
                )}
                {user.website && (
                  <a href={user.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    <LinkIcon className="h-3 w-3" />{user.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {!isGithub && (
                  <span className="inline-flex items-center gap-1">
                    {en ? "Linked with GitHub:" : "GitHub 关联投稿："}
                    <a
                      href={`https://github.com/SolYoung-Ai/solhub/issues?q=is%3Aissue+author%3A${encodeURIComponent(user.login.split("@")[0])}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      GitHub <ExternalLink className="inline h-3 w-3" />
                    </a>
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => setEditingProfile(true)} className="btn btn-outline !h-8 shrink-0 gap-1.5 px-4 text-xs">
              <Pencil className="h-3 w-3" /> {en ? "Edit" : "编辑"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="h-12 w-12 rounded-full border border-border" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary">
                  <User className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                </span>
              )}
              <span className="truncate text-xs text-muted-foreground">{isGithub ? `@${user.login}` : user.email}</span>
            </div>
            <input value={pf.displayName} onChange={(e) => setPf({ ...pf, displayName: e.target.value })} className="input w-full" placeholder={en ? "Display name" : "昵称"} />
            <textarea value={pf.bio} onChange={(e) => setPf({ ...pf, bio: e.target.value })} rows={2} className="input w-full resize-y" placeholder={en ? "Short bio" : "个人简介"} />
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={pf.location} onChange={(e) => setPf({ ...pf, location: e.target.value })} className="input w-full" placeholder={en ? "City" : "所在城市"} />
              <input value={pf.website} onChange={(e) => setPf({ ...pf, website: e.target.value })} className="input w-full" placeholder={en ? "Website" : "个人网站"} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => void saveProfileEdit()} disabled={profileSaving} className="btn btn-accent !h-8 gap-1.5 px-4 text-xs">
                {profileSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {en ? "Save" : "保存"}
              </button>
              <button onClick={() => setEditingProfile(false)} className="btn btn-outline !h-8 px-4 text-xs">
                {en ? "Cancel" : "取消"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 已收录产品（可管理） */}
      <h2 className="mt-10 font-display text-base font-bold text-foreground">
        {en ? "My published products" : "我的收录产品"}
      </h2>
      {actionError && (
        <p className="mt-3 rounded-[3px] bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{actionError}</p>
      )}
      {products.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {en
            ? "No products yet. Submit from the Submit page and they'll show up here."
            : "还没有收录的产品。去「提交产品」页面提交，收录后会显示在这里，并可随时编辑或删除。"}
        </p>
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
                      <a href={p(`/products/${prod.slug}/`, locale)} className="truncate text-sm font-bold text-foreground hover:text-accent">
                        {prod.name}
                      </a>
                      <span
                        className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${
                          prod.verificationStatus === "verified"
                            ? "bg-success/10 text-success"
                            : "bg-warning/10 text-warning"
                        }`}
                      >
                        {prod.verificationStatus === "verified" ? (en ? "Verified" : "已核验") : (en ? "Pending" : "待核验")}
                      </span>
                    </div>
                    {prod.shortDescription && (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{prod.shortDescription}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {prod.websiteUrl && (
                        <a href={prod.websiteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                          {en ? "Visit" : "访问"} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <button onClick={() => startEdit(prod)} className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                        <Pencil className="h-3 w-3" /> {en ? "Edit" : "编辑"}
                      </button>
                      <button
                        onClick={() => void deleteProduct(prod.slug)}
                        className="btn btn-outline !h-7 gap-1.5 px-3 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" /> {en ? "Delete" : "删除"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
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
