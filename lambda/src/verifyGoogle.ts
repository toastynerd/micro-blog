import { createRemoteJWKSet, jwtVerify } from "jose";

// Google's public keys for verifying ID tokens (JWKS). Cached/refreshed by jose.
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface VerifiedUser {
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Verify a Google Identity Services ID token (a signed JWT).
 * Checks signature against Google's JWKS, the issuer, and that the audience
 * matches our OAuth client id. Throws if anything is off.
 */
export async function verifyGoogleIdToken(
  token: string,
  audience: string,
): Promise<VerifiedUser> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });

  const email = typeof payload.email === "string" ? payload.email : "";
  if (!email) throw new Error("token has no email claim");

  return {
    email: email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

/**
 * Pull the bearer token out of an Authorization header (case-insensitive).
 */
export function bearerFromHeaders(
  headers: Record<string, string | undefined>,
): string | null {
  const raw =
    headers.authorization ?? headers.Authorization ?? headers.AUTHORIZATION;
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1] : null;
}
