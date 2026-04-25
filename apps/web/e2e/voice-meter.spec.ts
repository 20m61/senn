import { type Page, expect, test } from "@playwright/test";

const SHORT = 5_000;

async function injectLevel(page: Page, level: number): Promise<boolean> {
  return page.evaluate((lvl) => {
    type W = Window &
      typeof globalThis & {
        __sennE2E?: { publishAudioLevel: (n: number) => boolean };
      };
    const w = window as unknown as W;
    return w.__sennE2E?.publishAudioLevel(lvl) ?? false;
  }, level);
}

test.describe("Voice Meter add-on (audio.level bridge)", () => {
  test("renders in the registry launcher (verify=required against official key)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.locator("#registry-status")).toContainText("publisher", { timeout: SHORT });
    await expect(page.locator('[data-testid="registry-load-dev.senn.voice-meter"]')).toBeVisible();
    await ctx.close();
  });

  test("subscribes to audio.level and updates meter when host publishes synthetic levels", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("pageerror", err.message));

    await page.goto("/");
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-meter").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    const frame = page.frameLocator("#addon-mount iframe");

    // Inject a high level. The add-on should render ~0.700 and "yes".
    expect(await injectLevel(page, 0.7)).toBe(true);
    await expect(frame.locator('[data-testid="meter-value"]')).toHaveText("0.700", {
      timeout: SHORT,
    });
    await expect(frame.locator('[data-testid="meter-speaking"]')).toHaveText("yes");

    // Inject a sub-threshold level — speaking flips to "no".
    expect(await injectLevel(page, 0.02)).toBe(true);
    await expect(frame.locator('[data-testid="meter-value"]')).toHaveText("0.020");
    await expect(frame.locator('[data-testid="meter-speaking"]')).toHaveText("no");

    await ctx.close();
  });
});
