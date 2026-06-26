import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Post, SiteConfig } from "../types";
import {
  decodeEmail,
  getCachedToken,
  renderSignIn,
  signOut,
} from "../lib/googleAuth";
import {
  deletePost,
  editPost,
  getViews,
  loadPosts,
  publishPost,
} from "../lib/api";
import { formatDate } from "../lib/format";

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function Admin({ config }: { config: SiteConfig }) {
  const [token, setToken] = useState<string | null>(getCachedToken());
  const signInRef = useRef<HTMLDivElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blurb, setBlurb] = useState("");
  const [location, setLocation] = useState("");
  const [dateTaken, setDateTaken] = useState(today());

  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Render the Google button until signed in.
  useEffect(() => {
    if (token || !signInRef.current || !config.googleClientId) return;
    renderSignIn(signInRef.current, config.googleClientId).then(setToken);
  }, [token, config.googleClientId]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // In local dev with no OAuth configured, allow a bypass so the upload flow can
  // be exercised against the mock backend. Never reachable in production (a real
  // googleClientId is always written to /site-config.json on deploy).
  const devMode = import.meta.env.DEV && !config.googleClientId;

  if (!config.googleClientId && !devMode) {
    return (
      <div className="page admin">
        <p className="muted">
          Google sign-in isn’t configured yet (missing client id).
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="page admin">
        <h1>Sign in</h1>
        {devMode ? (
          <>
            <p className="muted">Dev mode — no Google OAuth configured.</p>
            <button className="primary" onClick={() => setToken("dev-token")}>
              Continue (dev)
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Sign in with your owner Google account to post.
            </p>
            <div ref={signInRef} />
          </>
        )}
      </div>
    );
  }

  const email = decodeEmail(token);

  async function onPublish(e: FormEvent) {
    e.preventDefault();
    if (!file || !token) return;
    setBusy(true);
    setPublishedUrl(null);
    try {
      const result = await publishPost(
        token,
        { file, blurb, location, dateTaken },
        setStatus,
      );
      setStatus("Published!");
      // result.url may be absolute (Lambda) or relative (local mock); resolve
      // against the current origin either way and show the canonical link.
      const u = new URL(result.url, window.location.origin);
      setPublishedUrl(window.location.origin + u.pathname);
      setFile(null);
      setBlurb("");
      setLocation("");
      setDateTaken(today());
      setReload((n) => n + 1);
    } catch (err: any) {
      setStatus(`Error: ${err?.message || "failed"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page admin">
      <header className="admin-header">
        <h1>New painting</h1>
        <span className="muted">
          {email}{" "}
          <button
            className="link-btn"
            onClick={() => {
              signOut();
              setToken(null);
            }}
          >
            sign out
          </button>
        </span>
      </header>

      <form className="admin-form" onSubmit={onPublish}>
        <label className="field">
          <span>Photo</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {preview && <img className="preview" src={preview} alt="preview" />}

        <label className="field">
          <span>Location</span>
          <input
            type="text"
            value={location}
            maxLength={120}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Blurb</span>
          <textarea
            value={blurb}
            maxLength={280}
            rows={3}
            onChange={(e) => setBlurb(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={dateTaken}
            onChange={(e) => setDateTaken(e.target.value)}
          />
        </label>

        <button className="primary" type="submit" disabled={busy || !file}>
          {busy ? "Working…" : "Publish"}
        </button>
      </form>

      {status && <p className="status">{status}</p>}
      {publishedUrl && (
        <div className="published">
          <a href={publishedUrl}>{publishedUrl}</a>
          <button
            className="link-btn"
            onClick={() => navigator.clipboard?.writeText(publishedUrl)}
          >
            copy link
          </button>
        </div>
      )}

      <ManagePosts token={token} reload={reload} />
    </div>
  );
}

function ManagePosts({ token, reload }: { token: string; reload: number }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [views, setViews] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ location: "", blurb: "", dateTaken: "" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    loadPosts().then(setPosts);
    getViews(token)
      .then(setViews)
      .catch(() => setViews({}));
  }, [reload, token]);

  function startEdit(p: Post) {
    setEditingId(p.id);
    setDraft({ location: p.location, blurb: p.blurb, dateTaken: p.dateTaken });
    setMsg(null);
  }

  async function save(id: string) {
    setBusyId(id);
    setMsg(null);
    try {
      await editPost(token, { id, ...draft });
      // optimistic local update (avoids a stale-cache refetch race)
      setPosts(
        (cur) =>
          cur?.map((p) => (p.id === id ? { ...p, ...draft } : p)) ?? cur,
      );
      setEditingId(null);
    } catch (e: any) {
      setMsg(`Error: ${e?.message || "failed to save"}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p: Post) {
    if (
      !window.confirm(
        `Delete this post${p.location ? ` (${p.location})` : ""}? This can't be undone.`,
      )
    )
      return;
    setBusyId(p.id);
    setMsg(null);
    try {
      await deletePost(token, p.id);
      setPosts((cur) => cur?.filter((x) => x.id !== p.id) ?? cur);
    } catch (e: any) {
      setMsg(`Error: ${e?.message || "failed to delete"}`);
    } finally {
      setBusyId(null);
    }
  }

  if (posts === null)
    return (
      <section className="manage">
        <h2>Your posts</h2>
        <p className="muted">Loading…</p>
      </section>
    );

  return (
    <section className="manage">
      <h2>Your posts</h2>
      {msg && <p className="status">{msg}</p>}
      {posts.length === 0 && <p className="muted">No posts yet.</p>}
      <ul className="manage-list">
        {posts.map((p) => (
          <li className="manage-item" key={p.id}>
            <img className="manage-thumb" src={`/${p.image.thumb}`} alt="" />
            {editingId === p.id ? (
              <div className="manage-edit">
                <label className="field">
                  <span>Location</span>
                  <input
                    type="text"
                    value={draft.location}
                    maxLength={120}
                    onChange={(e) =>
                      setDraft({ ...draft, location: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Blurb</span>
                  <textarea
                    value={draft.blurb}
                    maxLength={280}
                    rows={3}
                    onChange={(e) =>
                      setDraft({ ...draft, blurb: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={draft.dateTaken}
                    onChange={(e) =>
                      setDraft({ ...draft, dateTaken: e.target.value })
                    }
                  />
                </label>
                <div className="manage-actions">
                  <button
                    className="primary"
                    disabled={busyId === p.id}
                    onClick={() => save(p.id)}
                  >
                    {busyId === p.id ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => setEditingId(null)}
                  >
                    cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="manage-body">
                {p.location && <p className="loc">{p.location}</p>}
                {p.blurb && <p className="blurb">{p.blurb}</p>}
                <p className="date muted">
                  {formatDate(p.dateTaken)} · {views[p.id] ?? 0} view
                  {(views[p.id] ?? 0) === 1 ? "" : "s"}
                </p>
                <div className="manage-actions">
                  <button className="link-btn" onClick={() => startEdit(p)}>
                    edit
                  </button>
                  <button
                    className="link-btn"
                    disabled={busyId === p.id}
                    onClick={() => remove(p)}
                  >
                    {busyId === p.id ? "…" : "delete"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
