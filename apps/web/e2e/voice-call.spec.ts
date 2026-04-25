import { expect, test } from "@playwright/test";

const SHORT = 5_000;

test.describe("Voice Call add-on (ADR-0015 media bridge)", () => {
  test("renders in the registry launcher (verify=required against official key)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.locator("#registry-status")).toContainText("publisher", { timeout: SHORT });
    await expect(page.locator('[data-testid="registry-load-dev.senn.voice-call"]')).toBeVisible();
    await ctx.close();
  });

  test("start sending mic without a peer link surfaces a not-connected error", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("pageerror", err.message));

    await page.goto("/");
    // Wait for registry to populate, then load voice-call via the official-trust-root path.
    await expect(page.locator("#registry-status")).toContainText("publisher", { timeout: SHORT });
    await page.locator('[data-testid="registry-load-dev.senn.voice-call"]').click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    const frame = page.frameLocator("#addon-mount iframe");

    // No peer connection has been established, so AddonHost.handleMediaSendStart
    // takes the `!this.session?.addLocalTrack` early-exit and posts a
    // not-connected error to the iframe, which the addon writes into the
    // track-log (addon.js's `senn.on("error", ...)`).
    await frame.locator('[data-testid="call-start"]').click();
    await expect(frame.locator('[data-testid="track-log"]')).toContainText("not-connected", {
      timeout: SHORT,
    });

    await ctx.close();
  });
});
