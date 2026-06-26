import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SiteConfig } from "../types";
import {
  decodeEmail,
  getCachedToken,
  renderSignIn,
  signOut,
} from "../lib/googleAuth";
import { publishPost } from "../lib/api";

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
    </div>
  );
}
