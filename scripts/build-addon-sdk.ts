#!/usr/bin/env tsx
/**
 * pnpm build:addon-sdk
 *
 * Copies `packages/addon-sdk/runtime/senn-addon-sdk.js` into every
 * add-on directory listed in `addons/official/index.json`. Each add-on's
 * `index.html` loads the file with a relative `<script src>` so the SDK
 * stays on the same opaque origin as the add-on iframe.
 *
 * Spec: docs/addon-sdk-spec.md.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = resolve(REPO_ROOT, "addons/official/index.json");
const SDK_SOURCE = resolve(REPO_ROOT, "packages/addon-sdk/runtime/senn-addon-sdk.js");
const SDK_FILENAME = "senn-addon-sdk.js";

interface RegistryAddon {
  readonly id: string;
  readonly path: string;
}
interface Registry {
  readonly addons: readonly RegistryAddon[];
}

async function loadRegistry(): Promise<Registry> {
  const raw = JSON.parse(await readFile(REGISTRY, "utf8")) as { addons?: unknown };
  if (!Array.isArray(raw.addons)) throw new Error("registry.addons missing");
  return raw as Registry;
}

async function main(): Promise<void> {
  const registry = await loadRegistry();
  console.log(`source  ${SDK_SOURCE}`);
  console.log(`addons  ${registry.addons.length}`);
  console.log("");
  for (const a of registry.addons) {
    const dir = resolve(REPO_ROOT, a.path);
    await mkdir(dir, { recursive: true });
    const dest = resolve(dir, SDK_FILENAME);
    await copyFile(SDK_SOURCE, dest);
    console.log(`  copied  ${a.id.padEnd(28)}  ${a.path}/${SDK_FILENAME}`);
  }
  console.log("");
  console.log("done.");
}

main().catch((err) => {
  console.error(`build-addon-sdk: ${(err as Error).message}`);
  process.exit(1);
});
