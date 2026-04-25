import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 5173; // SENN web app — serves /registry + /addons
const GALLERY_PORT = 5175; // gallery itself (5174 may collide with `pnpm dev`)

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${GALLERY_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // SENN web app — provides /registry/official/index.json + /addons/*.
      command: `pnpm --filter @senn/web exec vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    },
    {
      // Gallery dev server — vite.config.ts proxies /registry + /addons to the web app.
      command: `pnpm vite --port ${GALLERY_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${GALLERY_PORT}`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      env: {
        GALLERY_PROXY_TARGET: `http://127.0.0.1:${WEB_PORT}`,
      },
    },
  ],
});
