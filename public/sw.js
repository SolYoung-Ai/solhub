/* ============================================================
   SolHub Service Worker
   ------------------------------------------------------------
   只做两件事：让「装到桌面的应用」能秒开、断网也能看已读过的页面。
   不做后台同步、不做推送、不碰接口请求（登录态必须永远走网络）。

   缓存分三层：
   - STATIC：安装时预取的壳（首页 / Skill 库 / manifest / 图标）
   - PAGES ：访问过的 HTML，网络优先，断网时兜底
   - ASSETS：带内容哈希的 _astro 资源、图标、数据快照、字体，缓存优先
   ============================================================ */

const VERSION = "v1";
const STATIC = `solhub-static-${VERSION}`;
const PAGES = `solhub-pages-${VERSION}`;
const ASSETS = `solhub-assets-${VERSION}`;

/* 预取失败不能让整个安装失败（某个文件 404 时 addAll 会全盘 reject），
   所以逐个 add 并各自吞掉异常 */
const PRECACHE = [
  "/",
  "/skills/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/app-192.png",
  "/icons/app-512.png",
  "/solhub-mark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (e) {
            /* 单个失败忽略 */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = [STATIC, PAGES, ASSETS];
      await Promise.all(
        keys.filter((k) => k.startsWith("solhub-") && !keep.includes(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

/** 接口请求一律不缓存：登录、会话、验证码必须实时 */
function isApiRequest(url) {
  return url.pathname.startsWith("/api/") || /tcloudbase\.com$/.test(url.hostname);
}

/** 带哈希或快照版本号的资源，内容不会变，可以永不回源校验 */
function isImmutable(url) {
  return (
    /\/(_astro|icons|data|fonts)\//.test(url.pathname) ||
    /\.(?:js|css|png|jpe?g|svg|webp|woff2?|json)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (isApiRequest(url)) return;
  if (url.pathname === "/sw.js") return;

  /* 页面导航：网络优先，保证看到的是最新内容；断网才用缓存 */
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const cache = await caches.open(PAGES);
            cache.put(req, res.clone());
          }
          return res;
        } catch (e) {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          /* 没缓存过的页面：给一页专门的离线页，而不是把首页塞到别的 URL 下
             （用户会以为自己打开了 /join/，内容却是首页） */
          const offline = await caches.match("/offline.html");
          if (offline) return offline;
          return new Response(
            "SolHub 当前离线，且这个页面还没有被缓存过。\nSolHub is offline and this page has not been cached yet.",
            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  /* 字体：跨域，缓存优先，失败就交给网络（不返回空响应，免得页面变丑） */
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return new Response("", { status: 504 });
        }
      })(),
    );
    return;
  }

  /* 其它跨域资源不接管（第三方图片之类，缓存了也没意义） */
  if (url.origin !== self.location.origin) return;

  if (isImmutable(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return new Response("", { status: 504 });
        }
      })(),
    );
  }
});
