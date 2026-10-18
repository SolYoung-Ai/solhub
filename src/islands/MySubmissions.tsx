import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Lock, X, Pencil, Check, MapPin, Link as LinkIcon } from "lucide-react";
import { p } from "@/lib/paths";
import type { Locale } from "@/i18n";

const apiBase = import.meta.env.PUBLIC_SOLHUB_API || "";

interface Profile {
  login: string;
  avatar_url: string;
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
}

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  created_at: string;
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
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [notAuthed, setNotAuthed] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [pf, setPf] = useState({ displayName: "", bio: "", location: "", website: "" });

  useEffect(() => {
    if (!apiBase) { setLoading(false); setNotAuthed(true); return; }
    let meAuthed = false;
    fetch(`${apiBase}/me`, { credentials: "include", cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("unauthed"); return r.json(); })
      .then((d) => { if (d?.user) { meAuthed = true; setProfile(d.user); } })
      .catch(() => { setNotAuthed(true); })
      .finally(() => setLoading(false));
    fetch(`${apiBase}/my-issues`, { credentials: "include", cache: "no-store" })
      .then((r) => {
        if (r.status === 401) { setNotAuthed(true); return []; }
        return r.json();
      })
      .then((data) => setIssues((Array.isArray(data) ? data : []).filter((i) => i.state === "open")))
      .catch(() => {});
  }, []);

  const startEdit = (issue: GhIssue) => {
    setEditing(issue.number);
    setEditTitle(issue.title);
    setEditBody(issue.body || "");
  };

  const saveEdit = async (number: number) => {
    await fetch(`${apiBase}/issues/${number}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, body: editBody }),
    });
    setEditing(null);
    // reload
    const r = await fetch(`${apiBase}/my-issues`, { credentials: "include" });
    setIssues(await r.json());
  };

  const closeIssue = async (number: number) => {
    await fetch(`${apiBase}/issues/${number}/close`, {
      method: "POST",
      credentials: "include",
    });
    setIssues((prev) => prev.filter((i) => i.number !== number));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {en ? "Loading…" : "加载中…"}
      </div>
    );
  }

  if (notAuthed) {
    return (
      <div className="py-20 text-center">
        <Lock className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-4 text-sm text-muted-foreground">
          {en ? "Please log in with GitHub to view your submissions." : "请用 GitHub 登录后查看你的提交。"}
        </p>
        <a href={`${apiBase}/auth`} className="btn btn-accent mt-6 !h-10 px-6">
          GitHub {en ? "Login" : "登录"}
        </a>
      </div>
    );
  }

  return (
    <div className="py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {en ? "My submissions" : "我的提交"}
      </h1>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {en ? "Manage the products and tools you've submitted to SolHub." : "管理你提交到 SolHub 的产品和工具。"}
        </p>
        <div className="flex items-center gap-2">
          {profile?.login && (
            <a
              href={`https://github.com/SolYoung-Ai/solhub/issues?q=is%3Aissue+author%3A${encodeURIComponent(profile.login)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline !h-8 gap-1.5 px-4 text-xs text-muted-foreground hover:text-foreground"
            >
              GitHub {en ? "记录" : "记录"} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            onClick={() => { window.location.href = `${apiBase}/logout?redirect=https://solyoung.top/solhub/`; }}
            className="btn btn-outline !h-8 px-4 text-xs text-muted-foreground hover:text-destructive"
          >
            {en ? "Logout" : "退出登录"}
          </button>
        </div>
      </div>

      {/* Profile card */}
      {profile && (
        <div className="card mt-6 p-5">
          {!editingProfile ? (
            <div className="flex items-start gap-4">
              <img src={profile.avatar_url} alt="" className="h-14 w-14 rounded-full border border-border" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-bold text-foreground">
                    {profile.displayName || profile.login}
                  </h2>
                  <span className="text-xs text-muted-foreground">@{profile.login}</span>
                </div>
                {profile.bio && <p className="mt-1 text-sm text-foreground/70">{profile.bio}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {profile.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{profile.location}</span>}
                  {profile.website && <a href={profile.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><LinkIcon className="h-3 w-3" />{profile.website.replace(/^https?:\/\//, "")}</a>}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <img src={profile.avatar_url} alt="" className="h-12 w-12 rounded-full border border-border" />
                <span className="text-xs text-muted-foreground">@{profile.login}</span>
              </div>
              <input value={pf.displayName} onChange={(e) => setPf({ ...pf, displayName: e.target.value })} className="input w-full" placeholder={en ? "Display name" : "昵称"} />
              <textarea value={pf.bio} onChange={(e) => setPf({ ...pf, bio: e.target.value })} rows={2} className="input w-full resize-y" placeholder={en ? "Short bio" : "个人简介"} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={pf.location} onChange={(e) => setPf({ ...pf, location: e.target.value })} className="input w-full" placeholder={en ? "City" : "所在城市"} />
                <input value={pf.website} onChange={(e) => setPf({ ...pf, website: e.target.value })} className="input w-full" placeholder={en ? "Website" : "个人网站"} />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const r = await fetch(`${apiBase}/profile`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pf) });
                    const d = await r.json();
                    setProfile({ ...profile, ...d });
                    setEditingProfile(false);
                  }}
                  className="btn btn-accent !h-8 gap-1.5 px-4 text-xs"
                >
                  <Check className="h-3 w-3" /> {en ? "Save" : "保存"}
                </button>
                <button onClick={() => setEditingProfile(false)} className="btn btn-outline !h-8 px-4 text-xs">
                  {en ? "Cancel" : "取消"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {issues.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          {en ? "No submissions yet. " : "还没有提交。"}
          <a href={p("/submit/", locale)} className="text-accent underline-offset-2 hover:underline">
            {en ? "Submit your first product" : "提交第一个产品"}
          </a>
        </p>
      ) : (
        <ul className="mt-6 grid gap-4">
          {issues.map((issue) => {
            const f = parseBody(issue.body);
            const name = f["产品提交"] || issue.title.replace(/^\[SolHub\]\s*产品提交：/, "");
            const editingThis = editing === issue.number;
            return (
              <li key={issue.number} className="card p-5">
                {editingThis ? (
                  <div className="space-y-3">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="input w-full"
                      placeholder="Title"
                    />
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={8}
                      className="input w-full resize-y"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(issue.number)} className="btn btn-accent !h-8 px-4 text-xs">
                        {en ? "Save" : "保存"}
                      </button>
                      <button onClick={() => setEditing(null)} className="btn btn-outline !h-8 px-4 text-xs">
                        {en ? "Cancel" : "取消"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
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
                          {f["官网 URL"] && (
                            <a href={f["官网 URL"]} target="_blank" rel="noopener noreferrer" className="btn btn-outline !h-7 gap-1.5 px-3 text-xs">
                              {en ? "Visit" : "访问"} <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !h-7 px-3 text-xs">
                            GitHub
                          </a>
                          <button onClick={() => startEdit(issue)} className="btn btn-outline !h-7 px-3 text-xs">
                            {en ? "Edit" : "编辑"}
                          </button>
                          <button
                            onClick={() => { if (confirm(en ? "Delete this submission?" : "确定删除这条提交？")) closeIssue(issue.number); }}
                            className="btn btn-outline !h-7 px-3 text-xs text-destructive hover:bg-destructive/10"
                          >
                            {en ? "Delete" : "删除"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
