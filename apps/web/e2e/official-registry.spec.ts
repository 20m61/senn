import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Page, expect, test } from "@playwright/test";

const SHORT = 5_000;

interface RegistryAddon {
  readonly id: string;
  readonly path: string;
}

interface Registry {
  readonly trustedKeys: readonly string[];
  readonly addons: readonly RegistryAddon[];
}

function loadRegistry(): Registry {
  const path = resolve(process.cwd(), "../../addons/official/index.json");
  return JSON.parse(readFileSync(path, "utf8")) as Registry;
}

async function loadShipped(
  page: Page,
  manifestUrl: string,
  options: { mode: "none" | "optional" | "required"; trustedKeys?: string[] },
): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(
    async (args) => {
      type W = Window &
        typeof globalThis & {
          __sennE2E?: {
            loadShipped: (
              url: string,
              v: typeof args.options,
            ) => Promise<{ ok: boolean; error?: string }>;
          };
        };
      const w = window as unknown as W;
      if (!w.__sennE2E) return { ok: false, error: "test hook not present" };
      return w.__sennE2E.loadShipped(args.url, args.options);
    },
    { url: manifestUrl, options },
  );
}

test.describe("Official add-on registry — shipped signatures", () => {
  test("verify=required accepts the shipped whiteboard sig under official trustedKeys", async ({
    browser,
  }) => {
    const registry = loadRegistry();
    expect(registry.trustedKeys.length).toBeGreaterThan(0);
    const whiteboard = registry.addons.find((a) => a.id === "dev.senn.whiteboard");
    expect(whiteboard).toBeDefined();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");

    const result = await loadShipped(page, "/addons/whiteboard/manifest.json", {
      mode: "required",
      trustedKeys: [...registry.trustedKeys],
    });
    expect(result.ok).toBe(true);
    await expect(page.locator("#addon-state")).toHaveText("active", { timeout: SHORT });

    await ctx.close();
  });

  test("verify=required rejects the shipped sig when trustedKeys excludes the official key", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");

    const result = await loadShipped(page, "/addons/whiteboard/manifest.json", {
      mode: "required",
      trustedKeys: ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"], // any well-formed but unused key
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/untrusted-key|verification failed/i);

    await ctx.close();
  });
});
