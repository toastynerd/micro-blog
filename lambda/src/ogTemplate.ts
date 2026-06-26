import type { Post } from "./types.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a standalone HTML page for a single post with Open Graph / Twitter
 * card meta baked in, so social crawlers (which don't run JS) get a correct
 * preview. The page also loads the SPA bundle and embeds the post as JSON so
 * a real visitor gets an instant first paint, then the app takes over.
 *
 * `spaShell` is the built web/index.html; we inject head tags and a data
 * island into it so the asset URLs stay in sync with the latest build.
 */
export function renderPostPage(args: {
  post: Post;
  siteBaseUrl: string; // https://example.com  (no trailing slash)
  siteTitle: string;
  spaShell: string;
}): string {
  const { post, siteBaseUrl, siteTitle, spaShell } = args;

  const pageUrl = `${siteBaseUrl}/p/${post.slug}/`;
  const imageUrl = `${siteBaseUrl}/${post.image.full}`;
  const title = post.location
    ? `${post.location} — ${siteTitle}`
    : siteTitle;
  const description = post.blurb || siteTitle;

  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(pageUrl)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="${esc(siteTitle)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(pageUrl)}" />`,
    `<meta property="og:image" content="${esc(imageUrl)}" />`,
    `<meta property="og:image:width" content="${post.image.width}" />`,
    `<meta property="og:image:height" content="${post.image.height}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(imageUrl)}" />`,
  ].join("\n    ");

  const dataIsland = `<script>window.__POST__=${JSON.stringify(post).replace(
    /</g,
    "\\u003c",
  )}</script>`;

  // The SPA shell contains a marker comment we replace with per-post head tags,
  // plus we inject the data island right before </head>.
  let html = spaShell;
  if (html.includes("<!--OG-->")) {
    html = html.replace("<!--OG-->", head);
  } else {
    html = html.replace("</head>", `    ${head}\n  </head>`);
  }
  html = html.replace("</head>", `    ${dataIsland}\n  </head>`);
  return html;
}
