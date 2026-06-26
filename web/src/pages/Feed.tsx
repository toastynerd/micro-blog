import { useEffect, useState } from "react";
import type { Post, SiteConfig } from "../types";
import { loadPosts } from "../lib/api";
import { onLinkClick } from "../lib/router";
import { formatDate } from "../lib/format";

export function Feed({ config }: { config: SiteConfig }) {
  const [posts, setPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    document.title = config.siteTitle;
    loadPosts().then(setPosts);
  }, [config.siteTitle]);

  return (
    <div className="page">
      <header className="site-header">
        <h1>{config.siteTitle}</h1>
      </header>

      <main className="feed">
        {posts === null && <p className="muted">Loading…</p>}
        {posts !== null && posts.length === 0 && (
          <p className="muted">No paintings posted yet.</p>
        )}
        {posts?.map((post) => (
          <article className="card" key={post.id}>
            <a
              href={`/p/${post.slug}/`}
              onClick={(e) => onLinkClick(e, `/p/${post.slug}/`)}
            >
              <img
                className="card-img"
                src={`/${post.image.thumb}`}
                width={post.image.width}
                height={post.image.height}
                alt={post.blurb || post.location || "Painting"}
                loading="lazy"
              />
            </a>
            <div className="card-body">
              {post.location && <p className="loc">{post.location}</p>}
              {post.blurb && <p className="blurb">{post.blurb}</p>}
              <p className="date muted">{formatDate(post.dateTaken)}</p>
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}
