import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  Globe2,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Package,
  Plus,
  Search,
  Share,
  ShieldCheck,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { p } from "@/lib/paths";
import GoldBadge from "@/components/GoldBadge";
import VerifiedBadge from "@/components/VerifiedBadge";
import { fetchMe, type AuthUser } from "@/lib/auth";
import { copyText, ensureHttps } from "@/lib/utils";
import {
  fetchCreators,
  fetchProfile,
  hostOf,
  isOfficial,
  toggleFollow,
  type Creator,
  type CreatorFilter,
  type CreatorList,
  type PublicProfile,
} from "@/lib/world";
import type { Locale } from "@/i18n";

/* 公开标识就是 handle；历史数据里若仍是邮箱形态，只展示 @ 前缀，避免泄露邮箱 */
function cleanHandle(login: string): string {
  if (login.includes("@")) return login.split("@")[0];
  return login;
}

/** 头像：服务端给的是 /avatar/<login> 短链接，取不到时退回首字母，不出现破图 */
function Avatar({
  name,
  src,
  className = "h-10 w-10 text-[15px]",
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className={`${className} shrink-0 rounded-full border border-border object-cover`}
      />
    );
  }
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-secondary font-display font-bold uppercase text-foreground`}
    >
      {(name || "?").slice(0, 1)}
    </span>
  );
}

const EMPTY: CreatorList = { total: 0, counts: { all: 0, verified: 0, products: 0 }, creators: [] };

/**
 * 创作者名录。
 *
 * 信息架构和 X 的时间线无关：这里展示的是「人」，不是「动态」。
 * 一行 = 一位创作者（头像 / 名字 / @handle / 一句话简介 / 站点 / 作品数），
 * 排序由服务端给：有作品 → 已认证 → 先加入。
 *
 * 发帖功能已下线：这个页面不再有写作框、点赞、评论、帖子流；
 * 个人主页也只保留资料与作品。
 */
export default function Creators({ locale = "zh" }: { locale?: Locale }) {
  const en = locale === "en";

  const [me, setMe] = useState<AuthUser | null>(null);
  const [data, setData] = useState<CreatorList>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [filter, setFilter] = useState<CreatorFilter>("all");
  const [query, setQuery] = useState("");
  const seq = useRef(0);

  /* 主页视图（?u=<handle>）：沿用旧分享链接的查询参数 */
  const [viewUser, setViewUser] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("u");
  });
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void fetchMe().then(setMe);
  }, []);

  /* 列表加载：输入框防抖 220ms，并用序号丢弃过期响应 */
  useEffect(() => {
    if (viewUser) return;
    const no = ++seq.current;
    setBusy(true);
    setMoreBusy(false);
    const timer = window.setTimeout(
      () => {
        void fetchCreators({ q: query.trim(), filter }).then((res) => {
          if (no !== seq.current) return;
          setData(res);
          setBusy(false);
          setLoading(false);
        });
      },
      query.trim() ? 220 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [query, filter, viewUser]);

  /* 名录分页：首屏只拉 100 人，剩下的按需加载。
     服务端有 60 秒实例内缓存，翻页几乎不产生额外读库成本。 */
  const loadMore = useCallback(async () => {
    if (moreBusy || !data.hasMore) return;
    const no = seq.current;
    setMoreBusy(true);
    const res = await fetchCreators({ q: query.trim(), filter, offset: data.nextOffset || 0 });
    /* 加载期间如果用户换了关键词/筛选，seq 会变，直接丢弃这批结果 */
    if (no !== seq.current) {
      setMoreBusy(false);
      return;
    }
    setData((prev) => ({
      ...prev,
      total: res.total,
      counts: res.counts,
      hasMore: res.hasMore,
      nextOffset: res.nextOffset,
      creators: [...prev.creators, ...res.creators],
    }));
    setMoreBusy(false);
  }, [moreBusy, data.hasMore, data.nextOffset, query, filter]);

  /* 「加载更多」上显示的剩余人数：按当前筛选口径算（全部 / 已认证 / 有作品） */
  const chipTotal =
    filter === "verified" ? data.counts.verified : filter === "products" ? data.counts.products : data.counts.all;
  const remainingCreators = Math.max(0, chipTotal - data.creators.length);

  /* 主页加载 */
  useEffect(() => {
    if (!viewUser) return;
    let alive = true;
    setProfile(null);
    setProfileMissing(false);
    void fetchProfile(viewUser).then((res) => {
      if (!alive) return;
      setProfile(res);
      setProfileMissing(!res);
    });
    return () => {
      alive = false;
    };
  }, [viewUser]);

  const openUser = useCallback((login: string) => {
    setViewUser(login);
    const url = new URL(window.location.href);
    url.searchParams.set("u", login);
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const closeUser = useCallback(() => {
    setViewUser(null);
    setProfile(null);
    setProfileMissing(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("u");
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  };

  const shareProfile = async (handle: string) => {
    const url = `${window.location.origin}${p(`/world/?u=${encodeURIComponent(handle)}`, locale)}`;
    const ok = await copyText(url);
    flash(ok ? (en ? "Profile link copied" : "主页链接已复制") : url);
  };

  const follow = async (login: string) => {
    if (!me) {
      window.location.href = p(`/login/?next=${encodeURIComponent(`/world/?u=${login}`)}`, locale);
      return;
    }
    const res = await toggleFollow(login);
    if (!res.ok) return;
    setProfile((u) =>
      u ? { ...u, isFollowing: Boolean(res.following), followerCount: res.followerCount ?? u.followerCount } : u,
    );
  };

  /* ==================== 个人主页 ==================== */
  if (viewUser) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-10">
        <div className="overflow-hidden rounded-[12px] border border-border bg-card">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <button
              type="button"
              onClick={closeUser}
              className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> {en ? "Back" : "返回"}
            </button>
            <span className="truncate text-[13px] font-semibold text-foreground">
              {profile?.user.name || viewUser}
            </span>
            <div className="ml-auto flex items-center gap-3">
              {profile?.isSelf && (
                <a href={p("/my-submissions/", locale)} className="text-[12px] text-accent hover:underline">
                  {en ? "Manage" : "管理资料"}
                </a>
              )}
              <button
                type="button"
                onClick={() => void shareProfile(cleanHandle(viewUser))}
                className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline"
              >
                <Share className="h-3.5 w-3.5" /> {en ? "Share" : "分享"}
              </button>
            </div>
          </div>

          {profile ? (
            <>
              <div className="h-24 w-full bg-gradient-to-r from-accent/25 via-accent/10 to-secondary sm:h-32" />
              <div className="px-4 pb-4">
                <div className="-mt-10 flex items-end justify-between gap-3 sm:-mt-12">
                  <Avatar
                    name={profile.user.name || profile.user.login}
                    src={profile.user.avatar}
                    className="h-20 w-20 border-4 text-2xl sm:h-24 sm:w-24"
                  />
                  {!profile.isSelf && (
                    <button
                      type="button"
                      onClick={() => void follow(viewUser)}
                      className={`btn !h-9 gap-1.5 rounded-full px-5 text-[13px] ${
                        profile.isFollowing ? "btn-outline" : "btn-accent"
                      }`}
                    >
                      {profile.isFollowing ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                      {profile.isFollowing ? (en ? "Following" : "已关注") : (en ? "Follow" : "关注")}
                    </button>
                  )}
                </div>

                <div className="mt-3">
                  <p className="flex items-center gap-1.5 font-display text-lg font-bold text-foreground">
                    {profile.user.name}
                    {profile.user.verified && <GoldBadge className="h-[17px] w-[17px]" />}
                    {isOfficial(profile.user.login) && (
                      <span className="inline-flex items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                        {en ? "Official" : "官方"}
                      </span>
                    )}
                  </p>
                  <p className="text-[13px] text-muted-foreground">@{cleanHandle(profile.user.login)}</p>
                  {profile.user.banned && (
                    <span className="mt-1 inline-flex w-fit items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold leading-none text-destructive">
                      {en ? "Banned" : "该账号已被封禁"}
                    </span>
                  )}
                  {profile.user.bio && (
                    <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-foreground/85">{profile.user.bio}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                    {profile.user.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {profile.user.location}
                      </span>
                    )}
                    {profile.user.website && (
                      <a
                        href={ensureHttps(profile.user.website)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {hostOf(profile.user.website)}
                      </a>
                    )}
                    {profile.user.contact && (
                      <span className="inline-flex items-center gap-1">
                        <Globe2 className="h-3.5 w-3.5" />
                        {profile.user.contact}
                      </span>
                    )}
                    {profile.user.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" />
                        {profile.user.email}
                        {profile.user.emailVerified && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
                            <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                            {en ? "Verified" : "已验证"}
                          </span>
                        )}
                      </span>
                    )}
                    {profile.user.joinedAt && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {en ? "Joined " : "加入于 "}
                        {profile.user.joinedAt.slice(0, 10)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 flex items-center gap-5 text-[13px] text-muted-foreground">
                    <span>
                      <b className="text-foreground">{profile.followingCount}</b> {en ? "Following" : "关注"}
                    </span>
                    <span>
                      <b className="text-foreground">{profile.followerCount}</b> {en ? "Followers" : "粉丝"}
                    </span>
                    <span>
                      <b className="text-foreground">{profile.productCount}</b> {en ? "Products" : "作品"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 作品：个人主页只展示作品，不再有帖子 */}
              <div className="border-t border-border px-4 py-3">
                <h2 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                  <Package className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  {en ? "Products" : "作品"}
                  <span className="font-normal text-muted-foreground">{profile.products.length}</span>
                </h2>
                {profile.products.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-border py-10 text-center">
                    <Package className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
                    <p className="mt-2 text-[13px] text-muted-foreground">
                      {en ? "No products submitted yet." : "还没有提交过作品。"}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {profile.products.map((prod) => (
                      <li key={prod.slug}>
                        <a
                          href={ensureHttps(prod.websiteUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-start gap-3 py-3 transition-colors hover:bg-secondary/30"
                        >
                          {prod.icon ? (
                            <img
                              src={prod.icon}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-[8px] border border-border object-cover"
                            />
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
                            <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                              {prod.shortDescription}
                            </p>
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
            </>
          ) : profileMissing ? (
            <div className="px-6 py-14 text-center">
              <UserRound className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground/70">
                {en ? "This profile doesn't exist" : "这个用户不存在"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {en ? "The account may have been deleted or the link is wrong." : "账号可能已注销，或者链接里的用户名不对。"}
              </p>
              <button type="button" onClick={closeUser} className="btn btn-outline mt-4 !h-8 px-4 text-xs">
                {en ? "Back to creators" : "返回创作者"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {en ? "Loading…" : "加载中…"}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ==================== 创作者列表 ==================== */
  const chips: { key: CreatorFilter; label: string; count: number }[] = [
    { key: "all", label: en ? "All" : "全部", count: data.counts.all },
    { key: "verified", label: en ? "Verified" : "已认证", count: data.counts.verified },
    { key: "products", label: en ? "Has products" : "有作品", count: data.counts.products },
  ];

  const searching = query.trim().length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] items-start gap-6 pb-10">
      <div className="min-w-0 flex-1">
        <section className="overflow-hidden rounded-[12px] border border-border bg-card">
          {/* 标题栏 */}
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <h1 className="font-display text-[21px] font-extrabold tracking-tight text-foreground sm:text-[23px]">
                {en ? "Creators" : "创作者"}
              </h1>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {loading
                  ? en
                    ? "Loading…"
                    : "加载中…"
                  : en
                    ? `${data.counts.all} creators · ranked by products`
                    : `${data.counts.all} 位创作者 · 按作品数量排序`}
              </p>
            </div>
            <a
              href={p("/submit/", locale)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-foreground shadow-xs transition-colors hover:brightness-95"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {en ? "Submit" : "提交产品"}
            </a>
          </div>

          {/* 筛选 + 搜索 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
            {chips.map((c) => {
              const on = filter === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setFilter(c.key)}
                  aria-pressed={on}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${
                    on
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border bg-card text-foreground/70 hover:border-foreground/25 hover:text-foreground"
                  }`}
                >
                  {c.label}
                  <span className={`tabular-nums ${on ? "text-accent/70" : "text-muted-foreground"}`}>{c.count}</span>
                </button>
              );
            })}

            <div className="relative ml-auto w-full sm:w-[220px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={en ? "Search creators" : "搜索创作者"}
                aria-label={en ? "Search creators" : "搜索创作者"}
                className="h-8 w-full rounded-full border border-border bg-secondary/30 pl-8 pr-8 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={en ? "Clear" : "清空"}
                  className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* 列表 */}
          {loading || (busy && data.creators.length === 0) ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {en ? "Loading…" : "加载中…"}
            </div>
          ) : data.creators.length === 0 ? (
            <div className="py-16 text-center">
              <UserRound className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground/70">
                {searching
                  ? en
                    ? "No creators match that keyword"
                    : "没有找到匹配的创作者"
                  : filter === "products"
                    ? en
                      ? "No creators with products yet"
                      : "还没有提交过作品的创作者"
                    : filter === "verified"
                      ? en
                        ? "No verified creators yet"
                        : "还没有已认证的创作者"
                      : en
                        ? "No creators yet"
                        : "还没有创作者"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {searching ? (en ? "Try another keyword." : "换个关键词试试。") : en ? "Be the first one." : "成为第一个。"}
              </p>
            </div>
          ) : (
            <>
            <ul className={`divide-y divide-border ${busy ? "opacity-60 transition-opacity" : "transition-opacity"}`}>
              {data.creators.map((c, i) => (
                <li key={c.login}>
                  <button
                    type="button"
                    onClick={() => openUser(c.login)}
                    className="group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary/30 sm:px-5"
                  >
                    <span className="w-6 shrink-0 text-right text-[12px] font-medium tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Avatar name={c.name} src={c.avatar} className="h-10 w-10 text-[15px]" />
                    <div className="min-w-0 flex-1">
                      {/* 手机端把 @handle 换到下一行：名字 + 认证 + 官方标
                          已经占满一行，再塞 handle 会把名字截成 "SolHub …" */}
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[14.5px] font-semibold text-foreground group-hover:text-accent">
                          {c.name}
                        </span>
                        {c.verified && <GoldBadge className="h-[15px] w-[15px] shrink-0" />}
                        {isOfficial(c.login) && (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
                            {en ? "Official" : "官方"}
                          </span>
                        )}
                        <span className="hidden truncate text-[12.5px] text-muted-foreground sm:inline">
                          @{cleanHandle(c.login)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-muted-foreground sm:hidden">
                        @{cleanHandle(c.login)}
                      </p>
                      {c.bio && (
                        <p className="mt-0.5 line-clamp-1 text-[12.5px] leading-5 text-muted-foreground">{c.bio}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.website && (
                        <span className="hidden max-w-[170px] items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground sm:inline-flex">
                          <Globe2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{hostOf(c.website)}</span>
                        </span>
                      )}
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[12px] font-semibold tabular-nums text-foreground"
                        title={en ? "Products" : "作品数"}
                      >
                        <Package className="h-3.5 w-3.5" aria-hidden="true" />
                        {c.productCount}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {/* 名录分页：还剩人就给一个按钮，不自动无限加载，避免一屏几百条把人拖卡 */}
            {data.hasMore && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={moreBusy}
                  className="btn btn-outline !h-9 gap-1.5 px-4 text-xs disabled:opacity-60"
                >
                  {moreBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  {moreBusy
                    ? en
                      ? "Loading…"
                      : "加载中…"
                    : en
                      ? `Load more (${remainingCreators} left)`
                      : `加载更多（还有 ${remainingCreators} 位）`}
                </button>
              </div>
            )}
            </>
          )}
        </section>
      </div>

      {/* 右栏 */}
      <aside className="sticky top-4 hidden w-[290px] shrink-0 space-y-4 xl:block" aria-label={en ? "Sidebar" : "侧栏"}>
        <section className="rounded-[12px] border border-border bg-card px-4 py-4">
          <p className="font-display text-[14px] font-bold text-foreground">{en ? "Your product here" : "把你的作品放上来"}</p>
          <p className="mt-1.5 text-[12.5px] leading-6 text-muted-foreground">
            {en
              ? "Submit a product and it shows up on your creator page, the gallery and search."
              : "提交作品后，它会出现在你的创作者主页、产品列表和搜索结果里。"}
          </p>
          <a
            href={p("/submit/", locale)}
            className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-full bg-accent text-[13px] font-semibold text-accent-foreground transition-colors hover:brightness-95"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {en ? "Submit a product" : "提交产品"}
          </a>
        </section>

        <section className="overflow-hidden rounded-[12px] border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-display text-[14px] font-bold text-foreground">{en ? "About creators" : "关于创作者"}</h2>
          </div>
          <div className="px-4 py-3">
            <p className="text-[12.5px] leading-6 text-muted-foreground">
              {en
                ? "Every registered account has a creator page: what they built, where to find them, and how to follow them. Yellow badges mark verified accounts."
                : "每个注册账号都有一张创作者名片：做过什么、在哪里找到他、怎么关注。橙色勾是人工核验过的账号。"}
            </p>
          </div>
        </section>

        <section className="rounded-[12px] border border-border bg-card px-4 py-3">
          {me ? (
            <a
              href={p(`/world/?u=${encodeURIComponent(me.handle || me.login)}`, locale)}
              className="flex items-center gap-2 text-[13px] font-medium text-foreground transition-colors hover:text-accent"
            >
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {en ? "Go to my page" : "回到我的主页"}
              <ArrowRight className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : (
            <>
              <p className="text-[12.5px] leading-6 text-muted-foreground">
                {en ? "Log in to follow creators and manage your page." : "登录后可以关注创作者、管理自己的主页。"}
              </p>
              <a
                href={p(`/login/?next=${encodeURIComponent("/world/")}`, locale)}
                className="mt-2.5 flex h-9 items-center justify-center rounded-full border border-border bg-card text-[13px] font-semibold text-foreground transition-colors hover:border-accent/40 hover:text-accent"
              >
                {en ? "Log in" : "登录 / 注册"}
              </a>
            </>
          )}
        </section>
      </aside>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-[8px] bg-foreground px-4 py-2 text-xs text-background shadow-lg">
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" />
            {toast}
          </span>
        </div>
      )}
    </div>
  );
}
