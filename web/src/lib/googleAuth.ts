// Minimal wrapper around Google Identity Services (GIS) for obtaining an ID
// token. We only need to authenticate the single owner, so we use the ID-token
// flow: GIS hands us a signed JWT that the Lambda verifies server-side.

interface GisCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: any;
    __gisResolve?: (token: string) => void;
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
const TOKEN_KEY = "thm_id_token";

let scriptPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load Google Identity"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Render Google's "Sign in with Google" button into `el`. Resolves with the ID
 * token once the user signs in. The token is also cached in sessionStorage.
 */
export async function renderSignIn(
  el: HTMLElement,
  clientId: string,
): Promise<string> {
  await loadGis();
  return new Promise((resolve) => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (resp: GisCredentialResponse) => {
        sessionStorage.setItem(TOKEN_KEY, resp.credential);
        resolve(resp.credential);
      },
      auto_select: false,
      use_fedcm_for_prompt: true,
    });
    window.google.accounts.id.renderButton(el, {
      theme: "outline",
      size: "large",
      text: "signin_with",
    });
  });
}

export function getCachedToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function signOut(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  window.google?.accounts?.id?.disableAutoSelect?.();
}

/**
 * Decode (not verify) a JWT payload — only for showing the signed-in email in
 * the UI. The Lambda does the real verification.
 */
export function decodeEmail(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
