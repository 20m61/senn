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

test.describe("Avatar Presence add-on", () => {
  test("state changes (speaking, emotion, reaction) propagate to the peer with no media transmission", async ({
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
      await page.locator("#btn-load-presence").click();
      await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
    }

    const inviterFrame = inviter.frameLocator("#addon-mount iframe");
    const joinerFrame = joiner.frameLocator("#addon-mount iframe");

    // Speaking toggle: the joiner sees the inviter's avatar update.
    await inviterFrame.locator("#btn-toggle-speaking").click();
    await expect(joinerFrame.locator("#peer-speaking")).toHaveText("yes", { timeout: SHORT });

    // Emotion change.
    await inviterFrame.locator("#emotion-select").selectOption("happy");
    await expect(joinerFrame.locator("#peer-emotion")).toHaveText("happy", { timeout: SHORT });

    // Reaction.
    await inviterFrame.locator(".rxn[data-emoji='🎉']").click();
    await expect(joinerFrame.locator("#peer-reaction")).toHaveText("🎉", { timeout: SHORT });

    // Inviter's host log records every send. Verify NO frames were ever
    // transmitted by checking the addon → peers log only mentions "state"
    // or "reaction" payloads — never "video", "frame", or similar.
    const inboxText = (await inviter.locator("#inbox").innerText()).toLowerCase();
    expect(inboxText).not.toContain("video");
    expect(inboxText).not.toContain("frame");
    expect(inboxText).toContain("addon -> peers");
    expect(inboxText).toMatch(/"type":"(state|reaction)"/);

    await inviterCtx.close();
    await joinerCtx.close();
  });
});
