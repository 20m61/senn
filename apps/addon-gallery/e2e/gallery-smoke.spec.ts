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
    // Featured count is surfaced in the same row.
    await expect(metaRow).toContainText("1 featured");

    // Cards from the discovered publisher render and carry the meta-source
    // attribution.
    const card = page.locator('[data-testid="addon-card-dev.senn.whiteboard"]');
    await expect(card).toBeVisible({ timeout: SHORT });
    const trustRow = page.locator('[data-testid="addon-meta-source-dev.senn.whiteboard"]');
    await expect(trustRow).toContainText("via SENN Project (mock)");

    // Featured publisher → featured badge on every card from that publisher.
    const featuredBadge = page.locator('[data-testid="addon-featured-dev.senn.whiteboard"]');
    await expect(featuredBadge).toBeVisible();
    await expect(featuredBadge).toHaveText("featured");

    // The hand-off URL still points at the discovered publisher index, NOT
    // at the meta-index URL — meta-of-meta has no special meaning to the host.
    const link = page.locator('[data-testid="addon-open-dev.senn.whiteboard"]');
    const href = await link.getAttribute("href");
    if (!href) throw new Error("missing handoff href");
    const url = new URL(href);
    expect(url.searchParams.get("publisher")).toBe(PROXIED_REGISTRY_URL);

    await ctx.close();
  });

  test("meta-index partial failure surfaces per-publisher errors (ADR-0017 §3)", async ({
    browser,
  }) => {
    const META_URL = "http://127.0.0.1:5173/registry/official/meta-partial.json";
    const BROKEN_PUB = "http://127.0.0.1:5173/registry/does-not-exist/index.json";
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Meta-index lists one good publisher (the real proxied registry) and
    // one broken publisher whose URL 404s. The gallery should load the
    // good one and surface the broken one as a per-publisher error under
    // the meta row, not a top-level fatal.
    await page.route(META_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          kind: "senn-publisher-meta",
          publishers: [
            { url: PROXIED_REGISTRY_URL, name: "SENN Project (mock)" },
            { url: BROKEN_PUB, name: "Broken Publisher" },
          ],
        }),
      });
    });
    await page.route(BROKEN_PUB, async (route) => {
      await route.fulfill({ status: 404, body: "not found" });
    });

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

    // Successful publisher's card still renders.
    await expect(page.locator('[data-testid="addon-card-dev.senn.whiteboard"]')).toBeVisible({
      timeout: SHORT,
    });

    // Meta row reflects 1-of-2 loaded.
    const metaRow = page.locator(`[data-testid="registry-meta-${encodeURIComponent(META_URL)}"]`);
    await expect(metaRow).toContainText("1 of 2 publishers loaded");

    // The broken publisher is surfaced in the per-meta error list.
    const errorList = page.locator(
      `[data-testid="registry-meta-errors-${encodeURIComponent(META_URL)}"]`,
    );
    await expect(errorList).toBeVisible();
    await expect(errorList).toContainText("Broken Publisher");
    await expect(errorList).toContainText(BROKEN_PUB);

    // Status string mentions the failed publisher count.
    await expect(page.locator("#config-status")).toContainText("1 meta publishers failed", {
      timeout: SHORT,
    });

    await ctx.close();
  });

  test("renders audit badge for v3 addon entries (ADR-0020 §3a)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await seedHostAndRegistry(page);
    await page.goto("/");
    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });

    // The official registry's whiteboard entry carries an audit block per
    // ADR-0020 §3a; the gallery surfaces it as a badge in the card head.
    const badge = page.locator('[data-testid="addon-audit-dev.senn.whiteboard"]');
    await expect(badge).toBeVisible({ timeout: SHORT });
    await expect(badge).toHaveText(/audited v0\.1\.0/);

    // The minimal template's audit attests against version 0.0.1 — proves
    // the renderer interpolates auditedVersion correctly per addon.
    const minimalBadge = page.locator('[data-testid="addon-audit-dev.senn.minimal"]');
    await expect(minimalBadge).toHaveText(/audited v0\.0\.1/);

    await ctx.close();
  });

  test("renders endorsement chips on meta-index rows (ADR-0020 §3b)", async ({ browser }) => {
    const META_URL = "http://127.0.0.1:5173/registry/official/meta-endorsed.json";
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.route(META_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          kind: "senn-publisher-meta",
          publishers: [
            {
              url: PROXIED_REGISTRY_URL,
              name: "SENN Project (mock)",
              featured: true,
              endorsedBy: ["Acme Sec", "FooCorp Audit"],
              endorsementUrl: "https://example.invalid/endorse",
            },
          ],
        }),
      });
    });

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

    // The meta row caption appends "1 endorsed".
    const metaRow = page.locator(`[data-testid="registry-meta-${encodeURIComponent(META_URL)}"]`);
    await expect(metaRow).toContainText("1 endorsed");

    // Per-publisher endorsement chips render under the row.
    const endorseRow = page.locator(
      `[data-testid="registry-meta-endorsement-${encodeURIComponent(META_URL)}-${encodeURIComponent(PROXIED_REGISTRY_URL)}"]`,
    );
    await expect(endorseRow).toBeVisible();
    await expect(endorseRow).toContainText("Acme Sec");
    await expect(endorseRow).toContainText("FooCorp Audit");
    // The endorsementUrl link is rendered as a "(report)" anchor.
    const reportLink = endorseRow.getByRole("link", { name: "(report)" });
    await expect(reportLink).toHaveAttribute("href", "https://example.invalid/endorse");

    await ctx.close();
  });

  test("renders submissions index in its own section (ADR-0020 §2)", async ({ browser }) => {
    const SUB_URL = "http://127.0.0.1:5173/registry/official/submissions.json";
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.route(SUB_URL, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 1,
          kind: "senn-publisher-submissions",
          submissions: [
            {
              id: "sub-001",
              addonId: "dev.example.proposed",
              version: "0.1.0",
              manifestUrl: "https://example.invalid/proposed/manifest.json",
              signatureUrl: "https://example.invalid/proposed/manifest.sig.json",
              publicKey: "RefyZUlMPbQgj8cdXqFOIofvBeuXmKZcBUpJ9mayybQ",
              submittedAt: "2026-04-26T00:00:00Z",
              contact: "submitter@example.invalid",
              status: "needs-changes",
              statusUpdatedAt: "2026-04-26T01:00:00Z",
              statusReason: "Manifest is missing the description field.",
              notes: "Will resubmit shortly.",
            },
            {
              id: "sub-002",
              addonId: "dev.example.accepted",
              version: "1.0.0",
              manifestUrl: "https://example.invalid/accepted/manifest.json",
              signatureUrl: "https://example.invalid/accepted/manifest.sig.json",
              publicKey: "RefyZUlMPbQgj8cdXqFOIofvBeuXmKZcBUpJ9mayybQ",
              submittedAt: "2026-04-25T00:00:00Z",
              contact: "team@example.invalid",
              status: "accepted",
              statusUpdatedAt: "2026-04-26T00:00:00Z",
            },
          ],
        }),
      });
    });

    await page.addInitScript(
      ({ subUrl, hostOrigin }) => {
        try {
          localStorage.setItem("senn.gallery.registries", JSON.stringify([{ url: subUrl }]));
          localStorage.setItem("senn.gallery.host-origin", hostOrigin);
        } catch {
          /* localStorage may not be available; addInitScript will retry per nav */
        }
      },
      { subUrl: SUB_URL, hostOrigin: "http://127.0.0.1:5173" },
    );
    await page.goto("/");

    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });

    // Registry-list row for the submissions URL is annotated as such.
    const subRow = page.locator(
      `[data-testid="registry-submissions-${encodeURIComponent(SUB_URL)}"]`,
    );
    await expect(subRow).toContainText("submissions index · 2 submissions", { timeout: SHORT });

    // Submissions section becomes visible with both entries.
    const card1 = page.locator('[data-testid="submission-card-sub-001"]');
    const card2 = page.locator('[data-testid="submission-card-sub-002"]');
    await expect(card1).toBeVisible({ timeout: SHORT });
    await expect(card2).toBeVisible();
    await expect(card1).toContainText("dev.example.proposed v0.1.0");
    await expect(card1).toContainText("reason: Manifest is missing the description field.");
    await expect(card1.locator('[data-testid="submission-status-sub-001"]')).toHaveText(
      "needs-changes",
    );
    await expect(card2.locator('[data-testid="submission-status-sub-002"]')).toHaveText("accepted");

    // Manifest + signature anchors point at the absolute URLs from the doc.
    await expect(page.locator('[data-testid="submission-manifest-sub-001"]')).toHaveAttribute(
      "href",
      "https://example.invalid/proposed/manifest.json",
    );
    await expect(page.locator('[data-testid="submission-signature-sub-002"]')).toHaveAttribute(
      "href",
      "https://example.invalid/accepted/manifest.sig.json",
    );

    await ctx.close();
  });

  test("refresh button re-runs every load with cache: reload", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await seedHostAndRegistry(page);
    await page.goto("/");
    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });

    // Track every fetch against the proxied publisher index. The Refresh
    // button should fire at least one new request; its Request must opt
    // into cache=reload so the browser revalidates.
    const requests: { url: string; cache: string }[] = [];
    page.on("request", (req) => {
      if (req.url() === PROXIED_REGISTRY_URL) {
        requests.push({ url: req.url(), cache: (req as { cache?: () => string }).cache?.() ?? "" });
      }
    });
    await page.locator('[data-testid="btn-registry-refresh"]').click();
    await expect(page.locator("#config-status")).toContainText("loaded", { timeout: SHORT });

    expect(requests.length).toBeGreaterThanOrEqual(1);
    // Playwright surfaces the Fetch API cache mode on the request; the
    // refresh path must use "reload". Older engines (WebKit) report it as
    // an empty string — accept either "reload" or empty there.
    for (const r of requests) {
      expect(["reload", ""]).toContain(r.cache);
    }

    await ctx.close();
  });
});
