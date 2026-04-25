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
  await expect(a.locator("#state")).toHaveText("connected", { timeout: SHORT });
  await expect(b.locator("#state")).toHaveText("connected", { timeout: SHORT });
}

test.describe("Echo add-on across two peers", () => {
  test("inviter's add-on emits a payload, joiner's add-on echoes it back over the data channel", async ({
    browser,
  }) => {
    test.setTimeout(LONG);

    const inviterCtx = await browser.newContext();
    const joinerCtx = await browser.newContext();
    const inviter = await inviterCtx.newPage();
    const joiner = await joinerCtx.newPage();

    for (const p of [inviter, joiner]) {
      p.on("pageerror", (err) => console.error(`[${p === inviter ? "A" : "B"}] pageerror`, err));
    }

    // ── Establish the data channel exactly as in handoff.spec.ts ──────────
    await inviter.goto("/");
    await inviter.locator("#btn-create-room").click();
    await inviter.waitForFunction(
      () => /session: connecting/.test(document.querySelector("#inbox")?.textContent ?? ""),
      undefined,
      { timeout: SHORT },
    );
    const inviteUrl = await exportNonEmpty(inviter);
    await joiner.goto(inviteUrl);
    await expect(joiner.locator("#room-id")).toHaveText(/^[0-9a-hjkmnp-tv-z]{26}$/, {
      timeout: SHORT,
    });
    const answerUrl = await exportNonEmpty(joiner);
    await pasteAndImport(inviter, answerUrl);
    await ferryUntilConnected(inviter, joiner);

    // ── Load the echo add-on on both sides ────────────────────────────────
    for (const page of [inviter, joiner]) {
      await page.locator("#btn-load-addon").click();
      await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
    }

    // The iframe URL must point at the static add-on path (no app-server proxy).
    for (const page of [inviter, joiner]) {
      const src = await page.locator("#addon-mount iframe").getAttribute("src");
      expect(src).toMatch(/\/addons\/echo\/index\.html$/);
      const sandbox = await page.locator("#addon-mount iframe").getAttribute("sandbox");
      expect(sandbox?.split(/\s+/)).toContain("allow-scripts");
      expect(sandbox?.split(/\s+/)).not.toContain("allow-same-origin");
    }

    // ── Inviter add-on emits a payload via the bridge ─────────────────────
    const inviterFrame = inviter.frameLocator("#addon-mount iframe");
    await inviterFrame.locator("#emit-input").fill("ping-from-inviter");
    await inviterFrame.locator("#emit-button").click();

    // Joiner add-on receives "recv" + echoes back automatically.
    const joinerFrame = joiner.frameLocator("#addon-mount iframe");
    await expect(
      joinerFrame.locator("#log li", { hasText: /recv: .*ping-from-inviter/ }),
    ).toBeVisible({ timeout: SHORT });

    // Inviter add-on sees the echo (the original payload nested under "original",
    // and "echoed":true added by the echo add-on).
    await expect(
      inviterFrame.locator("#log li", {
        hasText: /recv: .*ping-from-inviter.*"echoed":\s*true/,
      }),
    ).toBeVisible({ timeout: SHORT });

    // Host-side log on the inviter shows the addon → peers send + the inbound echo.
    await expect(
      inviter.locator("#inbox li", { hasText: /addon -> peers: .*ping-from-inviter/ }),
    ).toBeVisible({ timeout: SHORT });

    await inviterCtx.close();
    await joinerCtx.close();
  });
});
