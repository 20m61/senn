import { expect, test } from "@playwright/test";

const SHORT = 5_000;

test.describe("Official registry launcher", () => {
  test("renders rows from /registry/official/index.json and reports publisher + key count", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");

    // Header status line lands once the fetch resolves.
    await expect(page.locator("#registry-status")).toHaveText(
      /publisher .+ · \d+ addons · \d+ trusted key/,
      { timeout: SHORT },
    );

    // All seven official addons should be listed.
    const rows = page.locator("#registry-list > li");
    await expect(rows).toHaveCount(7);

    // Each web-mountable addon gets a load button; minimal-addon (under
    // examples/) is skipped with the explanatory note.
    await expect(page.locator('[data-testid="registry-load-dev.senn.echo"]')).toBeVisible();
    await expect(page.locator('[data-testid="registry-load-dev.senn.whiteboard"]')).toBeVisible();
    await expect(page.locator('[data-testid="registry-load-dev.senn.local-vault"]')).toBeVisible();
    await expect(
      page
        .locator("#registry-list > li", { hasText: "dev.senn.minimal" })
        .getByText(/not mounted under apps\/web\/public/),
    ).toBeVisible();

    await ctx.close();
  });

  test("clicking a registry load button mounts the addon with verify=required success", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    await page.locator("#btn-create-room").click();
    await expect(page.locator("#registry-status")).toContainText("publisher", { timeout: SHORT });

    await page.locator('[data-testid="registry-load-dev.senn.whiteboard"]').click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
    const src = await page.locator("#addon-mount iframe").getAttribute("src");
    expect(src).toMatch(/\/addons\/whiteboard\/index\.html$/);

    await ctx.close();
  });
});
