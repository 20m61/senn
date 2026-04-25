import { type BrowserContext, type Page, expect, test } from "@playwright/test";

const SHORT = 5_000;
const LONG = 60_000;

async function exportNonEmpty(page: Page): Promise<string> {
  // Try several times — ICE may add candidates after the first export.
  for (let i = 0; i < 6; i++) {
    await page.locator("#btn-export").click();
    const value = await page.locator("#export-out").inputValue();
    if (value && !value.startsWith("(")) return value;
    await page.waitForTimeout(300);
  }
  throw new Error("export-out remained empty after retries");
}

async function pasteAndImport(page: Page, url: string): Promise<void> {
  await page.locator("#import-in").fill(url);
  await page.locator("#btn-import").click();
}

test.describe("Tier 0 PeerSession demo", () => {
  test("two contexts establish a real RTCPeerConnection and exchange text both ways", async ({
    browser,
  }) => {
    test.setTimeout(LONG);

    const inviterCtx: BrowserContext = await browser.newContext();
    const joinerCtx: BrowserContext = await browser.newContext();
    const inviter = await inviterCtx.newPage();
    const joiner = await joinerCtx.newPage();

    // Bubble up unhandled rejections so a connection failure surfaces clearly.
    for (const p of [inviter, joiner]) {
      p.on("pageerror", (err) => console.error(`[${p === inviter ? "A" : "B"}] pageerror`, err));
    }

    // ── Inviter: create the room and the offer ─────────────────────────────
    await inviter.goto("/");
    await inviter.locator("#btn-create-room").click();
    await expect(inviter.locator("#room-id")).toHaveText(/^[0-9a-hjkmnp-tv-z]{26}$/, {
      timeout: SHORT,
    });
    // Wait until the inviter's outbox has the offer.
    await inviter.waitForFunction(
      () => /session: connecting/.test(document.querySelector("#inbox")?.textContent ?? ""),
      undefined,
      { timeout: SHORT },
    );
    const inviteUrl = await exportNonEmpty(inviter);
    expect(inviteUrl).toMatch(/#i=[A-Za-z0-9_-]+&s=[A-Za-z0-9_-]+/);

    // ── Joiner: consume the invite, build the answer ───────────────────────
    await joiner.goto(inviteUrl);
    await expect(joiner.locator("#room-id")).toHaveText(/^[0-9a-hjkmnp-tv-z]{26}$/, {
      timeout: SHORT,
    });
    await expect(
      joiner.locator("#inbox li", { hasText: /imported \d+ signaling message/ }),
    ).toBeVisible({ timeout: SHORT });
    const answerUrl = await exportNonEmpty(joiner);
    expect(answerUrl).toMatch(/#s=[A-Za-z0-9_-]+/);
    expect(answerUrl).not.toContain("i=");

    // ── Inviter: import the answer ─────────────────────────────────────────
    await pasteAndImport(inviter, answerUrl);

    // ── Both sides may produce more ICE candidates; ferry until connected. ─
    // We give each side up to 30s and N rounds of export/import.
    const connected = async (p: Page): Promise<boolean> =>
      (await p.locator("#state").innerText()) === "connected";

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if ((await connected(inviter)) && (await connected(joiner))) break;
      // pump joiner -> inviter
      const fromJoiner = await joiner
        .locator("#btn-export")
        .click()
        .then(async () => {
          const v = await joiner.locator("#export-out").inputValue();
          return v && !v.startsWith("(") ? v : "";
        });
      if (fromJoiner) await pasteAndImport(inviter, fromJoiner);
      // pump inviter -> joiner
      const fromInviter = await inviter
        .locator("#btn-export")
        .click()
        .then(async () => {
          const v = await inviter.locator("#export-out").inputValue();
          return v && !v.startsWith("(") ? v : "";
        });
      if (fromInviter) await pasteAndImport(joiner, fromInviter);
      await inviter.waitForTimeout(500);
    }

    await expect(inviter.locator("#state")).toHaveText("connected", { timeout: SHORT });
    await expect(joiner.locator("#state")).toHaveText("connected", { timeout: SHORT });

    // ── Send a text both ways through the live data channel ────────────────
    await inviter.locator("#text-in").fill("hello-from-inviter");
    await inviter.locator("#btn-send-text").click();
    await expect(
      joiner.locator("#inbox li", { hasText: "peer text: hello-from-inviter" }),
    ).toBeVisible({ timeout: SHORT });

    await joiner.locator("#text-in").fill("hello-from-joiner");
    await joiner.locator("#btn-send-text").click();
    await expect(
      inviter.locator("#inbox li", { hasText: "peer text: hello-from-joiner" }),
    ).toBeVisible({ timeout: SHORT });

    await inviterCtx.close();
    await joinerCtx.close();
  });

  test("rejects a URL with an unknown fragment key", async ({ browser }) => {
    const inviterCtx = await browser.newContext();
    const observerCtx = await browser.newContext();
    const inviter = await inviterCtx.newPage();
    const observer = await observerCtx.newPage();

    await inviter.goto("/");
    await inviter.locator("#btn-create-room").click();
    await inviter.waitForFunction(
      () => /session: connecting/.test(document.querySelector("#inbox")?.textContent ?? ""),
      undefined,
      { timeout: SHORT },
    );
    const cleanUrl = await exportNonEmpty(inviter);
    const tampered = cleanUrl.replace("#", "#evil=1&");

    await observer.goto(tampered);
    await expect(
      observer.locator("#inbox li", { hasText: /auto-import error: .* unknown fragment key/i }),
    ).toBeVisible({ timeout: SHORT });

    await inviterCtx.close();
    await observerCtx.close();
  });
});
