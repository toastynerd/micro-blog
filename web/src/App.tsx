import { useEffect, useState } from "react";
import { usePath } from "./lib/router";
import { getSiteConfig } from "./lib/config";
import type { SiteConfig } from "./types";
import { Feed } from "./pages/Feed";
import { PostPage } from "./pages/PostPage";
import { Admin } from "./pages/Admin";

export function App() {
  const path = usePath();
  const [config, setConfig] = useState<SiteConfig | null>(null);

  useEffect(() => {
    getSiteConfig().then(setConfig);
  }, []);

  if (!config) return null;

  if (path === "/admin" || path === "/admin/") {
    return <Admin config={config} />;
  }

  const postMatch = /^\/p\/([^/]+)\/?$/.exec(path);
  if (postMatch) {
    return <PostPage slug={decodeURIComponent(postMatch[1])} config={config} />;
  }

  return <Feed config={config} />;
}
