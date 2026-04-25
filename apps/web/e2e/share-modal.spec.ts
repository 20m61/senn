import { type Page, expect, test } from "@playwright/test";

const SHORT = 5_000;

async function waitForExportNonEmpty(page: Page): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const v = await page.locator("#share-url").inputValue();
    if (v && !v.startsWith("(")) return v;
    await page.waitForTimeout(200);
  }
  throw new Error("share-url remained empty");
}

test.describe("Share invite Modal (Tier 0)", () => {
  test("opening the Modal renders QR + URL + copies to clipboard", async ({
    browser,
    browserName,
  }) => {
    // Firefox/WebKit do not recognise the Chromium clipboard permission
    // tokens. The Modal already has a fallback path ("select + copy
    // manually") for any browser where writeText() is denied, so we just
    // assert that one of the two status strings lands.
    const ctx = await browser.newContext(
      browserName === "chromium" ? { permissions: ["clipboard-read", "clipboard-write"] } : {},
    );
    const page = await ctx.newPage();
    await page.goto("/");
    await page.locator("#btn-create-room").click();
    // Wait for the inviter's outbox to be populated.
    await page.waitForFunction(
      () => /session: connecting/.test(document.querySelector("#inbox")?.textContent ?? ""),
      undefined,
      { timeout: SHORT },
    );

    await page.locator("#btn-share").click();
    const modal = page.locator("#share-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("#share-qr svg")).toBeVisible({ timeout: SHORT });

    const url = await waitForExportNonEmpty(page);
    expect(url).toMatch(/#i=/); // invite fragment present

    await page.locator("#share-copy").click();
    await expect(page.locator("#share-copy-status")).toHaveText(/copied|select \+ copy manually/, {
      timeout: SHORT,
    });

    await page.locator("#share-close").click();
    await expect(modal).toBeHidden();

    await ctx.close();
  });
});
