import { type BrowserContext, type Page, expect, test } from "@playwright/test";

const SHORT = 5_000;

/**
 * The host page exposes a hook so e2e can rebuild AddonHost.load with a
 * specific verify mode and trustedKeys, instead of the default click handler.
 *
 * This avoids leaking test-only buttons into the real demo UI; we instead
 * use page.evaluate to drive the host directly.
 */
async function loadAddonWithVerify(
  page: Page,
  options: { mode: "none" | "optional" | "required"; trustedKeys?: string[] },
): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async (opts) => {
    type W = Window &
      typeof globalThis & {
        __sennE2E?: {
          loadEcho: (verify: typeof opts) => Promise<{ ok: boolean; error?: string }>;
        };
      };
    const w = window as unknown as W;
    if (!w.__sennE2E) return { ok: false, error: "test hook not present" };
    return w.__sennE2E.loadEcho(opts);
  }, options);
}

async function generateKeypairInPage(page: Page): Promise<{ publicKey: string }> {
  return page.evaluate(async () => {
    type W = Window &
      typeof globalThis & {
        __sennE2E?: { generateKeyPair: () => Promise<{ publicKey: string; id: string }> };
      };
    const w = window as unknown as W;
    if (!w.__sennE2E) throw new Error("test hook not present");
    const kp = await w.__sennE2E.generateKeyPair();
    return { publicKey: kp.publicKey };
  });
}

async function signEchoManifest(page: Page): Promise<void> {
  await page.evaluate(async () => {
    type W = Window &
      typeof globalThis & {
        __sennE2E?: { signEchoManifest: () => Promise<void> };
      };
    const w = window as unknown as W;
    if (!w.__sennE2E) throw new Error("test hook not present");
    await w.__sennE2E.signEchoManifest();
  });
}

test.describe("Add-on manifest signing", () => {
  let ctx: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    ctx = await browser.newContext();
  });

  test.afterEach(async () => {
    await ctx.close();
  });

  test("verify=required rejects an unsigned manifest", async () => {
    const page = await ctx.newPage();
    await page.goto("/?e2e=signing");
    const kp = await generateKeypairInPage(page);
    const result = await loadAddonWithVerify(page, {
      mode: "required",
      trustedKeys: [kp.publicKey],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/required signature missing|404/i);
  });

  test("verify=required accepts a freshly-signed manifest", async () => {
    const page = await ctx.newPage();
    await page.goto("/?e2e=signing");
    const kp = await generateKeypairInPage(page);
    await signEchoManifest(page);
    const result = await loadAddonWithVerify(page, {
      mode: "required",
      trustedKeys: [kp.publicKey],
    });
    expect(result.ok).toBe(true);
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });
  });

  test("verify=required rejects when trustedKeys does not include the signer", async () => {
    const page = await ctx.newPage();
    await page.goto("/?e2e=signing");
    await generateKeypairInPage(page);
    await signEchoManifest(page);
    const result = await loadAddonWithVerify(page, {
      mode: "required",
      trustedKeys: ["unrelated-base64url-key"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/untrusted-key|verification failed/i);
  });
});
