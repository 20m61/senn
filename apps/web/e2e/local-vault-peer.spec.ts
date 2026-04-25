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

test.describe("Local Vault — peer transfer", () => {
  test("inviter adds a file, sends it over peer.send.bin, joiner receives + saves to vault", async ({
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

    // Establish a real RTCPeerConnection between two contexts.
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

    // Load local-vault on both sides.
    for (const page of [inviter, joiner]) {
      await page.locator("#btn-load-vault").click();
      await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
    }

    // Inviter picks a file and adds it to the vault.
    const fileBytes = Buffer.from("peer-bytes-from-inviter\n", "utf8");
    const inviterFrame = inviter.frameLocator("#addon-mount iframe");
    await inviterFrame.locator("#picker").setInputFiles({
      name: "shared.txt",
      mimeType: "text/plain",
      buffer: fileBytes,
    });
    await inviterFrame.locator("#btn-add").click();
    await expect(inviterFrame.locator("#list .name", { hasText: "shared.txt" })).toBeVisible({
      timeout: SHORT,
    });

    // Click "send to peer" on the inviter's row.
    await inviterFrame.locator('[data-testid="send-to-peer"]').first().click();
    await expect(inviterFrame.locator("#op-status")).toHaveText(/sent shared\.txt/, {
      timeout: SHORT,
    });

    // The joiner's vault inbox shows the file; "save to vault" persists it.
    const joinerFrame = joiner.frameLocator("#addon-mount iframe");
    await expect(
      joinerFrame.locator('#inbox [data-testid="inbox-name"]', { hasText: "shared.txt" }),
    ).toBeVisible({ timeout: SHORT });
    await joinerFrame.locator('[data-testid="inbox-save"]').first().click();
    await expect(joinerFrame.locator("#list .name", { hasText: "shared.txt" })).toBeVisible({
      timeout: SHORT,
    });

    // Round-trip: download the joiner's saved copy and verify byte-equality.
    const [download] = await Promise.all([
      joiner.waitForEvent("download", { timeout: SHORT }),
      joinerFrame.locator(".list .download").first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("shared.txt");
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    expect(Buffer.concat(chunks).equals(fileBytes)).toBe(true);

    await inviterCtx.close();
    await joinerCtx.close();
  });

  test("chunked transfer: 200 KiB file (multi-frame) round-trips byte-for-byte", async ({
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

    for (const page of [inviter, joiner]) {
      await page.locator("#btn-load-vault").click();
      await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
    }

    // 200 KiB → ⌈200 KiB / 60 KiB⌉ = 4 frames over the wire.
    const sizeBytes = 200 * 1024;
    const fileBytes = Buffer.alloc(sizeBytes);
    for (let i = 0; i < sizeBytes; i++) fileBytes[i] = (i * 31 + 7) & 0xff;

    const inviterFrame = inviter.frameLocator("#addon-mount iframe");
    await inviterFrame.locator("#picker").setInputFiles({
      name: "big.bin",
      mimeType: "application/octet-stream",
      buffer: fileBytes,
    });
    await inviterFrame.locator("#btn-add").click();
    await expect(inviterFrame.locator("#list .name", { hasText: "big.bin" })).toBeVisible({
      timeout: SHORT,
    });

    await inviterFrame.locator('[data-testid="send-to-peer"]').first().click();
    await expect(inviterFrame.locator("#op-status")).toHaveText(/sent big\.bin/, {
      timeout: SHORT,
    });

    const joinerFrame = joiner.frameLocator("#addon-mount iframe");
    await expect(
      joinerFrame.locator('#inbox [data-testid="inbox-name"]', { hasText: "big.bin" }),
    ).toBeVisible({ timeout: SHORT });
    await joinerFrame.locator('[data-testid="inbox-save"]').first().click();
    await expect(joinerFrame.locator("#list .name", { hasText: "big.bin" })).toBeVisible({
      timeout: SHORT,
    });

    const [download] = await Promise.all([
      joiner.waitForEvent("download", { timeout: SHORT }),
      joinerFrame.locator(".list .download").first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("big.bin");
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const got = Buffer.concat(chunks);
    expect(got.byteLength).toBe(sizeBytes);
    expect(got.equals(fileBytes)).toBe(true);

    await inviterCtx.close();
    await joinerCtx.close();
  });
});
