import { defineConfig } from "vite";

// In dev/e2e the gallery proxies registry + addon static assets to the SENN
// web app's vite server (default 5173). Production deployments configure
// a real publisher URL via the gallery UI, so this proxy is dev-only.
const PROXY_TARGET = process.env.GALLERY_PROXY_TARGET ?? "http://127.0.0.1:5173";

// Some static hosts serve the gallery from a subpath (e.g.
// https://example.com/senn-gallery/). `GALLERY_BASE` lets the deploy
// step set the public path without code changes; the dev/e2e default
// is "/" so existing tooling keeps working. SENN does not depend on
// any specific static host — set this to whatever subpath your host
// uses (or leave as "/" for root-served deployments).
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
