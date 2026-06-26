import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { randomBytes } from "node:crypto";
import { bearerFromHeaders, verifyGoogleIdToken } from "./verifyGoogle.js";
import { renderPostPage } from "./ogTemplate.js";
import type { Post, PostList } from "./types.js";

const BUCKET = required("BUCKET");
const DISTRIBUTION_ID = required("DISTRIBUTION_ID");
const SITE_BASE_URL = required("SITE_BASE_URL").replace(/\/$/, "");
const OWNER_EMAIL = required("OWNER_EMAIL").toLowerCase();
const GOOGLE_CLIENT_ID = required("GOOGLE_CLIENT_ID");
const SITE_TITLE = process.env.SITE_TITLE || "THM Paints";

const POSTS_KEY = "data/posts.json";
const SHELL_KEY = "index.html";
const IMAGE_CACHE = "public, max-age=31536000, immutable";
const HTML_CACHE = "public, max-age=60";

const s3 = new S3Client({});
const cf = new CloudFrontClient({});

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "post"
  );
}

function rand6(): string {
  return randomBytes(4).toString("hex").slice(0, 6);
}

async function readPosts(): Promise<PostList> {
  try {
    const out = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: POSTS_KEY }),
    );
    const text = await out.Body!.transformToString();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e: any) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404)
      return [];
    throw e;
  }
}

async function writePosts(posts: PostList): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: POSTS_KEY,
      Body: JSON.stringify(posts),
      ContentType: "application/json",
      CacheControl: HTML_CACHE,
    }),
  );
}

async function readShell(): Promise<string> {
  const out = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: SHELL_KEY }),
  );
  return out.Body!.transformToString();
}

async function invalidate(paths: string[]): Promise<void> {
  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `${Date.now()}-${rand6()}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    }),
  );
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// ---- route handlers -------------------------------------------------------

async function handleCreate(body: any) {
  const dateTaken = isValidDate(body?.dateTaken)
    ? body.dateTaken
    : new Date().toISOString().slice(0, 10);
  const id = `${dateTaken}-${rand6()}`;
  const fullKey = `images/${id}/full.jpg`;
  const thumbKey = `images/${id}/thumb.jpg`;

  const uploadFull = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: fullKey,
      ContentType: "image/jpeg",
      CacheControl: IMAGE_CACHE,
    }),
    { expiresIn: 600 },
  );
  const uploadThumb = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: thumbKey,
      ContentType: "image/jpeg",
      CacheControl: IMAGE_CACHE,
    }),
    { expiresIn: 600 },
  );

  return json(200, {
    id,
    dateTaken,
    fullKey,
    thumbKey,
    uploadFull,
    uploadThumb,
    // The client must send these exact headers on the PUT so the signature matches.
    uploadHeaders: { "content-type": "image/jpeg", "cache-control": IMAGE_CACHE },
  });
}

async function handleFinalize(body: any) {
  const id = String(body?.id || "");
  if (!/^\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/.test(id))
    return json(400, { error: "invalid id" });

  const blurb = String(body?.blurb || "").trim().slice(0, 280);
  const location = String(body?.location || "").trim().slice(0, 120);
  const dateTaken = isValidDate(body?.dateTaken)
    ? body.dateTaken
    : id.slice(0, 10);
  const width = Number(body?.width) || 0;
  const height = Number(body?.height) || 0;

  const fullKey = `images/${id}/full.jpg`;
  const thumbKey = `images/${id}/thumb.jpg`;
  if (!(await objectExists(fullKey)) || !(await objectExists(thumbKey)))
    return json(409, { error: "images not uploaded yet" });

  const posts = await readPosts();
  if (posts.some((p) => p.id === id))
    return json(409, { error: "post already finalized" });

  const slugBase = slugify(location || blurb || "painting");
  const slug = `${slugBase}-${id.slice(-6)}`;

  const post: Post = {
    id,
    slug,
    blurb,
    location,
    dateTaken,
    createdAt: new Date().toISOString(),
    image: { full: fullKey, thumb: thumbKey, width, height },
  };

  // newest-first
  posts.unshift(post);
  await writePosts(posts);

  // render the per-post OG page
  const shell = await readShell();
  const html = renderPostPage({
    post,
    siteBaseUrl: SITE_BASE_URL,
    siteTitle: SITE_TITLE,
    spaShell: shell,
  });
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `p/${slug}/index.html`,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      CacheControl: HTML_CACHE,
    }),
  );

  await invalidate(["/", "/index.html", "/data/posts.json", `/p/${slug}/*`]);

  return json(200, { ok: true, id, slug, url: `${SITE_BASE_URL}/p/${slug}/` });
}

async function handleDelete(body: any) {
  const id = String(body?.id || "");
  if (!/^\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/.test(id))
    return json(400, { error: "invalid id" });

  const posts = await readPosts();
  const post = posts.find((p) => p.id === id);
  if (!post) return json(404, { error: "not found" });

  const remaining = posts.filter((p) => p.id !== id);
  await writePosts(remaining);

  await Promise.all([
    s3.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: post.image.full }),
    ),
    s3.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: post.image.thumb }),
    ),
    s3.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: `p/${post.slug}/index.html`,
      }),
    ),
  ]);

  await invalidate(["/", "/index.html", "/data/posts.json", `/p/${post.slug}/*`]);

  return json(200, { ok: true });
}

function isValidDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---- entrypoint -----------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext?.http?.method ?? "GET";
  const rawPath = event.rawPath ?? "/";
  // CloudFront forwards /api/<op>; Function URL direct gives /<op>.
  const op = rawPath.replace(/^\/?(api\/)?/, "").replace(/\/$/, "");

  if (method === "OPTIONS") return { statusCode: 204 };
  if (method !== "POST") return json(405, { error: "method not allowed" });

  // --- auth: every write requires a valid owner Google token ---
  const token = bearerFromHeaders(
    (event.headers ?? {}) as Record<string, string | undefined>,
  );
  if (!token) return json(401, { error: "missing bearer token" });

  let user;
  try {
    user = await verifyGoogleIdToken(token, GOOGLE_CLIENT_ID);
  } catch (e) {
    return json(401, { error: "invalid token" });
  }
  if (!user.emailVerified || user.email !== OWNER_EMAIL)
    return json(403, { error: "not authorized" });

  let body: any = {};
  if (event.body) {
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid json body" });
    }
  }

  try {
    switch (op) {
      case "create":
        return await handleCreate(body);
      case "finalize":
        return await handleFinalize(body);
      case "delete":
        return await handleDelete(body);
      default:
        return json(404, { error: `unknown op: ${op}` });
    }
  } catch (e: any) {
    console.error("handler error", e);
    return json(500, { error: "internal error" });
  }
};
