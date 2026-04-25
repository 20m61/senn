import { type Page, expect, test } from "@playwright/test";

const SHORT = 5_000;
const LONG = 60_000;

async function exportNonEmpty(page: Page): Promise<string> {
  for (let i = 0; i < 6; i++) {
    await page.locator("#btn-export").click();
    const v = await page.locator("#export-out").inputValue();
    if (v && !v.startsWith("(")) return v;
    await page.waitForTimeout(300);
  }
  throw new Error("export-out remained empty after retries");
}

async function pasteAndImport(page: Page, url: string): Promise<void> {
  await page.locator("#import-in").fill(url);
  await page.locator("#btn-import").click();
}

async function ferryUntilConnected(a: Page, b: Page): Promise<void> {
  const connected = async (p: Page) => (await p.locator("#state").innerText()) === "connected";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await connected(a)) && (await connected(b))) return;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      await from.locator("#btn-export").click();
      const v = await from.locator("#export-out").inputValue();
      if (v && !v.startsWith("(")) await pasteAndImport(to, v);
    }
    await a.waitForTimeout(500);
  }
}

test.describe("Whiteboard add-on", () => {
  test("inviter strokes are delivered to the joiner's whiteboard over the data channel", async ({
    browser,
  }) => {
    test.setTimeout(LONG);
    const inviterCtx = await browser.newContext();
    const joinerCtx = await browser.newContext();
    const inviter = await inviterCtx.newPage();
    const joiner = await joinerCtx.newPage();

    for (const p of [inviter, joiner]) {
      p.on("pageerror", (err) =>
        console.error(`[${p === inviter ? "A" : "B"}] pageerror`, err.message),
      );
    }

    await inviter.goto("/");
    await inviter.locator("#btn-create-room").click();
    await inviter.waitForFunction(
      () => /session: connecting/.test(document.querySelector("#inbox")?.textContent ?? ""),
      undefined,
      { timeout: SHORT },
    );
    const inviteUrl = await exportNonEmpty(inviter);
    await joiner.goto(inviteUrl);
    const answerUrl = await exportNonEmpty(joiner);
    await pasteAndImport(inviter, answerUrl);
    await ferryUntilConnected(inviter, joiner);

    for (const page of [inviter, joiner]) {
      await page.locator("#btn-load-whiteboard").click();
      await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
      const src = await page.locator("#addon-mount iframe").getAttribute("src");
      expect(src).toMatch(/\/addons\/whiteboard\/index\.html$/);
    }

    const inviterFrame = inviter.frameLocator("#addon-mount iframe");
    const joinerFrame = joiner.frameLocator("#addon-mount iframe");

    // The "demo line" button emits one deterministic stroke segment.
    await inviterFrame.locator("#btn-demo").click();
    await expect(inviterFrame.locator("#own-strokes")).toHaveText("1", { timeout: SHORT });

    // It must show up on the joiner's add-on as a peer stroke, not an own stroke.
    await expect(joinerFrame.locator("#peer-strokes")).toHaveText("1", { timeout: SHORT });
    await expect(joinerFrame.locator("#own-strokes")).toHaveText("0");

    // Host-side log on the inviter should record the addon → peers send.
    await expect(
      inviter.locator("#inbox li", { hasText: /addon -> peers: .*"type":"stroke"/ }),
    ).toBeVisible({ timeout: SHORT });

    await inviterCtx.close();
    await joinerCtx.close();
  });

  test("snapshot persists across reload via local-first storage", async ({ browser }) => {
    test.setTimeout(LONG);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", (err) => console.error("[A] pageerror", err.message));

    await page.goto("/");
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-whiteboard").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    const frame = page.frameLocator("#addon-mount iframe");
    // Draw two demo strokes (each demo click produces one segment).
    await frame.locator("#btn-demo").click();
    await frame.locator("#btn-demo").click();
    await expect(frame.locator("#own-strokes")).toHaveText("2", { timeout: SHORT });

    await frame.locator("#btn-save").click();
    await expect(frame.locator("#vault-state")).toHaveText(/saved 2 strokes/, { timeout: SHORT });

    // Reload the host page; the canvas state vanishes but the IDB store keeps the snapshot.
    await page.reload();
    await page.locator("#btn-create-room").click();
    await page.locator("#btn-load-whiteboard").click();
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    const frame2 = page.frameLocator("#addon-mount iframe");
    await expect(frame2.locator("#own-strokes")).toHaveText("0");
    await frame2.locator("#btn-load").click();
    await expect(frame2.locator("#vault-state")).toHaveText(/loaded 2 strokes/, {
      timeout: SHORT,
    });
    await expect(frame2.locator("#own-strokes")).toHaveText("2");

    await ctx.close();
  });
});
