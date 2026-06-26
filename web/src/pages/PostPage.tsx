import { useEffect, useState } from "react";
import type { Post, SiteConfig } from "../types";
import { loadPosts, recordView } from "../lib/api";
import { onLinkClick } from "../lib/router";
import { formatDate } from "../lib/format";

declare global {
  interface Window {
    __POST__?: Post;
  }
}

export function PostPage({
  slug,
  config,
}: {
  slug: string;
  config: SiteConfig;
}) {
  // Per-post pages are pre-rendered with the post embedded for instant paint.
  const [post, setPost] = useState<Post | null>(
    window.__POST__?.slug === slug ? window.__POST__ : null,
  );
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (post) {
      document.title = post.location
        ? `${post.location} — ${config.siteTitle}`
        : config.siteTitle;
      return;
    }
    loadPosts().then((posts) => {
      const found = posts.find((p) => p.slug === slug);
      if (found) setPost(found);
      else setNotFound(true);
    });
  }, [slug, post, config.siteTitle]);

  // Record one view per post per session (rough, human-only since it's JS).
  useEffect(() => {
    if (!post) return;
    const key = `viewed:${post.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    recordView(post.id);
  }, [post]);

  if (notFound) {
    return (
      <div className="page">
        <p className="muted">Painting not found.</p>
        <a href="/" onClick={(e) => onLinkClick(e, "/")}>
          ← Back to all paintings
        </a>
      </div>
    );
  }

  if (!post) return <div className="page" />;

  return (
    <div className="page post-page">
      <a className="back" href="/" onClick={(e) => onLinkClick(e, "/")}>
        ← {config.siteTitle}
      </a>
      <img
        className="post-img"
        src={`/${post.image.full}`}
        width={post.image.width}
        height={post.image.height}
        alt={post.blurb || post.location || "Painting"}
      />
      <div className="post-meta">
        {post.location && <h2 className="loc">{post.location}</h2>}
        {post.blurb && <p className="blurb">{post.blurb}</p>}
        <p className="date muted">{formatDate(post.dateTaken)}</p>
        <button
          className="share"
          onClick={() => {
            const url = window.location.href;
            if (navigator.share) {
              navigator.share({ url, title: config.siteTitle }).catch(() => {});
            } else {
              navigator.clipboard?.writeText(url);
            }
          }}
        >
          Share
        </button>
      </div>
    </div>
  );
}
