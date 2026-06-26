import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy options:
//   DEV_MOCK=1            → proxy /api, /data, /images to the local mock backend
//                          (scripts/dev-server.mjs on :5174) for a full offline demo.
//   VITE_API_PROXY=<url>  → proxy only /api to a deployed Lambda Function URL.
export default defineConfig(() => {
  const mockPort = process.env.MOCK_PORT ?? "5174";
  const mock = process.env.DEV_MOCK ? `http://localhost:${mockPort}` : undefined;
  const apiProxy = mock ?? process.env.VITE_API_PROXY;

  const proxy: Record<string, any> = {};
  if (apiProxy) {
    proxy["/api"] = {
      target: apiProxy,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api/, ""),
    };
  }
  if (mock) {
    // The mock also serves the reads the SPA expects.
    proxy["/data"] = { target: mock, changeOrigin: true };
    proxy["/images"] = { target: mock, changeOrigin: true };
  }

  return {
    plugins: [react()],
    server: Object.keys(proxy).length ? { proxy } : undefined,
  };
});
