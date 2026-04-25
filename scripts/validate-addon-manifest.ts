#!/usr/bin/env tsx
/**
 * Validate a single SENN add-on manifest. See docs/addon-manifest.md.
 * Usage: pnpm validate:addon <path-to-manifest.json>
 */
import { resolve } from "node:path";

import { ManifestValidationError, validateManifestFile } from "./lib/manifest.js";

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: validate-addon-manifest.ts <manifest.json>");
    process.exit(1);
  }
  const path = resolve(target);
  try {
    await validateManifestFile(path);
  } catch (err) {
    if (err instanceof ManifestValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  console.log(`ok: ${path}`);
}

void main();
