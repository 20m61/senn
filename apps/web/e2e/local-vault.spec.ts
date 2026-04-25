import { type BrowserContext, expect, test } from "@playwright/test";

const SHORT = 5_000;
const LONG = 30_000;

test.describe("Local Vault add-on", () => {
  let ctx: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    ctx = await browser.newContext({ acceptDownloads: true });
  });

  test.afterEach(async () => {
    await ctx.close();
  });

  test("user-selected file is stored, listed, and downloaded back unchanged", async () => {
    test.setTimeout(LONG);
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("pageerror", err.message));

    await page.goto("/");
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-vault").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    const frame = page.frameLocator("#addon-mount iframe");

    // Attach a file via Playwright (stand-in for a real OS picker click).
    const fileBytes = Buffer.from("hello senn vault\n", "utf8");
    await frame.locator("#picker").setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: fileBytes,
    });
    await frame.locator("#btn-add").click();

    await expect(frame.locator("#op-status")).toHaveText(/added note\.txt/, { timeout: SHORT });
    await expect(frame.locator("#list .name", { hasText: "note.txt" })).toBeVisible({
      timeout: SHORT,
    });

    // Trigger the user-approved download and capture the file.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: SHORT }),
      frame.locator(".list .download").first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("note.txt");
    const downloadStream = await download.createReadStream();
    expect(downloadStream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream as NodeJS.ReadableStream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const got = Buffer.concat(chunks);
    expect(got.equals(fileBytes)).toBe(true);
  });

  test("vault entries persist across reload", async () => {
    test.setTimeout(LONG);
    const page = await ctx.newPage();
    await page.goto("/");
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-vault").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    const frame = page.frameLocator("#addon-mount iframe");
    await frame.locator("#picker").setInputFiles({
      name: "persistent.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([1, 2, 3, 4, 5]),
    });
    await frame.locator("#btn-add").click();
    await expect(frame.locator("#list .name", { hasText: "persistent.bin" })).toBeVisible({
      timeout: SHORT,
    });

    await page.reload();
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-vault").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
    const frame2 = page.frameLocator("#addon-mount iframe");
    await expect(frame2.locator("#list .name", { hasText: "persistent.bin" })).toBeVisible({
      timeout: SHORT,
    });
  });
});
