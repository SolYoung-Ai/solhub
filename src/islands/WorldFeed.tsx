import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Globe2,
  Heart,
  Link2,
  Loader2,
  LogIn,
  MessageCircle,
  Send,
  Trash2,
  UserPlus,
  Users,
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

export default function WorldFeed({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";
  const [me, setMe] = useState<AuthUser | null>(null);
  const [posts, setPosts] = useState<WorldPost[]>([]);
  const [tab, setTab] = useState<"latest" | "following">("latest");
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, WorldComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* 查看某个用户的主页（?u=<login>） */
  const [viewUser, setViewUser] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("u");
  });
  const [userProfile, setUserProfile] = useState<PublicProfile | null>(null);

  const openUser = (login: string) => {
    setViewUser(login);
    setUserProfile(null);
    const url = new URL(window.location.href);
    url.searchParams.set("u", login);
    window.history.replaceState(null, "", url.toString());
  };

  const closeUser = () => {
    setViewUser(null);
    setUserProfile(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("u");
    window.history.replaceState(null, "", url.toString());
  };

  useEffect(() => {
    if (!viewUser) return;
    void fetchProfile(viewUser).then((res) => {
      setUserProfile(res);
      if (res) setPosts(res.posts);
    });
  }, [viewUser]);

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
      setError(res.error || "发布失败");
      return;
    }
    setText("");
    setLinkUrl("");
    setShowLink(false);
    flash(en ? "Posted" : "已发布");
    if (viewUser) {
      const res2 = await fetchProfile(viewUser);
      if (res2) { setUserProfile(res2); setPosts(res2.posts); }
    } else {
      setTab("latest");
      void load("latest");
    }
  };

  const onLike = async (post: WorldPost) => {
    if (!me) { setError(en ? "Log in to like posts." : "登录后才能点赞。"); return; }
    const res = await toggleLike(post.id);
    if (!res.ok) { setError(res.error || "操作失败"); return; }
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
      setError(res.error || "评论失败");
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
    if (!res.ok) { setError(res.error || "删除失败"); return; }
    setPosts((prev) => prev.filter((x) => x.id !== post.id));
  };

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* 用户主页视图 */}
      {viewUser && (
        <div className="rounded-[4px] border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <button type="button" onClick={closeUser} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> {en ? "Back to World" : "返回世界"}
            </button>
            {me && me.login === viewUser && (
              <a href={p("/my-submissions/#posts", locale)} className="text-[12px] text-accent hover:underline">
                {en ? "Manage in My Account" : "在个人中心管理"}
              </a>
            )}
          </div>
          {userProfile ? (
            <div className="px-4 py-4">
              <div className="flex items-start gap-3">
                {userProfile.user.avatar ? (
                  <img src={userProfile.user.avatar} alt="" className="h-14 w-14 rounded-full border border-border object-cover" />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary font-display text-lg font-bold uppercase text-foreground">
                    {(userProfile.user.name || userProfile.user.login).slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-foreground">{userProfile.user.name}</p>
                  <p className="truncate text-[12px] text-muted-foreground">@{userProfile.user.login}</p>
                  <p className="mt-1.5 flex gap-4 text-[12px] text-muted-foreground">
                    <span><b className="text-foreground">{userProfile.postCount}</b> {en ? "posts" : "帖子"}</span>
                    <span><b className="text-foreground">{userProfile.followingCount}</b> {en ? "following" : "关注"}</span>
                    <span><b className="text-foreground">{userProfile.followerCount}</b> {en ? "followers" : "粉丝"}</span>
                  </p>
                </div>
                {!userProfile.isSelf && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!me) { setError(en ? "Log in to follow." : "登录后才能关注。"); return; }
                      const res = await toggleFollow(viewUser);
                      if (!res.ok) { setError(res.error || "操作失败"); return; }
                      setUserProfile((u) => (u ? { ...u, isFollowing: Boolean(res.following), followerCount: res.followerCount ?? u.followerCount } : u));
                    }}
                    className={`btn !h-8 shrink-0 gap-1.5 px-4 text-xs ${userProfile.isFollowing ? "btn-outline" : "btn-accent"}`}
                  >
                    {userProfile.isFollowing ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                    {userProfile.isFollowing ? (en ? "Following" : "已关注") : (en ? "Follow" : "关注")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {en ? "Loading…" : "加载中…"}
            </div>
          )}
        </div>
      )}

      {!viewUser && (
        <>
          {/* 顶部说明 */}
          <div className="flex items-center gap-2 rounded-[3px] border border-border bg-secondary/40 px-4 py-3 text-[13px] text-muted-foreground">
            <Globe2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            {en
              ? "The World: share what you're building, ask questions, drop links. Follow creators you like."
              : "世界：分享你在做什么、提问、丢个链接。关注喜欢的创作者，只看到他们的动态。"}
          </div>

          {/* 发帖框 */}
          <div className="mt-4 rounded-[4px] border border-border bg-card p-4">
        {me ? (
          <>
            <div className="flex gap-3">
              {avatarOf(me) ? (
                <img src={avatarOf(me)} alt="" className="h-9 w-9 shrink-0 rounded-full border border-border object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-[13px] font-bold uppercase text-foreground">
                  {(me.displayName || me.login).slice(0, 1)}
                </span>
              )}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => { setText(e.target.value.slice(0, MAX)); setError(null); }}
                rows={3}
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
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowLink((v) => !v)}
                className="btn btn-ghost !h-8 gap-1.5 px-2.5 text-xs text-muted-foreground"
              >
                <Link2 className="h-3.5 w-3.5" /> {en ? "Add link" : "添加链接"}
              </button>
              <div className="flex items-center gap-3">
                <span className={`text-[11px] ${text.length > MAX - 50 ? "text-warning" : "text-muted-foreground"}`}>
                  {text.length}/{MAX}
                </span>
                <button type="button" onClick={() => void submitPost()} disabled={posting} className="btn btn-accent !h-9 gap-1.5 px-5 text-xs">
                  {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {en ? "Post" : "发布"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 py-2">
            <p className="text-[13px] text-muted-foreground">
              {en ? "Log in to post, like and comment." : "登录后即可发帖、点赞和评论。"}
            </p>
            <a href={p("/login/?next=" + encodeURIComponent("/world/"), locale)} className="btn btn-accent !h-9 gap-1.5 px-4 text-xs">
              <LogIn className="h-3.5 w-3.5" /> {en ? "Log in" : "登录 / 注册"}
            </a>
          </div>
        )}
      </div>

      {/* Tab */}
      <div className="mt-5 flex items-center gap-1 border-b border-border">
        {([
          { key: "latest", label: en ? "Latest" : "最新", icon: <Globe2 className="h-3.5 w-3.5" /> },
          { key: "following", label: en ? "Following" : "关注", icon: <Users className="h-3.5 w-3.5" /> },
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
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === t.key ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
        </>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {en ? "Loading…" : "加载中…"}
        </div>
      ) : posts.length === 0 ? (
        <div className="mt-8 rounded-[4px] border border-dashed border-border py-14 text-center">
          <Globe2 className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground/70">
            {tab === "following" ? (en ? "No posts from people you follow" : "关注的人还没有发帖") : (en ? "No posts yet" : "还没有人发帖")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tab === "following"
              ? (en ? "Follow creators from any post or their profile." : "在帖子里或用户主页关注感兴趣的创作者。")
              : (en ? "Be the first to post something." : "来发第一条吧。")}
          </p>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {posts.map((post) => (
            <li key={post.id} id={`post-${post.id}`} className="py-4 transition-shadow">
              <div className="flex gap-3">
                <button type="button" onClick={() => openUser(post.author)} className="shrink-0" aria-label={post.authorName}>
                  {post.authorAvatar ? (
                    <img src={post.authorAvatar} alt="" className="h-9 w-9 rounded-full border border-border object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary font-display text-[13px] font-bold uppercase text-foreground">
                      {(post.authorName || post.author).slice(0, 1)}
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <button type="button" onClick={() => openUser(post.author)} className="truncate text-[13px] font-bold text-foreground hover:text-accent">
                      {post.authorName}
                    </button>
                    <span className="truncate text-[11px] text-muted-foreground">@{post.author}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">· {timeAgo(post.createdAt, locale)}</span>
                    {me && me.login === post.author && (
                      <button
                        type="button"
                        onClick={() => void remove(post)}
                        className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={en ? "Delete" : "删除"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {post.text && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground/90">
                      {linkify(post.text)}
                    </p>
                  )}
                  {post.linkUrl && (
                    <a
                      href={post.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center gap-2 rounded-[3px] border border-border bg-secondary/30 px-3 py-2 text-xs text-foreground/80 hover:border-accent/40"
                    >
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="truncate">{hostOf(post.linkUrl)}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground">{en ? "Open" : "打开"}</span>
                    </a>
                  )}
                  <div className="mt-2 flex items-center gap-4 text-[12px] text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => void onLike(post)}
                      className={`inline-flex items-center gap-1 transition-colors hover:text-destructive ${post.likedByMe ? "text-destructive" : ""}`}
                    >
                      <Heart className={`h-3.5 w-3.5 ${post.likedByMe ? "fill-current" : ""}`} />
                      {post.likeCount || ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCommentPanel(post)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      {post.commentCount || ""}
                    </button>
                    <button type="button" onClick={() => void share(post)} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
                      <Link2 className="h-3.5 w-3.5" />
                      {en ? "Share" : "分享"}
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
                              {c.authorAvatar ? (
                                <img src={c.authorAvatar} alt="" className="h-6 w-6 rounded-full object-cover" />
                              ) : (
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-bold uppercase text-foreground">
                                  {(c.authorName || c.author).slice(0, 1)}
                                </span>
                              )}
                              <div className="min-w-0">
                                <p className="text-[11px] text-muted-foreground">
                                  <span className="font-bold text-foreground">{c.authorName}</span> · {timeAgo(c.createdAt, locale)}
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

      {/* 轻提示 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-[3px] bg-foreground px-4 py-2 text-xs text-background shadow-lg">
          <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5" />{toast}</span>
        </div>
      )}
    </div>
  );
}
