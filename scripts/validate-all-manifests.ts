#!/usr/bin/env tsx
/**
 * Walk every place SENN expects to find an add-on manifest, and validate
 * each one. CI uses this; local devs can use it before opening a PR.
 *
 * Usage: pnpm validate:all-manifests
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ManifestValidationError, validateManifestFile } from "./lib/manifest.js";

// Scripts are invoked from the workspace root via pnpm, so cwd is the repo root.
const ROOT = process.cwd();

const SCAN_ROOTS: readonly string[] = ["addons/official", "addons/community", "examples"];

async function findManifests(dir: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findManifests(p)));
    } else if (entry.isFile() && entry.name === "manifest.json") {
      out.push(p);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const manifests: string[] = [];
  for (const rel of SCAN_ROOTS) {
    manifests.push(...(await findManifests(resolve(ROOT, rel))));
  }
  manifests.sort();

  if (manifests.length === 0) {
    console.error("validate-all-manifests: no manifest.json files found under any scan root");
    process.exit(1);
  }

  let failures = 0;
  for (const path of manifests) {
    const display = path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
    try {
      await validateManifestFile(path);
      console.log(`ok: ${display}`);
    } catch (err) {
      failures++;
      if (err instanceof ManifestValidationError) {
        console.error(`FAIL: ${display} — ${err.message.split(": ").slice(1).join(": ")}`);
      } else {
        console.error(`FAIL: ${display} — ${(err as Error).message}`);
      }
    }
  }

  console.log("");
  console.log(`scanned ${manifests.length} manifests, ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

void main();
