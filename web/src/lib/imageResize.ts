export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface ProcessedImages {
  full: ResizedImage;
  thumb: ResizedImage;
}

const FULL_MAX = 2000;
const THUMB_MAX = 600;
const FULL_QUALITY = 0.85;
const THUMB_QUALITY = 0.8;

/**
 * Decode a (possibly HEIC, on iOS Safari) image file applying EXIF orientation,
 * then produce a web-sized JPEG and a thumbnail JPEG entirely client-side. This
 * keeps large phone photos out of the Lambda and avoids server image tooling.
 */
export async function processImage(file: File): Promise<ProcessedImages> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const full = await renderJpeg(bitmap, FULL_MAX, FULL_QUALITY);
    const thumb = await renderJpeg(bitmap, THUMB_MAX, THUMB_QUALITY);
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}

async function renderJpeg(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<ResizedImage> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("failed to encode JPEG");
  return { blob, width, height };
}
