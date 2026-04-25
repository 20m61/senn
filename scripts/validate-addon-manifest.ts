#!/usr/bin/env tsx
/**
 * Minimal manifest validator. See docs/addon-manifest.md for the canonical schema.
 * Usage: pnpm tsx scripts/validate-addon-manifest.ts <path-to-manifest.json>
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REQUIRED_FIELDS = [
  "id",
  "name",
  "version",
  "entry",
  "license",
  "permissions",
  "network",
  "capabilities",
] as const;

const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const KNOWN_PERMISSIONS = new Set([
  "peer.send",
  "peer.receive",
  "storage.local.read",
  "storage.local.write",
  "file.read.user_selected",
  "file.write.user_approved",
  "ui.panel",
  "ui.overlay",
  "presence.read",
  "audio.level",
]);

interface Manifest {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  entry?: unknown;
  license?: unknown;
  permissions?: unknown;
  network?: unknown;
  capabilities?: unknown;
}

function fail(reason: string): never {
  console.error(`manifest invalid: ${reason}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) fail("usage: validate-addon-manifest.ts <manifest.json>");

  const path = resolve(target);
  const raw = await readFile(path, "utf8");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw) as Manifest;
  } catch (err) {
    fail(`not valid JSON: ${(err as Error).message}`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in manifest)) fail(`missing required field: ${field}`);
  }

  if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) {
    fail("id must match reverse-DNS pattern (see docs/addon-manifest.md)");
  }
  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    fail("version must be SemVer 2.0.0");
  }
  if (manifest.network !== false) {
    fail("network must be false");
  }
  if (!Array.isArray(manifest.permissions)) {
    fail("permissions must be an array");
  }
  for (const perm of manifest.permissions as unknown[]) {
    if (typeof perm !== "string" || !KNOWN_PERMISSIONS.has(perm)) {
      fail(`unknown permission: ${String(perm)}`);
    }
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    fail("capabilities must be a non-empty array");
  }

  console.log(`ok: ${path}`);
}

void main();
