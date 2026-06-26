import type { PostList } from "./types.js";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(s: string): string {
  // Guard against an accidental CDATA terminator in user text.
  return `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function pubDate(dateTaken: string): string {
  // Treat the date as midday UTC so the day doesn't shift across timezones.
  const d = new Date(`${dateTaken}T12:00:00Z`);
  return isNaN(d.getTime()) ? new Date(0).toUTCString() : d.toUTCString();
}

/**
 * Render an RSS 2.0 feed of the posts (newest first). Each item embeds the
 * painting both as an <enclosure> and inline <img> so feed readers show it.
 */
export function renderFeed(args: {
  posts: PostList;
  siteBaseUrl: string; // no trailing slash
  siteTitle: string;
  siteDescription: string;
}): string {
  const { posts, siteBaseUrl, siteTitle, siteDescription } = args;
  const feedUrl = `${siteBaseUrl}/feed.xml`;

  const items = posts
    .slice(0, 50)
    .map((p) => {
      const url = `${siteBaseUrl}/p/${p.slug}/`;
      const img = `${siteBaseUrl}/${p.image.full}`;
      const title =
        p.location || (p.blurb ? p.blurb.slice(0, 60) : "New painting");
      const bodyParts = [];
      if (p.blurb) bodyParts.push(`<p>${escXml(p.blurb)}</p>`);
      bodyParts.push(`<p><img src="${img}" alt="${escXml(title)}" /></p>`);
      return `    <item>
      <title>${escXml(title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate(p.dateTaken)}</pubDate>
      <description>${cdata(bodyParts.join(""))}</description>
      <enclosure url="${img}" type="image/jpeg" length="0" />
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(siteTitle)}</title>
    <link>${siteBaseUrl}/</link>
    <description>${escXml(siteDescription || siteTitle)}</description>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}
