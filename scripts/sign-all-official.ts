#!/usr/bin/env tsx
/**
 * pnpm sign:all-official <keystore.json>
 *
 * Re-signs every add-on listed in `addons/official/index.json` with
 * the supplied keystore. Used by the rotation runbook
 * (docs/governance.md → ADR-0010) — does NOT mutate the registry,
 * only the on-disk `manifest.sig.json` files.
 *
 * Refuses to run if any add-on directory is missing `manifest.json`.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadKeystore, signManifest } from "../packages/manifest/src/index.js";

interface RegistryAddon {
  readonly id: string;
  readonly path: string;
}
interface Registry {
  readonly addons: readonly RegistryAddon[];
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = resolve(REPO_ROOT, "addons/official/index.json");

function parseArgs(argv: readonly string[]): { keystorePath: string } {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    throw new Error("usage: sign-all-official <keystore.json>");
  }
  return { keystorePath: resolve(positional[0] as string) };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadRegistry(): Promise<Registry> {
  const raw = JSON.parse(await readFile(REGISTRY, "utf8")) as { addons?: unknown };
  if (!Array.isArray(raw.addons)) throw new Error("registry.addons missing");
  for (const a of raw.addons) {
    if (!a || typeof a !== "object") throw new Error("addon entry not an object");
    const o = a as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.path !== "string") {
      throw new Error("addon entry missing id/path");
    }
  }
  return raw as Registry;
}

async function preflight(registry: Registry): Promise<void> {
  const missing: string[] = [];
  for (const a of registry.addons) {
    const manifestPath = resolve(REPO_ROOT, a.path, "manifest.json");
    if (!(await exists(manifestPath))) missing.push(`${a.id} (${manifestPath})`);
  }
  if (missing.length > 0) {
    throw new Error(`missing manifest.json for:\n  - ${missing.join("\n  - ")}`);
  }
}

async function main(): Promise<void> {
  const { keystorePath } = parseArgs(process.argv.slice(2));
  if (!(await exists(keystorePath))) throw new Error(`keystore not found: ${keystorePath}`);
  const kp = await loadKeystore(JSON.parse(await readFile(keystorePath, "utf8")));
  const registry = await loadRegistry();
  await preflight(registry);

  console.log(`keystore  ${keystorePath}`);
  console.log(`publicKey ${kp.publicKeyBase64}`);
  console.log(`addons    ${registry.addons.length}`);
  console.log("");

  for (const a of registry.addons) {
    const dir = resolve(REPO_ROOT, a.path);
    const manifestPath = resolve(dir, "manifest.json");
    const sigPath = resolve(dir, "manifest.sig.json");
    const bytes = new Uint8Array(await readFile(manifestPath));
    const sig = await signManifest({ manifestBytes: bytes, keyPair: kp });
    await writeFile(sigPath, `${JSON.stringify(sig, null, 2)}\n`, "utf8");
    console.log(`  signed  ${a.id.padEnd(28)}  ${a.path}`);
  }
  console.log("");
  console.log("done. run `pnpm verify:official` to confirm.");
}

main().catch((err) => {
  console.error(`sign-all-official: ${(err as Error).message}`);
  process.exit(1);
});
