#!/usr/bin/env node
// Local-only mock of the admin Lambda + S3, for running the site without AWS.
// Stores everything under ./.dev-data (gitignored). Serves the reads the SPA
// needs (/data/posts.json, /images/*) and the write API (/api/*). Auth is
// bypassed in dev. NOT used in production — the real backend is the Lambda.
import http from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, ".dev-data");
const IMAGES = path.join(DATA, "images");
const POSTS = path.join(DATA, "posts.json");
const PORT = Number(process.env.MOCK_PORT) || 5174;

// ---- seed sample content on first run -------------------------------------
// Placeholder photos from Lorem Picsum (deterministic by seed) so the feed
// looks real in local dev. Downloaded once into .dev-data.
async function fetchImage(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const SAMPLES = [
  { id: "2026-06-21-7a3f10", slug: "mount-tamalpais-ca-7a3f10", location: "Mount Tamalpais, CA",
    blurb: "Last light catching the far ridge. Mixed a warm grey I want to remember.",
    dateTaken: "2026-06-21", w: 1600, h: 1100 },
  { id: "2026-06-14-b2c8e5", slug: "big-sur-ca-b2c8e5", location: "Big Sur, CA",
    blurb: "Cliffs dropping into the haze. The ocean kept changing color faster than I could paint it.",
    dateTaken: "2026-06-14", w: 1600, h: 1067 },
  { id: "2026-06-02-19d7a4", slug: "sonoma-hills-ca-19d7a4", location: "Sonoma Hills, CA",
    blurb: "Dry gold everywhere. Worked small and fast before the wind picked up.",
    dateTaken: "2026-06-02", w: 1500, h: 1200 },
  { id: "2026-05-22-c4f0a9", slug: "half-moon-bay-ca-c4f0a9", location: "Half Moon Bay, CA",
    blurb: "Dusk over the water, everything going violet. Stayed out past dinner.",
    dateTaken: "2026-05-22", w: 1200, h: 1500 },
  { id: "2026-05-09-8e1b6d", slug: "muir-woods-ca-8e1b6d", location: "Muir Woods, CA",
    blurb: "Deep in the greens today. Hard to find the light under the canopy.",
    dateTaken: "2026-05-09", w: 1200, h: 1500 },
  { id: "2026-04-27-3fa2cc", slug: "joshua-tree-ca-3fa2cc", location: "Joshua Tree, CA",
    blurb: "Red rock and long shadows. The heat made the whole valley shimmer.",
    dateTaken: "2026-04-27", w: 1600, h: 1067 },
  { id: "2026-04-12-d6093b", slug: "lake-tahoe-ca-d6093b", location: "Lake Tahoe, CA",
    blurb: "Snow still on the peaks. Cold hands, but the blues were worth it.",
    dateTaken: "2026-04-12", w: 1600, h: 1100 },
  { id: "2026-03-20-a07e52", slug: "napa-valley-ca-a07e52", location: "Napa Valley, CA",
    blurb: "First warm day. River running high and the hills finally green.",
    dateTaken: "2026-03-20", w: 1600, h: 1067 },
  { id: "2026-02-28-f51c8a", slug: "point-reyes-ca-f51c8a", location: "Point Reyes, CA",
    blurb: "Storm rolling in off the coast. Painted quick under a grey sky.",
    dateTaken: "2026-02-28", w: 1400, h: 1200 },
];

async function seedIfEmpty() {
  fs.mkdirSync(IMAGES, { recursive: true });
  if (fs.existsSync(POSTS)) return;
  const posts = [];
  for (const s of SAMPLES) {
    const dir = path.join(IMAGES, s.id);
    fs.mkdirSync(dir, { recursive: true });
    const thumbH = Math.round((s.h / s.w) * 800);
    try {
      const full = await fetchImage(`https://picsum.photos/seed/${s.slug}/${s.w}/${s.h}`);
      const thumb = await fetchImage(`https://picsum.photos/seed/${s.slug}/800/${thumbH}`);
      fs.writeFileSync(path.join(dir, "full.jpg"), full);
      fs.writeFileSync(path.join(dir, "thumb.jpg"), thumb);
    } catch (e) {
      console.warn(`could not fetch image for ${s.slug}: ${e.message}`);
    }
    posts.push({
      id: s.id,
      slug: s.slug,
      blurb: s.blurb,
      location: s.location,
      dateTaken: s.dateTaken,
      createdAt: new Date().toISOString(),
      image: {
        full: `images/${s.id}/full.jpg`,
        thumb: `images/${s.id}/thumb.jpg`,
        width: s.w,
        height: s.h,
      },
    });
  }
  fs.writeFileSync(POSTS, JSON.stringify(posts, null, 2));
  console.log(`seeded ${posts.length} sample paintings into .dev-data`);
}

// ---- helpers --------------------------------------------------------------
const readPosts = () =>
  fs.existsSync(POSTS) ? JSON.parse(fs.readFileSync(POSTS, "utf8")) : [];
const writePosts = (p) => fs.writeFileSync(POSTS, JSON.stringify(p, null, 2));
const rand6 = () => randomBytes(4).toString("hex").slice(0, 6);
const slugify = (s) =>
  (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    "painting");

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const CONTENT_TYPES = {
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
};

// ---- request handler ------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // --- reads ---
  if (req.method === "GET" && p === "/data/posts.json") {
    return send(res, 200, readPosts(), { "cache-control": "no-store" });
  }
  if (req.method === "GET" && p.startsWith("/images/")) {
    const file = path.join(DATA, decodeURIComponent(p));
    if (!file.startsWith(IMAGES) || !fs.existsSync(file))
      return send(res, 404, { error: "not found" });
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(file)] || "application/octet-stream",
    });
    return fs.createReadStream(file).pipe(res);
  }

  // --- uploads (presigned stand-in) ---
  if (req.method === "PUT" && p === "/upload") {
    const key = url.searchParams.get("key") || "";
    const file = path.join(DATA, key);
    if (!file.startsWith(IMAGES)) return send(res, 400, { error: "bad key" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await readBody(req));
    return send(res, 200, { ok: true });
  }

  // --- write API (auth bypassed in dev) ---
  if (req.method === "POST") {
    const op = p.replace(/^\/?(api\/)?/, "").replace(/\/$/, "");
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");

    if (op === "create") {
      const dateTaken = /^\d{4}-\d{2}-\d{2}$/.test(body.dateTaken)
        ? body.dateTaken
        : new Date().toISOString().slice(0, 10);
      const id = `${dateTaken}-${rand6()}`;
      return send(res, 200, {
        id,
        dateTaken,
        fullKey: `images/${id}/full.jpg`,
        thumbKey: `images/${id}/thumb.jpg`,
        uploadFull: `/api/upload?key=images/${id}/full.jpg`,
        uploadThumb: `/api/upload?key=images/${id}/thumb.jpg`,
        uploadHeaders: { "content-type": "image/jpeg" },
      });
    }

    if (op === "finalize") {
      const id = String(body.id || "");
      const posts = readPosts();
      const slug = `${slugify(body.location || body.blurb || "painting")}-${id.slice(-6)}`;
      posts.unshift({
        id,
        slug,
        blurb: String(body.blurb || "").slice(0, 280),
        location: String(body.location || "").slice(0, 120),
        dateTaken: body.dateTaken || id.slice(0, 10),
        createdAt: new Date().toISOString(),
        image: {
          full: `images/${id}/full.jpg`,
          thumb: `images/${id}/thumb.jpg`,
          width: Number(body.width) || 1600,
          height: Number(body.height) || 1200,
        },
      });
      writePosts(posts);
      return send(res, 200, { ok: true, id, slug, url: `/p/${slug}/` });
    }

    if (op === "delete") {
      const id = String(body.id || "");
      const posts = readPosts();
      const post = posts.find((x) => x.id === id);
      writePosts(posts.filter((x) => x.id !== id));
      if (post) fs.rmSync(path.join(IMAGES, id), { recursive: true, force: true });
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: `unknown op: ${op}` });
  }

  send(res, 404, { error: "not found" });
});

await seedIfEmpty();
server.listen(PORT, () =>
  console.log(`dev mock backend on http://localhost:${PORT}  (data in .dev-data)`),
);
