import { expect, test } from "@playwright/test";

const SHORT = 5_000;

test.describe("ADR-0016 install hand-off — ?addon= & ?publisher=", () => {
  test("renders publisher info and loads the addon under verify=required on confirm", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("pageerror", err.message));

    const url = new URL("/", "http://127.0.0.1:5173");
    url.searchParams.set("addon", "/addons/whiteboard/manifest.json");
    url.searchParams.set("publisher", "/registry/official/index.json");
    await page.goto(url.toString());

    const handoff = page.locator('[data-testid="handoff-section"]');
    await expect(handoff).toBeVisible({ timeout: SHORT });
    await expect(handoff).toContainText("SENN Project", { timeout: SHORT });
    await expect(handoff).toContainText("/addons/whiteboard/manifest.json");

    await page.locator('[data-testid="handoff-confirm"]').click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
  });

  test("refuses the hand-off when the publisher parameter is missing", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const url = new URL("/", "http://127.0.0.1:5173");
    url.searchParams.set("addon", "/addons/whiteboard/manifest.json");
    await page.goto(url.toString());

    const handoff = page.locator('[data-testid="handoff-section"]');
    await expect(handoff).toBeVisible({ timeout: SHORT });
    await expect(handoff).toContainText("missing the publisher parameter");
    await expect(page.locator('[data-testid="handoff-confirm"]')).toBeDisabled();
    await ctx.close();
  });

  test("cancel hides the hand-off and strips the params from the URL", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const url = new URL("/", "http://127.0.0.1:5173");
    url.searchParams.set("addon", "/addons/whiteboard/manifest.json");
    url.searchParams.set("publisher", "/registry/official/index.json");
    await page.goto(url.toString());

    await expect(page.locator('[data-testid="handoff-section"]')).toBeVisible({ timeout: SHORT });
    await page.locator('[data-testid="handoff-cancel"]').click();
    await expect(page.locator('[data-testid="handoff-section"]')).toBeHidden();
    expect(page.url()).not.toContain("addon=");
    expect(page.url()).not.toContain("publisher=");
    await ctx.close();
  });
});
