import { defineConfig } from "vite";

// In dev/e2e the gallery proxies registry + addon static assets to the SENN
// web app's vite server (default 5173). Production deployments configure
// a real publisher URL via the gallery UI, so this proxy is dev-only.
const PROXY_TARGET = process.env.GALLERY_PROXY_TARGET ?? "http://127.0.0.1:5173";

// GitHub Pages serves at https://<user>.github.io/<repo>/. `GALLERY_BASE`
// lets the deploy workflow set the public path without code changes; the
// dev/e2e default is "/" so existing tooling keeps working.
const BASE = process.env.GALLERY_BASE ?? "/";

export default defineConfig({
  base: BASE,
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      "/registry": PROXY_TARGET,
      "/addons": PROXY_TARGET,
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
