import type { Post } from "../types";
import { processImage } from "./imageResize";

interface CreateResponse {
  id: string;
  dateTaken: string;
  fullKey: string;
  thumbKey: string;
  uploadFull: string;
  uploadThumb: string;
  uploadHeaders: Record<string, string>;
}

async function postJson<T>(
  op: string,
  token: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`/api/${op}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `request failed (${res.status})`);
  }
  return data as T;
}

export interface NewPostInput {
  file: File;
  blurb: string;
  location: string;
  dateTaken: string;
}

export interface PublishResult {
  slug: string;
  url: string;
}

/**
 * Full publish flow: resize → presign → upload images → finalize.
 */
export async function publishPost(
  token: string,
  input: NewPostInput,
  onProgress?: (msg: string) => void,
): Promise<PublishResult> {
  onProgress?.("Resizing image…");
  const { full, thumb } = await processImage(input.file);

  onProgress?.("Requesting upload…");
  const created = await postJson<CreateResponse>("create", token, {
    dateTaken: input.dateTaken,
  });

  onProgress?.("Uploading image…");
  await Promise.all([
    putBlob(created.uploadFull, full.blob, created.uploadHeaders),
    putBlob(created.uploadThumb, thumb.blob, created.uploadHeaders),
  ]);

  onProgress?.("Publishing…");
  const result = await postJson<{ slug: string; url: string }>(
    "finalize",
    token,
    {
      id: created.id,
      blurb: input.blurb,
      location: input.location,
      dateTaken: created.dateTaken,
      width: full.width,
      height: full.height,
    },
  );

  return { slug: result.slug, url: result.url };
}

export interface EditPostInput {
  id: string;
  location: string;
  blurb: string;
  dateTaken: string;
}

export async function editPost(
  token: string,
  input: EditPostInput,
): Promise<void> {
  await postJson("edit", token, input);
}

export async function deletePost(token: string, id: string): Promise<void> {
  await postJson("delete", token, { id });
}

/** Public, best-effort view beacon (no auth). */
export function recordView(id: string): void {
  try {
    fetch("/api/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics is best-effort */
  }
}

/** Owner-only: fetch view counts keyed by post id. */
export async function getViews(
  token: string,
): Promise<Record<string, number>> {
  const res = await postJson<{ views: Record<string, number> }>(
    "views",
    token,
    {},
  );
  return res.views ?? {};
}

async function putBlob(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
): Promise<void> {
  const res = await fetch(url, { method: "PUT", headers, body: blob });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
}

/**
 * Public read of the feed manifest.
 */
export async function loadPosts(): Promise<Post[]> {
  const res = await fetch("/data/posts.json", { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}
