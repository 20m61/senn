#!/usr/bin/env tsx
/**
 * Bundle a SENN add-on directory into a static, deployable artefact.
 * Stub: validates the manifest path exists and prints the future plan.
 */
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: build-addon.ts <addon-dir>");
    process.exit(1);
  }
  const dir = resolve(target);
  await stat(dir);
  console.log(`build-addon stub — would package ${dir}`);
  console.log("planned steps: validate manifest -> minify -> hash -> emit dist/");
}

void main();
