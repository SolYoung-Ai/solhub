import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ExternalLink,
  Globe2,
  Pencil,
  Heart,
  Link2,
  Loader2,
  LogIn,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Search,
  Send,
  Share,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { p } from "@/lib/paths";
import GoldBadge from "@/components/GoldBadge";
import VerifiedBadge from "@/components/VerifiedBadge";
import { avatarOf, fetchMe, type AuthUser } from "@/lib/auth";
import { copyText, ensureHttps } from "@/lib/utils";
import {
  addComment,
  createPost,
  deletePost,
  fetchComments,
  fetchFeed,
  fetchProfile,
  hostOf,
  searchWorld,
  timeAgo,
  toggleFollow,
  toggleLike,
  isOfficial,
  type PublicProfile,
  type SearchUser,
  type WorldComment,
  type WorldPost,
} from "@/lib/world";
import type { Locale } from "@/i18n";

const MAX = 500;

function linkify(text: string): React.ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all">
          {part.replace(/^https?:\/\//, "")}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/* 公开标识就是 handle；历史数据里若仍是邮箱形态，只展示 @ 前缀，避免泄露邮箱 */
function cleanHandle(login: string): string {
  if (login.includes("@")) return login.split("@")[0];
  return login;
}

/* ---------------- 头像 ---------------- */
function Avatar({
  name,
  src,
  className = "h-10 w-10 text-[15px]",
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  if (src) {
    return <img src={src} alt="" className={`${className} shrink-0 rounded-full border border-border object-cover`} />;
  }
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-secondary font-display font-bold uppercase text-foreground`}
    >
      {(name || "?").slice(0, 1)}
    </span>
  );
}

export default function WorldFeed({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [me, setMe] = useState<AuthUser | null>(null);
  /* 登录态是否已问过服务端：深链要等这个变 true 再决定「直接开写作框」还是「先去登录」 */
  const [meReady, setMeReady] = useState(false);
  const [posts, setPosts] = useState<WorldPost[]>([]);
  const [tab, setTab] = useState<"latest" | "following">("latest");
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, WorldComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  /* 搜索（开发者 + 帖子）：走后端 /search，覆盖全部注册账号与帖子 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<SearchUser[]>([]);
  const [searchPosts, setSearchPosts] = useState<WorldPost[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  /* 查看某个用户的主页（?u=<login>） */
  const [viewUser, setViewUser] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("u");
  });
  const [userProfile, setUserProfile] = useState<PublicProfile | null>(null);
  /** 主页拉取失败（用户不存在 / 网络错误）：不能一直转圈，要给明确提示 */
  const [profileMissing, setProfileMissing] = useState(false);
  const [userTab, setUserTab] = useState<"posts" | "products">("posts");

  const openUser = (login: string) => {
    setViewUser(login);
    setUserProfile(null);
    setProfileMissing(false);
    setUserTab("posts");
    const url = new URL(window.location.href);
    url.searchParams.set("u", login);
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeUser = () => {
    setViewUser(null);
    setUserProfile(null);
    setProfileMissing(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("u");
    window.history.replaceState(null, "", url.toString());
  };

  const loadProfile = useCallback(async (login: string) => {
    const res = await fetchProfile(login);
    setUserProfile(res);
    setProfileMissing(!res);
    if (res) setPosts(res.posts);
  }, []);

  useEffect(() => {
    if (!viewUser) return;
    void loadProfile(viewUser);
  }, [viewUser, loadProfile]);

  const load = useCallback(async (which: "latest" | "following") => {
    setLoading(true);
    const list = await fetchFeed({ tab: which, limit: 60 });
    setPosts(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchMe().then((u) => { setMe(u); setMeReady(true); });
  }, []);

  useEffect(() => {
    if (!viewUser) void load(tab);
  }, [tab, load, viewUser]);

  /* 右栏「活跃开发者」：直接从当前时间线统计，避免为它单开一个接口。
     数据为空（未加载 / 无人发帖）时整块不渲染。 */
  const activeDevs = useMemo(() => {
    const map = new Map<string, { author: string; name: string; avatar?: string; verified?: boolean; count: number }>();
    for (const item of posts) {
      if (!item.author) continue;
      const hit = map.get(item.author);
      if (hit) hit.count += 1;
      else map.set(item.author, {
        author: item.author,
        name: item.authorName || item.author,
        avatar: item.authorAvatar,
        verified: item.authorVerified,
        count: 1,
      });
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [posts]);

  /* 深链：从左侧栏「发帖」进来（/world/?compose=1）时自动打开写作框。
     未登录则带着 next 去登录页，登录回来参数还在，会再次触发。 */
  const composeHandled = useRef(false);
  useEffect(() => {
    if (!meReady || composeHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("compose") !== "1") return;
    composeHandled.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("compose");
    window.history.replaceState(null, "", url.toString());
    if (!me) {
      window.location.href = p("/login/?next=" + encodeURIComponent("/world/?compose=1"), locale);
      return;
    }
    setError(null);
    setComposerOpen(true);
    window.setTimeout(() => composerRef.current?.focus(), 80);
  }, [meReady, me, locale]);

  /* 深链定位：/world/#post-<id> */
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash;
    if (hash.startsWith("#post-")) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.classList.add("ring-2", "ring-accent/40");
        setTimeout(() => el.classList.remove("ring-2", "ring-accent/40"), 2200);
      }
    }
  }, [loading]);

  /* 搜索请求（防抖 220ms，丢弃过期响应） */
  useEffect(() => {
    const term = query.trim();
    if (viewUser || !term) {
      setPeople([]);
      setSearchPosts(null);
      setSearchBusy(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearchBusy(true);
    const timer = window.setTimeout(() => {
      void searchWorld(term, 20).then((res) => {
        if (seq !== searchSeq.current) return;
        setPeople(res.users);
        setSearchPosts(res.posts);
        setSearchBusy(false);
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, viewUser]);

  /** 同步更新信息流与搜索结果里的同一条帖子 */
  const patchPost = (id: string, next: (post: WorldPost) => WorldPost) => {
    setPosts((prev) => prev.map((x) => (x.id === id ? next(x) : x)));
    setSearchPosts((prev) => (prev ? prev.map((x) => (x.id === id ? next(x) : x)) : prev));
  };
  const dropPost = (id: string) => {
    setPosts((prev) => prev.filter((x) => x.id !== id));
    setSearchPosts((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
  };

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  };

  const openComposer = () => {
    if (!me) {
      window.location.href = p("/login/?next=" + encodeURIComponent("/world/"), locale);
      return;
    }
    setError(null);
    setComposerOpen(true);
    setTimeout(() => composerRef.current?.focus(), 60);
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setError(null);
  };

  const submitPost = async () => {
    if (!me) return;
    if (!text.trim() && !linkUrl.trim()) {
      setError(en ? "Write something first." : "写点什么再发布吧。");
      return;
    }
    setPosting(true);
    setError(null);
    const res = await createPost({ text: text.trim(), linkUrl: linkUrl.trim() || undefined });
    setPosting(false);
    if (!res.ok) {
      setError(res.error || (en ? "Post failed" : "发布失败"));
      return;
    }
    setText("");
    setLinkUrl("");
    setShowLink(false);
    setComposerOpen(false);
    flash(en ? "Posted" : "已发布");
    if (viewUser) {
      await loadProfile(viewUser);
    } else {
      setTab("latest");
      void load("latest");
    }
  };

  const onLike = async (post: WorldPost) => {
    if (!me) { setError(en ? "Log in to like posts." : "登录后才能点赞。"); return; }
    const res = await toggleLike(post.id);
    if (!res.ok) { setError(res.error || (en ? "Failed" : "操作失败")); return; }
    setPosts((prev) =>
      prev.map((x) => (x.id === post.id ? { ...x, likedByMe: Boolean(res.liked), likeCount: res.likeCount ?? x.likeCount } : x)),
    );
    setSearchPosts((prev) =>
      prev ? prev.map((x) => (x.id === post.id ? { ...x, likedByMe: Boolean(res.liked), likeCount: res.likeCount ?? x.likeCount } : x)) : prev,
    );
  };

  const openCommentPanel = async (post: WorldPost) => {
    const next = openComments === post.id ? null : post.id;
    setOpenComments(next);
    setCommentDraft("");
    if (next && !comments[next]) {
      const list = await fetchComments(next);
      setComments((c) => ({ ...c, [next]: list }));
    }
  };

  const submitComment = async (post: WorldPost) => {
    if (!me) { setError(en ? "Log in to comment." : "登录后才能评论。"); return; }
    const value = commentDraft.trim();
    if (!value) return;
    setCommentBusy(true);
    const res = await addComment(post.id, value);
    setCommentBusy(false);
    if (!res.ok || !res.comment) {
      setError(res.error || (en ? "Comment failed" : "评论失败"));
      return;
    }
    setComments((c) => ({ ...c, [post.id]: [...(c[post.id] || []), res.comment as WorldComment] }));
    setPosts((prev) => prev.map((x) => (x.id === post.id ? { ...x, commentCount: x.commentCount + 1 } : x)));
    setSearchPosts((prev) => (prev ? prev.map((x) => (x.id === post.id ? { ...x, commentCount: x.commentCount + 1 } : x)) : prev));
    setCommentDraft("");
  };

  const share = async (post: WorldPost) => {
    const url = `${window.location.origin}${p("/world/", locale)}#post-${post.id}`;
    /* 优先用带降级方案的 copyText：http 页面 / 旧浏览器上
       navigator.clipboard 不存在，直接调用会抛错，只能把整条 URL 弹出来。 */
    const ok = await copyText(url);
    flash(ok ? (en ? "Link copied" : "链接已复制") : url);
  };

  /* 分享用户公开主页链接（/world/?u=handle） */
  const shareProfile = async (handle: string) => {
    const url = `${window.location.origin}${p(`/world/?u=${encodeURIComponent(handle)}`, locale)}`;
    const ok = await copyText(url);
    flash(ok ? (en ? "Profile link copied" : "主页链接已复制") : url);
  };

  const remove = async (post: WorldPost) => {
    if (!confirm(en ? "Delete this post?" : "确定删除这条帖子？")) return;
    const res = await deletePost(post.id);
    if (!res.ok) { setError(res.error || (en ? "Delete failed" : "删除失败")); return; }
    dropPost(post.id);
  };

  const follow = async (login: string) => {
    if (!me) { setError(en ? "Log in to follow." : "登录后才能关注。"); return; }
    const res = await toggleFollow(login);
    if (!res.ok) { setError(res.error || (en ? "Failed" : "操作失败")); return; }
    setUserProfile((u) => (u ? { ...u, isFollowing: Boolean(res.following), followerCount: res.followerCount ?? u.followerCount } : u));
  };

  /* ---------------- 搜索结果 ---------------- */
  const q = query.trim();
  const searching = !viewUser && q.length > 0;
  const visiblePosts = searching ? searchPosts ?? [] : posts;
  const searchPending = searching && searchBusy && searchPosts === null;

  const toggleSearch = () => {
    setSearchOpen((open) => {
      const next = !open;
      if (next) setTimeout(() => searchRef.current?.focus(), 40);
      else setQuery("");
      return next;
    });
  };

  /* 看某人的主页时只用单列 672px；时间线视图才开三栏（左列 + 右栏） */
  return (
    <div className={`mx-auto w-full ${viewUser ? "max-w-2xl" : "flex max-w-2xl items-start gap-6 xl:max-w-[1000px]"}`}>
      <div className="min-w-0 flex-1 pb-8">
      {/* ============ 顶部栏：发布 + 最新/关注 Tab（X 风格） ============ */}
      {/* 吸顶偏移：手机端顶栏 52px；桌面端没有顶栏（左侧栏布局），贴 0 即可 */}
      {!viewUser && (
        <div className="sticky top-[52px] z-30 border-b border-border bg-background/90 backdrop-blur-md lg:top-0">
          <div className="flex items-center gap-1 px-4">
            <button
              type="button"
              onClick={openComposer}
              aria-label={en ? "New post" : "发布新帖"}
              title={en ? "New post" : "发布新帖"}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm transition-transform hover:opacity-90 active:scale-95"
            >
              <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            <div className="flex flex-1 items-stretch">
              {([
                { key: "latest", label: en ? "Latest" : "最新" },
                { key: "following", label: en ? "Following" : "关注" },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    if (t.key === "following" && !me) {
                      setError(en ? "Log in to see your following feed." : "登录后可查看关注动态。");
                      return;
                    }
                    setTab(t.key);
                  }}
                  className={`-mb-px flex-1 border-b-2 py-3.5 text-[15px] font-semibold transition-colors ${
                    tab === t.key
                      ? "border-accent text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={toggleSearch}
              aria-label={en ? "Search" : "搜索"}
              title={en ? "Search developers and posts" : "搜索开发者和帖子"}
              aria-pressed={searchOpen}
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                searchOpen ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <Search className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
          {searchOpen && (
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setSearchOpen(false); } }}
                  placeholder={en ? "Search developers and posts" : "搜索开发者和帖子"}
                  className="w-full rounded-full border border-border bg-secondary/40 py-2 pl-9 pr-9 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                    aria-label={en ? "Clear" : "清空"}
                    className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============ 用户主页视图 ============ */}
      {viewUser && (
        <div className="mt-4 overflow-hidden rounded-[10px] border border-border bg-card">
          {/* 返回条 */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <button type="button" onClick={closeUser} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> {en ? "Back" : "返回"}
            </button>
            <span className="truncate text-[13px] font-semibold text-foreground">
              {userProfile?.user.name || viewUser}
            </span>
          <div className="ml-auto flex items-center gap-3">
            {userProfile?.isSelf && (
              <a href={p("/my-submissions/#posts", locale)} className="text-[12px] text-accent hover:underline">
                {en ? "Manage" : "管理资料"}
              </a>
            )}
            <button
              type="button"
              onClick={() => void shareProfile(cleanHandle(viewUser))}
              className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"
              aria-label={en ? "Share profile" : "分享主页"}
            >
              <Share className="h-3.5 w-3.5" /> {en ? "Share" : "分享"}
            </button>
          </div>
          </div>

          {userProfile ? (
            <>
              {/* 封面 */}
              <div className="h-24 w-full bg-gradient-to-r from-accent/25 via-accent/10 to-secondary sm:h-32" />
              <div className="px-4 pb-4">
                <div className="-mt-10 flex items-end justify-between gap-3 sm:-mt-12">
                  <Avatar
                    name={userProfile.user.name || userProfile.user.login}
                    src={userProfile.user.avatar}
                    className="h-20 w-20 border-4 text-2xl sm:h-24 sm:w-24"
                  />
                  {!userProfile.isSelf && (
                    <button
                      type="button"
                      onClick={() => void follow(viewUser)}
                      className={`btn !h-9 gap-1.5 rounded-full px-5 text-[13px] ${userProfile.isFollowing ? "btn-outline" : "btn-accent"}`}
                    >
                      {userProfile.isFollowing ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                      {userProfile.isFollowing ? (en ? "Following" : "已关注") : (en ? "Follow" : "关注")}
                    </button>
                  )}
                </div>

                <div className="mt-3">
                  <p className="flex items-center gap-1.5 font-display text-lg font-bold text-foreground">
                    {userProfile.user.name}
                    {userProfile.user.verified && <GoldBadge className="h-[17px] w-[17px]" />}
                  </p>
                  <p className="text-[13px] text-muted-foreground">@{cleanHandle(userProfile.user.login)}</p>
                  {userProfile.user.banned && (
                    <span className="mt-1 inline-flex w-fit items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-destructive">
                      {en ? "Banned" : "该账号已被封禁"}
                    </span>
                  )}
                  {isOfficial(userProfile.user.login) && (
                    <span className="mt-1 inline-flex w-fit items-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold leading-none text-accent-foreground">
                      {en ? "Official Account" : "官方账号"}
                    </span>
                  )}
                  {userProfile.user.bio && (
                    <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-foreground/85">{userProfile.user.bio}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                    {userProfile.user.location && (
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{userProfile.user.location}</span>
                    )}
                    {userProfile.user.website && (
                      <a href={ensureHttps(userProfile.user.website)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                        <Link2 className="h-3.5 w-3.5" />{hostOf(userProfile.user.website)}
                      </a>
                    )}
                    {userProfile.user.contact && (
                      <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{userProfile.user.contact}</span>
                    )}
                    {userProfile.user.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" />{userProfile.user.email}
                        {userProfile.user.emailVerified && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
                            <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                            {en ? "Verified" : "已验证"}
                          </span>
                        )}
                      </span>
                    )}
                    {userProfile.user.joinedAt && (
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />
                        {en ? "Joined " : "加入于 "}{userProfile.user.joinedAt.slice(0, 10)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-5 text-[13px] text-muted-foreground">
                    <span><b className="text-foreground">{userProfile.followingCount}</b> {en ? "Following" : "关注"}</span>
                    <span><b className="text-foreground">{userProfile.followerCount}</b> {en ? "Followers" : "粉丝"}</span>
                    <span><b className="text-foreground">{userProfile.productCount}</b> {en ? "Products" : "产品"}</span>
                  </div>
                </div>

                {/* 主页 Tab */}
                <div className="mt-2 flex items-center border-t border-border">
                  {([
                    { key: "posts", label: en ? "Posts" : "帖子", count: userProfile.postCount },
                    { key: "products", label: en ? "Products" : "产品", count: userProfile.productCount },
                  ] as const).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setUserTab(t.key)}
                      className={`-mb-px flex-1 border-b-2 py-3 text-[13px] font-semibold transition-colors ${
                        userTab === t.key ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:bg-secondary/40"
                      }`}
                    >
                      {t.label} <span className="text-muted-foreground">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 产品列表 */}
              {userTab === "products" && (
                  <div className="p-4">
                    {userProfile.products.length === 0 ? (
                      <div className="rounded-[8px] border border-dashed border-border py-10 text-center">
                        <Package className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
                        <p className="mt-2 text-[13px] text-muted-foreground">
                          {en ? "No products submitted yet." : "还没有提交过产品。"}
                        </p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-border">
                        {userProfile.products.map((prod) => (
                          <li key={prod.slug}>
                            <a
                              href={ensureHttps(prod.websiteUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-start gap-3 py-3 transition-colors hover:bg-secondary/30"
                            >
                              {prod.icon ? (
                                <img src={prod.icon} alt="" className="h-10 w-10 shrink-0 rounded-[8px] border border-border object-cover" />
                              ) : (
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-secondary font-display text-[15px] font-bold uppercase text-foreground">
                                  {prod.name.slice(0, 1)}
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 truncate text-[14px] font-bold text-foreground">
                                  {prod.name}
                                  {prod.verificationStatus === "verified" && (
                                    <VerifiedBadge label={en ? "Verified" : "已核验"} className="mt-0.5" />
                                  )}
                                </p>
                                <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{prod.shortDescription}</p>
                                {prod.tags.length > 0 && (
                                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                    {prod.tags.map((t) => `#${t}`).join(" ")}
                              </p>
                                )}
                              </div>
                              <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            ) : profileMissing ? (
              <div className="px-6 py-14 text-center">
                <UserRound className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-foreground/70">
                  {en ? "This profile doesn't exist" : "这个用户不存在"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {en
                    ? "The account may have been deleted or the link is wrong."
                    : "账号可能已注销，或者链接里的用户名不对。"}
                </p>
                <button type="button" onClick={closeUser} className="btn btn-outline mt-4 !h-8 px-4 text-xs">
                  {en ? "Back to feed" : "返回信息流"}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {en ? "Loading…" : "加载中…"}
              </div>
            )}
        </div>
      )}

      {/* ============ 搜索结果：开发者 ============ */}
      {searching && people.length > 0 && (
        <section className="border-t border-border">
          <h3 className="px-4 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            {en ? "Developers" : "开发者"}
          </h3>
          <ul className="divide-y divide-border">
            {people.map((u) => (
              <li key={u.login}>
                <button
                  type="button"
                  onClick={() => openUser(u.login)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/20"
                >
                  <Avatar name={u.name} src={u.avatar} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate font-bold text-foreground">{u.name}</span>
                      {u.verified && <GoldBadge className="h-[15px] w-[15px] shrink-0" />}
                      {isOfficial(u.login) && (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                          {en ? "Official" : "官方"}
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-[13px] text-muted-foreground">@{cleanHandle(u.login)}</span>
                    {u.bio && <span className="mt-0.5 block truncate text-[13px] text-foreground/70">{u.bio}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {searching && visiblePosts.length > 0 && (
        <h3 className="border-t border-border px-4 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          {en ? "Posts" : "帖子"}
        </h3>
      )}

      {/* ============ 时间线（X 风格：通栏 + 1px 分割线） ============ */}
      {loading || searchPending ? (
        <div className="flex items-center justify-center gap-2 border-t border-border py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {en ? "Searching…" : "搜索中…"}
        </div>
      ) : visiblePosts.length === 0 ? (
        <div className="border-t border-border py-14 text-center">
          {searching ? (
            <>
              <Search className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground/70">
                {people.length > 0
                  ? (en ? "No matching posts" : "没有相关帖子")
                  : (en ? "No developers or posts found" : "没有找到相关的开发者和帖子")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {en ? "Try a different keyword." : "换个关键词试试。"}
              </p>
            </>
          ) : (
            <>
              <Globe2 className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground/70">
                {viewUser
                  ? (en ? "No posts yet" : "还没有发帖")
                  : tab === "following"
                    ? (en ? "No posts from people you follow" : "关注的人还没有发帖")
                    : (en ? "No posts yet" : "还没有人发帖")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {viewUser
                  ? (en ? "When they post, it shows up here." : "他发布的内容会出现在这里。")
                  : tab === "following"
                    ? (en ? "Follow creators from any post or their profile." : "在帖子里或用户主页关注感兴趣的创作者。")
                    : (en ? "Be the first to post something." : "来发第一条吧。")}
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className={`divide-y divide-border ${searching ? "" : "border-t border-border"}`}>
          {visiblePosts.map((post) => (
            <li key={post.id} id={`post-${post.id}`} className="px-4 py-3 transition-colors hover:bg-secondary/20">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => openUser(post.author)}
                  aria-label={en ? `View ${post.authorName}'s profile` : `查看 ${post.authorName} 的主页`}
                  className="shrink-0"
                >
                  <Avatar name={post.authorName || post.author} src={post.authorAvatar} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-[15px]">
                    <button
                      type="button"
                      onClick={() => openUser(post.author)}
                      className="truncate font-bold text-foreground hover:underline"
                    >
                      {post.authorName}
                    </button>
                    {post.authorVerified && <GoldBadge className="h-[15px] w-[15px] shrink-0" />}
                    <span className="truncate text-muted-foreground">@{cleanHandle(post.author)}</span>
                    {isOfficial(post.author) && (
                      <span className="inline-flex shrink-0 items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                        {en ? "Official" : "官方"}
                      </span>
                    )}
                    <span className="shrink-0 text-muted-foreground">· {timeAgo(post.createdAt, locale)}</span>
                    {me && me.login === post.author && (
                      <button
                        type="button"
                        onClick={() => void remove(post)}
                        className="ml-auto shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={en ? "Delete" : "删除"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {post.text && (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-6 text-foreground/90">
                      {linkify(post.text)}
                    </p>
                  )}
                  {post.linkUrl && (
                    <a
                      href={ensureHttps(post.linkUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block rounded-[12px] border border-border bg-secondary/20 px-3 py-2.5 text-xs text-foreground/80 transition-colors hover:border-accent/40"
                    >
                      <span className="flex items-center gap-2">
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                        <span className="truncate">{hostOf(post.linkUrl)}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">{en ? "Open" : "打开"}</span>
                      </span>
                    </a>
                  )}
                  <div className="mt-2 flex max-w-sm items-center justify-between text-[13px] text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => void openCommentPanel(post)}
                      className="group inline-flex items-center gap-1.5 rounded-full transition-colors hover:text-accent"
                      aria-label={en ? "Comment" : "评论"}
                    >
                      <span className="-m-1.5 rounded-full p-1.5 transition-colors group-hover:bg-accent/10">
                        <MessageCircle className="h-[17px] w-[17px]" />
                      </span>
                      {post.commentCount || ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onLike(post)}
                      className={`group inline-flex items-center gap-1.5 rounded-full transition-colors hover:text-destructive ${post.likedByMe ? "text-destructive" : ""}`}
                      aria-label={en ? "Like" : "点赞"}
                    >
                      <span className="-m-1.5 rounded-full p-1.5 transition-colors group-hover:bg-destructive/10">
                        <Heart className={`h-[17px] w-[17px] ${post.likedByMe ? "fill-current" : ""}`} />
                      </span>
                      {post.likeCount || ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => void share(post)}
                      className="group inline-flex items-center gap-1.5 rounded-full transition-colors hover:text-accent"
                      aria-label={en ? "Share" : "分享"}
                    >
                      <span className="-m-1.5 rounded-full p-1.5 transition-colors group-hover:bg-accent/10">
                        <Share className="h-[17px] w-[17px]" />
                      </span>
                    </button>
                  </div>

                  {/* 评论区 */}
                  {openComments === post.id && (
                    <div className="mt-3 rounded-[8px] border border-border bg-secondary/20 p-3">
                      {(comments[post.id] || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">{en ? "No comments yet." : "还没有评论。"}</p>
                      ) : (
                        <ul className="space-y-2.5">
                          {(comments[post.id] || []).map((c) => (
                            <li key={c.id} className="flex gap-2">
                              <button type="button" onClick={() => openUser(c.author)} className="shrink-0">
                                <Avatar name={c.authorName || c.author} src={c.authorAvatar} className="h-7 w-7 text-[11px]" />
                              </button>
                              <div className="min-w-0">
                                <p className="text-[11px] text-muted-foreground">
                                  <button type="button" onClick={() => openUser(c.author)} className="font-bold text-foreground hover:underline">
                                    {c.authorName}
                                  </button>{" "}
                                  · {timeAgo(c.createdAt, locale)}
                                </p>
                                <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground/85">{c.text}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      {me ? (
                        <div className="mt-3 flex gap-2">
                          <input
                            value={commentDraft}
                            onChange={(e) => setCommentDraft(e.target.value.slice(0, 300))}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitComment(post); } }}
                            placeholder={en ? "Write a comment…" : "写评论…"}
                            className="input !h-9 w-full !text-[13px]"
                          />
                          <button type="button" onClick={() => void submitComment(post)} disabled={commentBusy} className="btn btn-accent !h-9 shrink-0 px-3 text-xs">
                            {commentBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <a href={p("/login/?next=" + encodeURIComponent("/world/"), locale)} className="mt-3 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          <LogIn className="h-3 w-3" /> {en ? "Log in to comment" : "登录后评论"}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>

      {/* ============ 右栏（仅桌面 + 时间线视图）============
          信息流本身只有 672px，宽屏上两侧会空出很多；补一列导读内容，
          与 X 的三栏结构一致。数据全部来自已加载的时间线，不额外请求。 */}
      {!viewUser && (
        <aside className="sticky top-4 hidden w-[300px] shrink-0 pt-4 xl:block" aria-label={en ? "World sidebar" : "世界侧栏"}>
          <div className="space-y-4">
            <section className="overflow-hidden rounded-[10px] border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-display text-[14px] font-bold text-foreground">{en ? "The World" : "关于世界"}</h2>
              </div>
              <div className="px-4 py-3">
                <p className="text-[12.5px] leading-6 text-muted-foreground">
                  {en
                    ? "SolHub's public timeline: post updates, share links, follow indie developers. Links are unfurled into cards automatically."
                    : "SolHub 的公共时间线：发布动态、分享链接、关注独立开发者。贴出的链接会自动展开成卡片。"}
                </p>
                <a href={p("/about/", locale)} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                  {en ? "Learn more" : "了解更多"}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
            </section>

            {activeDevs.length > 0 && (
              <section className="overflow-hidden rounded-[10px] border border-border bg-card">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="font-display text-[14px] font-bold text-foreground">{en ? "Active developers" : "活跃开发者"}</h2>
                </div>
                <ul className="divide-y divide-border">
                  {activeDevs.map((dev) => (
                    <li key={dev.author}>
                      <button
                        type="button"
                        onClick={() => openUser(dev.author)}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-secondary/50"
                      >
                        <Avatar name={dev.name} src={dev.avatar} className="h-8 w-8 text-[11px]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1">
                            <span className="truncate text-[13px] font-medium text-foreground">{dev.name}</span>
                            {dev.verified && <GoldBadge className="h-3 w-3 shrink-0" />}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            @{dev.author} · {dev.count} {en ? (dev.count > 1 ? "posts" : "post") : "条动态"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-[10px] border border-border bg-card px-4 py-3">
              {me ? (
                <a href={p("/my-submissions/", locale)} className="flex items-center gap-2 text-[13px] font-medium text-foreground transition-colors hover:text-accent">
                  <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {en ? "Go to my profile" : "回到我的主页"}
                  <ArrowRight className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : (
                <>
                  <p className="text-[12.5px] leading-6 text-muted-foreground">
                    {en ? "Log in to post, comment and follow developers." : "登录后即可发帖、评论和关注开发者。"}
                  </p>
                  <a
                    href={p("/login/?next=" + encodeURIComponent("/world/"), locale)}
                    className="mt-2.5 flex h-9 items-center justify-center rounded-[8px] bg-accent text-[13px] font-semibold text-accent-foreground transition-colors hover:brightness-95"
                  >
                    {en ? "Log in" : "登录 / 注册"}
                  </a>
                </>
              )}
            </section>
          </div>
        </aside>
      )}

      {/* ============ 发帖浮层 ============ */}
      {composerOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain animate-fade-in" role="dialog" aria-modal="true" aria-label={en ? "New post" : "发布新帖"}>
          <div className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={closeComposer} aria-hidden="true" />
          <div className="relative flex min-h-full items-start justify-center p-4 sm:items-center">
            <div className="animate-dialog-in my-auto w-full max-w-lg rounded-[10px] border border-border bg-card p-4 shadow-xl sm:p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-foreground">{en ? "New post" : "发布新帖"}</h3>
                <button
                  type="button"
                  onClick={closeComposer}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={en ? "Close" : "关闭"}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 flex gap-3">
                <Avatar name={me?.displayName || me?.login || "?"} src={me ? avatarOf(me) : undefined} />
                <textarea
                  ref={composerRef}
                  value={text}
                  onChange={(e) => { setText(e.target.value.slice(0, MAX)); setError(null); }}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submitPost(); } }}
                  rows={4}
                  placeholder={en ? "What are you building today?" : "今天在做什么？分享点什么…"}
                  className="input w-full resize-y !text-[15px]"
                />
              </div>

              {showLink && (
                <div className="relative mt-3">
                  <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://your-product.com"
                    className="input w-full font-mono !pl-8 !text-[13px]"
                  />
                </div>
              )}

              {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowLink((v) => !v)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${
                    showLink ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  <Link2 className="h-3.5 w-3.5" /> {en ? "Add link" : "添加链接"}
                </button>
                <div className="flex items-center gap-3">
                  <span className={`text-[11px] ${text.length > MAX - 50 ? "text-warning" : "text-muted-foreground"}`}>
                    {text.length}/{MAX}
                  </span>
                  <button type="button" onClick={() => void submitPost()} disabled={posting} className="btn btn-accent !h-9 gap-1.5 rounded-full px-5 text-sm">
                    {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {en ? "Post" : "发布"}
                  </button>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                {en
                  ? "Tip: Cmd/Ctrl + Enter to post. Links are shown as a card under your post."
                  : "提示：Cmd/Ctrl + Enter 快速发布；附带的链接会在帖子下方以卡片展示。"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-[8px] bg-foreground px-4 py-2 text-xs text-background shadow-lg">
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" />{toast}</span>
        </div>
      )}
    </div>
  );
}
