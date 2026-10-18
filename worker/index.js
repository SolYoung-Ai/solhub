/**
 * SolHub Auth Proxy — Cloudflare Worker
 */

const REPO = "SolYoung-Ai/solhub";
const OAUTH_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://solyoung.top",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url, ...corsHeaders } });
}

function getTokenFromCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)solhub_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/auth") {
      const params = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: env.WORKER_URL + "/callback",
        scope: "public_repo",
      });
      return redirect(`${OAUTH_URL}?${params}`);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return json({ error: "missing code" }, 400);

      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return json({ error: "token exchange failed" }, 400);

      const cookie = `solhub_token=${encodeURIComponent(tokenData.access_token)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=2592000`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://solyoung.top/solhub/my-submissions/",
          "Set-Cookie": cookie,
          ...corsHeaders,
        },
      });
    }

    if (url.pathname === "/me") {
      const token = getTokenFromCookie(request);
      if (!token) return json({ authenticated: false }, 401);
      const res = await fetch(`${API}/user`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "SolHub" },
      });
      const user = await res.json();
      const login = user.login;
      let profile = {};
      if (env.PROFILES) {
        const raw = await env.PROFILES.get(`profile:${login}`);
        if (raw) { try { profile = JSON.parse(raw); } catch (e) {} }
      }
      return json({ authenticated: true, user: { login: user.login, avatar_url: user.avatar_url, ...profile } });
    }

    // Profile: GET returns current user profile, PUT updates it
    if (url.pathname === "/profile") {
      const token = getTokenFromCookie(request);
      if (!token) return json({ error: "not authenticated" }, 401);
      const userRes = await fetch(`${API}/user`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "SolHub" },
      });
      const ghUser = await userRes.json();
      if (!ghUser.login) return json({ error: "cannot get user" }, 400);
      const key = `profile:${ghUser.login}`;

      if (request.method === "GET") {
        let profile = {};
        if (env.PROFILES) {
          const raw = await env.PROFILES.get(key);
          if (raw) { try { profile = JSON.parse(raw); } catch (e) {} }
        }
        return json({ login: ghUser.login, avatar_url: ghUser.avatar_url, ...profile });
      }

      if (request.method === "PUT") {
        const body = await request.json();
        const allowed = {
          displayName: String(body.displayName || "").slice(0, 40),
          bio: String(body.bio || "").slice(0, 200),
          location: String(body.location || "").slice(0, 40),
          website: String(body.website || "").slice(0, 200),
        };
        if (env.PROFILES) {
          await env.PROFILES.put(key, JSON.stringify(allowed));
        }
        return json({ ok: true, ...allowed });
      }
    }

    if (url.pathname === "/logout") {
      const redirectTo = url.searchParams.get("redirect") || "https://solyoung.top/solhub/";
      return new Response(null, {
        status: 302,
        headers: {
          "Set-Cookie": "solhub_token=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
          "Location": redirectTo,
          ...corsHeaders,
        },
      });
    }

    if (url.pathname === "/my-issues") {
      const token = getTokenFromCookie(request);
      if (!token) return json({ authenticated: false }, 401);
      // Get current user login first
      const userRes = await fetch(`${API}/user`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "SolHub" },
      });
      const user = await userRes.json();
      if (!user.login) return json({ error: "cannot get user" }, 400);
      // List issues created by this user
      const res = await fetch(`${API}/repos/${REPO}/issues?creator=${encodeURIComponent(user.login)}&state=open&per_page=50`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "SolHub" },
      });
      const issues = await res.json();
      return json(issues);
    }

    if (url.pathname.startsWith("/issues/") && request.method === "PATCH") {
      const token = getTokenFromCookie(request);
      if (!token) return json({ authenticated: false }, 401);
      const number = url.pathname.split("/")[2];
      const body = await request.text();
      const res = await fetch(`${API}/repos/${REPO}/issues/${number}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "SolHub",
          "Content-Type": "application/json",
        },
        body,
      });
      const data = await res.json();
      return json(data, res.status);
    }

    // Upload icon image: receives base64 PNG, commits to repo icons/ folder
    if (url.pathname === "/upload-icon" && request.method === "POST") {
      const token = getTokenFromCookie(request);
      if (!token) return json({ error: "not authenticated" }, 401);
      const body = await request.json();
      if (!body.dataUrl) return json({ error: "missing dataUrl" }, 400);
      // dataUrl = data:image/png;base64,xxx
      const m = body.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!m) return json({ error: "invalid dataUrl" }, 400);
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const b64 = m[2];
      const filename = `icon-${Date.now()}.${ext}`;
      const path = `icons/${filename}`;
      // Create blob via GitHub API (contents endpoint auto-base64-encodes)
      const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "SolHub",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `add icon ${filename}`,
          content: b64,
        }),
      });
      const data = await res.json();
      if (!data.content) return json({ error: "upload failed", detail: data }, 500);
      // Raw URL
      const rawUrl = `https://raw.githubusercontent.com/${REPO}/main/${path}`;
      return json({ url: rawUrl });
    }

    if (url.pathname.match(/^\/issues\/\d+\/close$/) && request.method === "POST") {
      const token = getTokenFromCookie(request);
      if (!token) return json({ authenticated: false }, 401);
      const number = url.pathname.split("/")[2];
      const res = await fetch(`${API}/repos/${REPO}/issues/${number}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "SolHub",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: "closed" }),
      });
      return json({ ok: true }, res.status);
    }

    if (url.pathname === "/submit" && request.method === "POST") {
      if (!env.GITHUB_PAT) return json({ error: "server not configured" }, 500);
      let data;
      try { data = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
      const f = data.productFields || data;
      const name = String(f.name || "").slice(0, 80);
      if (!name) return json({ error: "产品名称不能为空" }, 400);
      const bodyLines = [
        `## 产品提交：${name}`,
        ``,
        `**一句话介绍**：${f.tagline || f.description || ""}`,
        ``,
        `**详细描述**：`,
        f.description || "",
        ``,
        `**官网 URL**：${f.websiteUrl || ""}`,
        `**分类**：${f.category || ""}`,
        `**标签**：${Array.isArray(f.tags) ? f.tags.join(", ") : (f.tags || "")}`,
        f.iconUrl ? `**图标 URL**：${f.iconUrl}` : "",
        `**开发者 / 团队**：${f.developerName || "匿名"}`,
        f.contact ? `**联系方式**：${f.contact}` : "",
        ``,
        `由 SolHub 投稿表单生成 · ${new Date().toISOString()}`,
      ];
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${API}/repos/${REPO}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          "User-Agent": "SolHub",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `[SolHub] 产品提交：${name}`,
          body: bodyLines.join("\n"),
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const issue = await res.json();
      if (!issue.number) return json({ error: "创建失败", detail: issue }, 500);
      return json({ ok: true, number: issue.number, url: issue.html_url });
    }

    // Check if a URL is reachable
    if (url.pathname === "/check-url" && request.method === "POST") {
      const body = await request.json();
      const targetUrl = String(body.url || "");
      if (!targetUrl) return json({ ok: false, error: "缺少 URL" }, 400);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(targetUrl, {
          method: "HEAD",
          redirect: "follow",
          signal: ctrl.signal,
          headers: { "User-Agent": "SolHub/1.0" },
        });
        clearTimeout(t);
        if (res.ok || res.status === 301 || res.status === 302 || res.status === 403) {
          return json({ ok: true, status: res.status });
        }
        return json({ ok: false, status: res.status, error: `网站返回 ${res.status}` });
      } catch (e) {
        return json({ ok: false, error: "网站无法访问，请检查 URL 是否正确" });
      }
    }

    // Auto-publish a community product: checks URL, then commits to community.json
    if (url.pathname === "/publish" && request.method === "POST") {
      if (!env.GITHUB_PAT) return json({ error: "server not configured" }, 500);
      const token = getTokenFromCookie(request);
      if (!token) return json({ error: "请先登录" }, 401);

      let data;
      try { data = await request.json(); } catch { return json({ error: "invalid json" }, 400); }

      const name = String(data.name || "").slice(0, 80);
      const websiteUrl = String(data.websiteUrl || "");
      if (!name) return json({ error: "产品名称不能为空" }, 400);
      if (!websiteUrl) return json({ error: "官网 URL 不能为空" }, 400);

      // Check URL reachability
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const checkRes = await fetch(websiteUrl, {
          method: "HEAD",
          redirect: "follow",
          signal: ctrl.signal,
          headers: { "User-Agent": "SolHub/1.0" },
        });
        clearTimeout(t);
        if (!checkRes.ok && checkRes.status !== 301 && checkRes.status !== 302) {
          return json({ error: `网站 ${websiteUrl} 返回 ${checkRes.status}，无法收录` }, 400);
        }
      } catch (e) {
        return json({ error: `无法访问 ${websiteUrl}，请确认网站可以正常打开` }, 400);
      }

      // Get user info
      const userRes = await fetch(`${API}/user`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "SolHub" },
      });
      const ghUser = await userRes.json();
      if (!ghUser.login) return json({ error: "登录已过期" }, 401);

      // Read current community.json
      const fileRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json?ref=main`, {
        headers: { Authorization: `Bearer ${env.GITHUB_PAT}`, "User-Agent": "SolHub" },
      });
      const fileData = await fileRes.json();
      let community = [];
      if (fileData.content) {
        try {
          const decoded = atob(fileData.content.replace(/\n/g, ""));
          community = JSON.parse(decoded);
        } catch (e) { community = []; }
      }

      // Build new product entry
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Date.now().toString(36);
      const newProduct = {
        id: slug,
        slug: slug,
        name: name,
        shortDescription: String(data.shortDescription || "").slice(0, 120),
        description: String(data.description || data.shortDescription || "").slice(0, 500),
        websiteUrl: websiteUrl,
        icon: data.iconUrl || "",
        category: String(data.category || "other"),
        tags: Array.isArray(data.tags) ? data.tags.slice(0, 8) : String(data.tags || "").split(",").map(t => t.trim()).filter(Boolean),
        developerName: String(data.developerName || ghUser.login),
        publishedAt: new Date().toISOString().slice(0, 10),
        launchBatch: "Community",
        verificationStatus: "pending",
        verificationMethod: "URL 自动检测通过，待人工复核",
        isDemo: false,
        submittedBy: ghUser.login,
      };

      community.push(newProduct);

      // Write back
      const content = btoa(JSON.stringify(community, null, 2));
      const writeRes = await fetch(`${API}/repos/${REPO}/contents/src/data/community.json`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          "User-Agent": "SolHub",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `community: add ${name} by @${ghUser.login}`,
          content: content,
          sha: fileData.sha,
        }),
      });
      const writeData = await writeRes.json();
      if (!writeData.commit) return json({ error: "写入失败", detail: writeData }, 500);

      return json({ ok: true, product: newProduct, message: "产品已自动收录，等待人工复核" });
    }

    return json({ error: "not found" }, 404);
  },
};
