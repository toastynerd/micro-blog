import type { SiteConfig } from "../types";

let cached: SiteConfig | null = null;

const FALLBACK: SiteConfig = {
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "",
  siteTitle: "THM Paints",
  siteDescription: "Recent paintings.",
};

/**
 * Site config is written to /site-config.json at deploy time by the CDK stack,
 * so the built bundle is environment-agnostic. Falls back to Vite env vars for
 * local dev.
 */
export async function getSiteConfig(): Promise<SiteConfig> {
  if (cached) return cached;
  let resolved: SiteConfig = FALLBACK;
  try {
    const res = await fetch("/site-config.json", { cache: "no-store" });
    if (res.ok) {
      resolved = { ...FALLBACK, ...(await res.json()) } as SiteConfig;
    }
  } catch {
    /* fall through to defaults */
  }
  cached = resolved;
  return resolved;
}
