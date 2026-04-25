import { type BrowserContext, expect, test } from "@playwright/test";

const SHORT = 5_000;
const LONG = 60_000;

test.describe("Add-on storage", () => {
  let ctx: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    ctx = await browser.newContext();
  });

  test.afterEach(async () => {
    await ctx.close();
  });

  test("persists across page reload (IndexedDB-backed)", async () => {
    test.setTimeout(LONG);
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("[A] pageerror", err.message));

    await page.goto("/");
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-addon").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    const frame = page.frameLocator("#addon-mount iframe");
    await frame.locator("#vault-key").fill("draft");
    await frame.locator("#vault-value").fill("hello");
    await frame.locator("#vault-save").click();
    await expect(frame.locator("#vault-state")).toHaveText(/saved draft/, { timeout: SHORT });

    // Reload (the IndexedDB store survives, the AddonHost is rebuilt).
    await page.reload();
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-addon").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    const frame2 = page.frameLocator("#addon-mount iframe");
    await frame2.locator("#vault-key").fill("draft");
    await frame2.locator("#vault-load").click();
    await expect(frame2.locator("#vault-state")).toHaveText(/loaded draft="hello"/, {
      timeout: SHORT,
    });
  });

  test("namespaces between (would-be) different add-on ids", async () => {
    test.setTimeout(LONG);
    const page = await ctx.newPage();
    await page.goto("/");
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-addon").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    // Save under the echo add-on's namespace.
    const frame = page.frameLocator("#addon-mount iframe");
    await frame.locator("#vault-key").fill("k");
    await frame.locator("#vault-value").fill("ns-echo");
    await frame.locator("#vault-save").click();
    await expect(frame.locator("#vault-state")).toHaveText(/saved k/, { timeout: SHORT });

    // Probe IndexedDB directly from the page context: only entries
    // prefixed with `dev.senn.echo ` should exist.
    const keys = await page.evaluate(async () => {
      const indexedDB = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB;
      return await new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open("senn-addon-storage");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("values", "readonly");
          const store = tx.objectStore("values");
          const all = store.getAllKeys();
          all.onsuccess = () => resolve(all.result.map((k) => String(k)));
          all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    expect(keys).toContain("dev.senn.echo k");
    for (const k of keys) {
      expect(k.startsWith("dev.senn.echo ")).toBe(true);
    }
  });
});
