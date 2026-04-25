import { type Page, expect, test } from "@playwright/test";

const SHORT = 5_000;

async function exportNonEmpty(page: Page): Promise<string> {
  for (let i = 0; i < 6; i++) {
    await page.locator("#btn-export").click();
    const v = await page.locator("#export-out").inputValue();
    if (v && !v.startsWith("(")) return v;
    await page.waitForTimeout(300);
  }
  throw new Error("export-out remained empty");
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

test.describe("Connection UI", () => {
  test("ICE info renders at startup; health dot is idle before any room", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");

    await expect(page.locator("#ice-info")).toContainText(/ICE: STUN\(stun:/);
    await expect(page.locator("#health-dot")).toHaveAttribute("data-state", "idle");
    await expect(page.locator("#btn-retry")).toBeHidden();

    await ctx.close();
  });

  test("dot transitions idle → connecting → connected, uptime ticks, retry button stays hidden", async ({
    browser,
  }) => {
    const inviterCtx = await browser.newContext();
    const joinerCtx = await browser.newContext();
    const inviter = await inviterCtx.newPage();
    const joiner = await joinerCtx.newPage();

    await inviter.goto("/");
    await inviter.locator("#btn-create-room").click();
    await expect(inviter.locator("#health-dot")).toHaveAttribute("data-state", "connecting", {
      timeout: SHORT,
    });

    const inviteUrl = await exportNonEmpty(inviter);
    await joiner.goto(inviteUrl);
    await expect(joiner.locator("#health-dot")).toHaveAttribute("data-state", "connecting", {
      timeout: SHORT,
    });

    const answerUrl = await exportNonEmpty(joiner);
    await pasteAndImport(inviter, answerUrl);
    await ferryUntilConnected(inviter, joiner);

    await expect(inviter.locator("#health-dot")).toHaveAttribute("data-state", "connected");
    await expect(inviter.locator("#uptime")).toHaveText(/up \d+s/, { timeout: SHORT });
    await expect(inviter.locator("#btn-retry")).toBeHidden();

    await inviterCtx.close();
    await joinerCtx.close();
  });
});
