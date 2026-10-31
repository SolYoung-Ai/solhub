import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Check,
  ExternalLink,
  Feather,
  Globe2,
  Heart,
  Link2,
  Loader2,
  LogIn,
  MapPin,
  MessageCircle,
  Package,
  Send,
  Share,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { p } from "@/lib/paths";
import { avatarOf, fetchMe, type AuthUser } from "@/lib/auth";
import {
  addComment,
  createPost,
  deletePost,
  fetchComments,
  fetchFeed,
  fetchProfile,
  hostOf,
  timeAgo,
  toggleFollow,
  toggleLike,
  type PublicProfile,
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

  /* 查看某个用户的主页（?u=<login>） */
  const [viewUser, setViewUser] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("u");
  });
  const [userProfile, setUserProfile] = useState<PublicProfile | null>(null);
  const [userTab, setUserTab] = useState<"posts" | "products">("posts");

  const openUser = (login: string) => {
    setViewUser(login);
    setUserProfile(null);
    setUserTab("posts");
    const url = new URL(window.location.href);
    url.searchParams.set("u", login);
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeUser = () => {
    setViewUser(null);
    setUserProfile(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("u");
    window.history.replaceState(null, "", url.toString());
  };

  const loadProfile = useCallback(async (login: string) => {
    const res = await fetchProfile(login);
    setUserProfile(res);
    if (res) setPosts(res.posts);
  }, []);

  useEffect(() => {
    if (!viewUser) return;
    void loadProfile(viewUser);
  }, [viewUser, loadProfile]);

  const load = useCallback(async (which: "latest" | "following") => {
    setLoading(true);
    const list = await fetchFeed({ tab: which, limit: 40 });
    setPosts(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchMe().then(setMe);
  }, []);

  useEffect(() => {
    if (!viewUser) void load(tab);
  }, [tab, load, viewUser]);

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
    setCommentDraft("");
  };

  const share = async (post: WorldPost) => {
    const url = `${window.location.origin}${p("/world/", locale)}#post-${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      flash(en ? "Link copied" : "链接已复制");
    } catch {
      flash(url);
    }
  };

  const remove = async (post: WorldPost) => {
    if (!confirm(en ? "Delete this post?" : "确定删除这条帖子？")) return;
    const res = await deletePost(post.id);
    if (!res.ok) { setError(res.error || (en ? "Delete failed" : "删除失败")); return; }
    setPosts((prev) => prev.filter((x) => x.id !== post.id));
  };

  const follow = async (login: string) => {
    if (!me) { setError(en ? "Log in to follow." : "登录后才能关注。"); return; }
    const res = await toggleFollow(login);
    if (!res.ok) { setError(res.error || (en ? "Failed" : "操作失败")); return; }
    setUserProfile((u) => (u ? { ...u, isFollowing: Boolean(res.following), followerCount: res.followerCount ?? u.followerCount } : u));
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* ============ 顶部栏：左上角加号发布按钮 + Tab ============ */}
      <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openComposer}
            aria-label={en ? "New post" : "发布新帖"}
            title={en ? "New post" : "发布新帖"}
            className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm transition-transform hover:opacity-90 active:scale-95"
          >
            <Feather className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>

          {!viewUser && (
            <div className="flex flex-1 items-center">
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
                  className={`-mb-px min-w-[80px] flex-1 border-b-2 py-3 text-[14px] font-semibold transition-colors sm:flex-none ${
                    tab === t.key
                      ? "border-accent text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {me ? (
              <button
                type="button"
                onClick={() => openUser(me.login)}
                className="inline-flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-[12px] font-medium text-foreground/80 hover:border-foreground/30"
              >
                <Avatar name={me.displayName || me.login} src={avatarOf(me)} className="h-6 w-6 text-[10px]" />
                <span className="hidden sm:inline">{me.displayName || me.login}</span>
              </button>
            ) : (
              <a
                href={p("/login/?next=" + encodeURIComponent("/world/"), locale)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-4 text-[12px] font-semibold text-background hover:opacity-90"
              >
                <LogIn className="h-3.5 w-3.5" /> {en ? "Log in" : "登录"}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ============ 用户主页视图 ============ */}
      {viewUser && (
        <div className="mt-4 overflow-hidden rounded-[4px] border border-border bg-card">
          {/* 返回条 */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <button type="button" onClick={closeUser} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> {en ? "Back" : "返回"}
            </button>
            <span className="truncate text-[13px] font-semibold text-foreground">
              {userProfile?.user.name || viewUser}
            </span>
            {me && me.login === viewUser && (
              <a href={p("/my-submissions/#posts", locale)} className="ml-auto text-[12px] text-accent hover:underline">
                {en ? "Manage" : "管理资料"}
              </a>
            )}
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
                  <p className="font-display text-lg font-bold text-foreground">{userProfile.user.name}</p>
                  <p className="text-[13px] text-muted-foreground">@{userProfile.user.login}</p>
                  {userProfile.user.bio && (
                    <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-foreground/85">{userProfile.user.bio}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                    {userProfile.user.location && (
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{userProfile.user.location}</span>
                    )}
                    {userProfile.user.website && (
                      <a href={userProfile.user.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                        <Link2 className="h-3.5 w-3.5" />{hostOf(userProfile.user.website)}
                      </a>
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
                      <div className="rounded-[3px] border border-dashed border-border py-10 text-center">
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
                              href={prod.websiteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-start gap-3 py-3 transition-colors hover:bg-secondary/30"
                            >
                              {prod.icon ? (
                                <img src={prod.icon} alt="" className="h-10 w-10 shrink-0 rounded-[3px] border border-border object-cover" />
                              ) : (
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] bg-secondary font-display text-[15px] font-bold uppercase text-foreground">
                                  {prod.name.slice(0, 1)}
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 truncate text-[14px] font-bold text-foreground">
                                  {prod.name}
                                  {prod.verificationStatus === "verified" && (
                                    <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-label={en ? "Verified" : "已核验"} />
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
            ) : (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {en ? "Loading…" : "加载中…"}
              </div>
            )}
        </div>
      )}

      {/* ============ 时间线 ============ */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {en ? "Loading…" : "加载中…"}
        </div>
      ) : posts.length === 0 ? (
        <div className="mt-8 rounded-[4px] border border-dashed border-border py-14 text-center">
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
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {posts.map((post) => (
            <li key={post.id} id={`post-${post.id}`} className="py-3.5 transition-colors hover:bg-secondary/15">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => openUser(post.author)}
                  aria-label={en ? `View ${post.authorName}'s profile` : `查看 ${post.authorName} 的主页`}
                  className="shrink-0"
                >
                  <Avatar name={post.authorName || post.author} src={post.authorAvatar} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <button
                      type="button"
                      onClick={() => openUser(post.author)}
                      className="truncate text-[14px] font-bold text-foreground hover:underline"
                    >
                      {post.authorName}
                    </button>
                    <span className="truncate text-[13px] text-muted-foreground">@{post.author}</span>
                    <span className="shrink-0 text-[13px] text-muted-foreground">· {timeAgo(post.createdAt, locale)}</span>
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
                      href={post.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-2 rounded-[3px] border border-border bg-secondary/30 px-3 py-2 text-xs text-foreground/80 transition-colors hover:border-accent/40"
                    >
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="truncate">{hostOf(post.linkUrl)}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground">{en ? "Open" : "打开"}</span>
                    </a>
                  )}
                  <div className="mt-2 flex max-w-md items-center justify-between text-[13px] text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => void openCommentPanel(post)}
                      className="group inline-flex items-center gap-1.5 transition-colors hover:text-accent"
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
                      className={`group inline-flex items-center gap-1.5 transition-colors hover:text-destructive ${post.likedByMe ? "text-destructive" : ""}`}
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
                      className="group inline-flex items-center gap-1.5 transition-colors hover:text-accent"
                      aria-label={en ? "Share" : "分享"}
                    >
                      <span className="-m-1.5 rounded-full p-1.5 transition-colors group-hover:bg-accent/10">
                        <Share className="h-[17px] w-[17px]" />
                      </span>
                    </button>
                  </div>

                  {/* 评论区 */}
                  {openComments === post.id && (
                    <div className="mt-3 rounded-[3px] border border-border bg-secondary/20 p-3">
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

      {/* ============ 发帖浮层 ============ */}
      {composerOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain animate-fade-in" role="dialog" aria-modal="true" aria-label={en ? "New post" : "发布新帖"}>
          <div className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" onClick={closeComposer} aria-hidden="true" />
          <div className="relative flex min-h-full items-start justify-center p-4 sm:items-center">
            <div className="animate-dialog-in my-auto w-full max-w-lg rounded-[4px] border border-border bg-card p-4 shadow-xl sm:p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-foreground">{en ? "New post" : "发布新帖"}</h3>
                <button
                  type="button"
                  onClick={closeComposer}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-secondary hover:text-foreground"
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
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-[3px] bg-foreground px-4 py-2 text-xs text-background shadow-lg">
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" />{toast}</span>
        </div>
      )}
    </div>
  );
}
