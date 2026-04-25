#!/usr/bin/env tsx
/**
 * pnpm build:web-registry
 *
 * Copies the canonical `addons/official/index.json` into
 * `apps/web/public/registry/official/index.json` so the demo web
 * app can fetch the trust root and render an addon launcher.
 *
 * The web build does not run when stale: CI re-runs this and fails
 * if the working tree differs (mirrors `build:addon-sdk`).
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(REPO_ROOT, "addons/official/index.json");
const DEST = resolve(REPO_ROOT, "apps/web/public/registry/official/index.json");

async function main(): Promise<void> {
  await mkdir(dirname(DEST), { recursive: true });
  await copyFile(SOURCE, DEST);
  console.log(`copied  ${SOURCE}`);
  console.log(`     -> ${DEST}`);
}

main().catch((err) => {
  console.error(`build-web-registry: ${(err as Error).message}`);
  process.exit(1);
});
