import { useEffect, useState } from "react";

/**
 * Minimal client-side router — three routes only, so no need for a dependency.
 * Returns the current pathname and re-renders on history navigation.
 */
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function navigate(to: string): void {
  if (to === window.location.pathname) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Intercept clicks on internal links so navigation stays client-side. */
export function onLinkClick(
  e: React.MouseEvent<HTMLAnchorElement>,
  to: string,
): void {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(to);
}
