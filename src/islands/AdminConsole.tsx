import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Ban,
  KeyRound,
  Loader2,
  Package,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { p } from "@/lib/paths";
import GoldBadge from "@/components/GoldBadge";
import {
  adminBan,
  adminDeletePost,
  adminDeleteUser,
  adminPosts,
  adminProducts,
  adminResetPassword,
  adminStats,
  adminUsers,
  adminVerifyProduct,
  adminVerifyUser,
  type AdminPost,
  type AdminProduct,
  type AdminStats,
  type AdminUser,
} from "@/lib/admin";

function Avatar({ name, src }: { name: string; src?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-full border border-border object-cover"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[13px] font-semibold text-muted-foreground">
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

function Tag({ tone, children }: { tone: "accent" | "gold" | "danger" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "gold"
      ? "bg-[#fdf3d3] text-[#9a6b00]"
      : tone === "danger"
        ? "bg-destructive/10 text-destructive"
        : tone === "accent"
          ? "bg-accent/10 text-accent"
          : "bg-secondary text-muted-foreground";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold leading-none ${cls}`}>
      {children}
    </span>
  );
}

export default function AdminConsole({ locale = "zh" }: { locale?: "zh" | "en" }) {
  const [gate, setGate] = useState<"loading" | "unauthorized" | "forbidden" | "ok">("loading");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [tab, setTab] = useState<"users" | "posts" | "products">("users");
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 4000);
  };

  const loadStats = useCallback(async () => {
    const res = await adminStats();
    if (res.status === "unauthorized") return setGate("unauthorized");
    if (res.status === "forbidden") return setGate("forbidden");
    if (res.status !== "ok" || !res.data) {
      setGate("ok");
      setError(res.error || "加载失败");
      return;
    }
    setStats(res.data);
    setGate("ok");
  }, []);

  const loadUsers = useCallback(async (term: string) => {
    setBusy(true);
    const res = await adminUsers(term);
    setBusy(false);
    if (res.status === "ok" && res.data) setUsers(res.data.users);
    else setError(res.error || "加载失败");
  }, []);

  const loadPosts = useCallback(async (term: string) => {
    setBusy(true);
    const res = await adminPosts(term);
    setBusy(false);
    if (res.status === "ok" && res.data) setPosts(res.data.posts);
    else setError(res.error || "加载失败");
  }, []);

  const loadProducts = useCallback(async () => {
    setBusy(true);
    const res = await adminProducts();
    setBusy(false);
    if (res.status === "ok" && res.data) setProducts(res.data.products);
    else setError(res.error || "加载失败");
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (gate !== "ok") return;
    if (tab === "users") void loadUsers(q);
    if (tab === "posts") void loadPosts(q);
    if (tab === "products") void loadProducts();
  }, [gate, tab, q, loadUsers, loadPosts, loadProducts]);

  const run = async (fn: () => Promise<{ status: string; error?: string }>, okMsg: string, after?: () => void) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.status !== "ok") {
      setError(res.error || "操作失败");
      return;
    }
    setError(null);
    flash(okMsg);
    after?.();
  };

  if (gate === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 校验管理员身份…
      </div>
    );
  }

  if (gate !== "ok") {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <ShieldCheck className="mx-auto h-9 w-9 text-muted-foreground/50" />
        <h1 className="mt-4 font-display text-xl font-bold text-foreground">管理后台</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {gate === "unauthorized" ? "请先用管理员账号登录。" : "当前账号没有管理权限。"}
        </p>
        <a href={p("/login/?next=" + encodeURIComponent("/admin/"), locale)} className="btn btn-accent mt-6 inline-flex">
          {gate === "unauthorized" ? "去登录" : "换个账号登录"}
        </a>
      </div>
    );
  }

  const TABS = [
    { key: "users" as const, label: "用户", icon: UserRound },
    { key: "posts" as const, label: "帖子", icon: Search },
    { key: "products" as const, label: "产品", icon: Package },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* 顶部 */}
      <div className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <h1 className="font-display text-xl font-bold text-foreground">管理后台</h1>
          <Tag tone="muted">仅管理员可见</Tag>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
            注册用户 <b className="text-foreground">{stats?.users ?? "-"}</b>
          </span>
          <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
            帖子 <b className="text-foreground">{stats?.posts ?? "-"}</b>
          </span>
          <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
            已封禁 <b className="text-foreground">{stats?.banned ?? "-"}</b>
          </span>
          <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
            我 <b className="text-foreground">{stats?.me ?? "-"}</b>
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-stretch border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); setQ(""); }}
            className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-[13.5px] font-semibold transition-colors ${
              tab === t.key
                ? "border-b-2 border-accent text-foreground"
                : "border-b-2 border-transparent text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* 搜索（帖子/用户） */}
      {tab !== "products" && (
        <div className="py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === "users" ? "搜索昵称 / 邮箱 / 简介" : "搜索帖子正文 / 作者"}
              className="w-full rounded-full border border-border bg-secondary/40 py-2 pl-9 pr-3 text-[14px] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
            />
          </div>
        </div>
      )}

      {error && (
        <div className="my-3 rounded-[8px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="my-3 rounded-[8px] border border-success/30 bg-success/5 px-3 py-2 text-[13px] text-success">
          {notice}
        </div>
      )}

      {/* 用户列表 */}
      {tab === "users" && (
        <ul className="divide-y divide-border border-t border-border">
          {busy && users.length === 0 && (
            <li className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </li>
          )}
          {!busy && users.length === 0 && (
            <li className="py-14 text-center text-sm text-muted-foreground">没有匹配的用户</li>
          )}
          {users.map((u) => (
            <li key={u.login} className="flex items-start gap-3 py-4">
              <Avatar name={u.name} src={u.avatar} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-bold text-foreground">{u.name}</span>
                  {u.verified && <GoldBadge />}
                  {u.isAdmin && <Tag tone="accent">管理员</Tag>}
                  {u.banned && <Tag tone="danger">已封禁</Tag>}
                </div>
                <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {u.login} · {u.type === "email" ? "邮箱账号" : "GitHub"} · 注册 {u.createdAt ? u.createdAt.slice(0, 10) : "未知"} · {u.postCount} 帖
                </div>
                {u.bio && <div className="mt-1 line-clamp-1 text-[13px] text-foreground/70">{u.bio}</div>}
                {u.banned && u.banReason && (
                  <div className="mt-1 text-[12px] text-destructive">封禁原因：{u.banReason}</div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => adminVerifyUser(u.login, !u.verified),
                        u.verified ? `已取消 ${u.name} 的认证` : `已认证 ${u.name}`,
                        () => void loadUsers(q),
                      )
                    }
                    className="btn btn-outline !h-7 gap-1.5 px-3 text-xs"
                  >
                    <BadgeCheck className="h-3.5 w-3.5" /> {u.verified ? "取消黄V" : "加黄V"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || u.isAdmin}
                    onClick={() => {
                      if (u.banned) {
                        void run(() => adminBan(u.login, false), `已解封 ${u.name}`, () => void loadUsers(q));
                        return;
                      }
                      const reason = window.prompt(`封禁 ${u.name} 的原因（可留空）`, "");
                      if (reason === null) return;
                      void run(() => adminBan(u.login, true, reason), `已封禁 ${u.name}`, () => void loadUsers(q));
                    }}
                    className={`btn btn-outline !h-7 gap-1.5 px-3 text-xs ${u.banned ? "text-success" : "text-destructive"}`}
                  >
                    <Ban className="h-3.5 w-3.5" /> {u.banned ? "解封" : "封禁"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || u.type !== "email"}
                    onClick={() => {
                      if (!window.confirm(`重置 ${u.name} 的密码？将生成一个临时密码。`)) return;
                      void (async () => {
                        setBusy(true);
                        const res = await adminResetPassword(u.login);
                        setBusy(false);
                        if (res.status !== "ok" || !res.data) {
                          setError(res.error || "重置失败");
                          return;
                        }
                        flash(`新密码：${res.data.password}（请转告该用户，登录后尽快修改）`);
                      })();
                    }}
                    className="btn btn-outline !h-7 gap-1.5 px-3 text-xs"
                    title={u.type === "email" ? "" : "GitHub 账号不支持改密码"}
                  >
                    <KeyRound className="h-3.5 w-3.5" /> 重置密码
                  </button>
                  <button
                    type="button"
                    disabled={busy || u.isAdmin}
                    onClick={() => {
                      if (!window.confirm(`删除 ${u.name}（${u.login}）？其全部帖子、关注关系会一并清除，不可恢复。`)) return;
                      void run(() => adminDeleteUser(u.login), `已删除 ${u.name}`, () => void loadUsers(q));
                    }}
                    className="btn btn-outline !h-7 gap-1.5 px-3 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 删除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 帖子列表 */}
      {tab === "posts" && (
        <ul className="divide-y divide-border border-t border-border">
          {busy && posts.length === 0 && (
            <li className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </li>
          )}
          {!busy && posts.length === 0 && (
            <li className="py-14 text-center text-sm text-muted-foreground">没有匹配的帖子</li>
          )}
          {posts.map((post) => (
            <li key={post.id} className="flex items-start gap-3 py-4">
              <Avatar name={post.authorName} src={post.authorAvatar} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                  <span className="font-bold text-foreground">{post.authorName}</span>
                  {post.authorVerified && <GoldBadge />}
                  <span className="text-muted-foreground">@{post.author.split("@")[0]}</span>
                  <span className="text-muted-foreground">· {post.createdAt ? post.createdAt.slice(0, 16).replace("T", " ") : ""}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[14px] leading-6 text-foreground/90">{post.text}</p>
                {post.linkUrl && (
                  <a href={post.linkUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-[13px] text-accent hover:underline">
                    {post.linkUrl}
                  </a>
                )}
                <div className="mt-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm("删除这条帖子？不可恢复。")) return;
                      void run(() => adminDeletePost(post.id), "帖子已删除", () => void loadPosts(q));
                    }}
                    className="btn btn-outline !h-7 gap-1.5 px-3 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 删除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 产品列表 */}
      {tab === "products" && (
        <ul className="divide-y divide-border border-t border-border">
          {busy && products.length === 0 && (
            <li className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </li>
          )}
          {products.map((prod) => (
            <li key={prod.slug} className="flex items-start gap-3 py-4">
              {prod.icon ? (
                <img src={prod.icon} alt="" className="h-10 w-10 shrink-0 rounded-[8px] border border-border object-cover" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-border bg-secondary">
                  <Package className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-bold text-foreground">{prod.name}</span>
                  {prod.verified ? <Tag tone="accent">已认证</Tag> : <Tag tone="muted">未认证</Tag>}
                  <Tag tone="muted">{prod.source === "catalog" ? "官方目录" : "用户上传"}</Tag>
                </div>
                <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {prod.slug}
                  {prod.submittedBy ? ` · 提交者 ${prod.submittedBy}` : ""}
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => adminVerifyProduct(prod.slug, !prod.verified),
                        prod.verified ? `已取消 ${prod.name} 的认证` : `已认证 ${prod.name}`,
                        () => void loadProducts(),
                      )
                    }
                    className="btn btn-outline !h-7 gap-1.5 px-3 text-xs"
                  >
                    <BadgeCheck className="h-3.5 w-3.5" /> {prod.verified ? "取消认证" : "认证该产品"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
