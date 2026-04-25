import { type Page, expect, test } from "@playwright/test";

const SHORT = 7_000;

const PROXIED_REGISTRY_URL = "http://127.0.0.1:5173/registry/official/index.json";

async function seedHostAndRegistry(page: Page): Promise<void> {
  // Pre-seed localStorage so the gallery uses the proxied registry URL
  // (the web app's static mirror) and a known preferred host origin.
  await page.addInitScript((registryUrl) => {
    try {
      localStorage.setItem("senn.gallery.registries", JSON.stringify([{ url: registryUrl }]));
      localStorage.setItem("senn.gallery.host-origin", "http://127.0.0.1:5173");
    } catch {
      /* localStorage may be unavailable on first navigation; addInitScript runs
         before page scripts so this is normally safe. */
    }
  }, PROXIED_REGISTRY_URL);
}

test.describe("Add-on gallery smoke (ADR-0016)", () => {
  test("renders verified add-ons from the proxied official registry", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await seedHostAndRegistry(page);
    await page.goto("/");

    // Status reflects the publisher banner once the registry resolves.
    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });
    // The official registry ships at least the whiteboard add-on.
    const whiteboardCard = page.locator('[data-testid="addon-card-dev.senn.whiteboard"]');
    await expect(whiteboardCard).toBeVisible({ timeout: SHORT });
    await expect(whiteboardCard).toContainText("verified");

    await ctx.close();
  });

  test("free-text search filters cards by name and description", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await seedHostAndRegistry(page);
    await page.goto("/");

    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });

    // Filter for whiteboard — the avatar-presence card should disappear.
    await page.locator('[data-testid="filter-q"]').fill("whiteboard");
    await expect(page.locator('[data-testid="addon-card-dev.senn.whiteboard"]')).toBeVisible();
    await expect(page.locator('[data-testid="addon-card-dev.senn.avatar-presence"]')).toHaveCount(
      0,
    );

    // Clear → all cards back.
    await page.locator('[data-testid="filter-q"]').fill("");
    await expect(page.locator('[data-testid="addon-card-dev.senn.avatar-presence"]')).toBeVisible();

    await ctx.close();
  });

  test("category filter narrows cards to a single category (ADR-0017 v2)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await seedHostAndRegistry(page);
    await page.goto("/");

    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });

    // Pick "communication" — the only voice-call entry should remain.
    await page.locator('[data-testid="filter-cat"]').selectOption("communication");
    await expect(page.locator('[data-testid="addon-card-dev.senn.voice-call"]')).toBeVisible({
      timeout: SHORT,
    });
    await expect(page.locator('[data-testid="addon-card-dev.senn.whiteboard"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="addon-card-dev.senn.local-vault"]')).toHaveCount(0);

    // Reset → all back.
    await page.locator('[data-testid="filter-cat"]').selectOption("");
    await expect(page.locator('[data-testid="addon-card-dev.senn.whiteboard"]')).toBeVisible();

    await ctx.close();
  });

  test("Open in SENN host link uses the ?addon=&publisher= deep-link form", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await seedHostAndRegistry(page);
    await page.goto("/");

    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });

    const link = page.locator('[data-testid="addon-open-dev.senn.whiteboard"]');
    await expect(link).toBeVisible({ timeout: SHORT });
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    if (!href) return;
    const url = new URL(href);
    expect(url.origin).toBe("http://127.0.0.1:5173");
    expect(url.searchParams.get("addon")).toBe(
      "http://127.0.0.1:5173/addons/whiteboard/manifest.json",
    );
    expect(url.searchParams.get("publisher")).toBe(PROXIED_REGISTRY_URL);

    await ctx.close();
  });

  test("meta-index URL expands into its publisher list (ADR-0017 §3)", async ({ browser }) => {
    const META_URL = "http://127.0.0.1:5173/registry/official/meta.json";
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Mock the meta URL: vite mirror has no meta.json, so we synthesise one
    // that points at the actual proxied publisher index.
    await page.route(META_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          kind: "senn-publisher-meta",
          publishers: [{ url: PROXIED_REGISTRY_URL, name: "SENN Project (mock)", featured: true }],
        }),
      });
    });

    // Pre-seed: user's only configured registry is the meta URL.
    await page.addInitScript(
      ({ metaUrl, hostOrigin }) => {
        try {
          localStorage.setItem("senn.gallery.registries", JSON.stringify([{ url: metaUrl }]));
          localStorage.setItem("senn.gallery.host-origin", hostOrigin);
        } catch {
          /* localStorage may not be available; addInitScript will retry per nav */
        }
      },
      { metaUrl: META_URL, hostOrigin: "http://127.0.0.1:5173" },
    );
    await page.goto("/");

    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });

    // The registry-list row for the meta URL is annotated as a meta-index.
    const metaRow = page.locator(`[data-testid="registry-meta-${encodeURIComponent(META_URL)}"]`);
    await expect(metaRow).toContainText("meta-index", { timeout: SHORT });
    await expect(metaRow).toContainText("1 of 1 publishers loaded");

    // Cards from the discovered publisher render and carry the meta-source
    // attribution.
    const card = page.locator('[data-testid="addon-card-dev.senn.whiteboard"]');
    await expect(card).toBeVisible({ timeout: SHORT });
    const trustRow = page.locator('[data-testid="addon-meta-source-dev.senn.whiteboard"]');
    await expect(trustRow).toContainText("via SENN Project (mock)");

    // The hand-off URL still points at the discovered publisher index, NOT
    // at the meta-index URL — meta-of-meta has no special meaning to the host.
    const link = page.locator('[data-testid="addon-open-dev.senn.whiteboard"]');
    const href = await link.getAttribute("href");
    if (!href) throw new Error("missing handoff href");
    const url = new URL(href);
    expect(url.searchParams.get("publisher")).toBe(PROXIED_REGISTRY_URL);

    await ctx.close();
  });
});
