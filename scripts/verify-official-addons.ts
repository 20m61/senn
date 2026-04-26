#!/usr/bin/env tsx
/**
 * pnpm verify:official [--registry addons/official/index.json]
 *
 * Walks the official registry index, verifies each addon's
 * manifest.sig.json against the served bytes of manifest.json, and
 * enforces that every signing key is in the registry's `trustedKeys`.
 *
 * Spec: docs/addon-signing-spec.md.  Trust root: addons/official/README.md.
 */
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ManifestSignatureV1,
  validateSignaturePayload,
  verifyManifest,
} from "../packages/manifest/src/index.js";
import {
  type RegistryAddon,
  validateMetaIndex as validateMetaIndexImpl,
  validateRegistry as validateRegistryImpl,
} from "./lib/registry-schema.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REGISTRY = resolve(REPO_ROOT, "addons/official/index.json");
const DEFAULT_META = resolve(REPO_ROOT, "addons/official/meta.json");

interface Args {
  readonly registry: string;
  readonly meta: string;
}

function parseArgs(argv: readonly string[]): Args {
  let registry = DEFAULT_REGISTRY;
  let meta = DEFAULT_META;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--registry") {
      const v = argv[++i];
      if (typeof v !== "string") throw new Error("--registry needs a path");
      registry = resolve(v);
    } else if (a === "--meta") {
      const v = argv[++i];
      if (typeof v !== "string") throw new Error("--meta needs a path");
      meta = resolve(v);
    } else if (a !== undefined) {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { registry, meta };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Schema validation lives in scripts/lib/registry-schema.ts so the
// schema-only `validate:registry` CLI can share it. Wrap with the names
// the rest of this file uses.
const validateRegistry = validateRegistryImpl;
const validateMetaIndex = validateMetaIndexImpl;

interface AddonResult {
  readonly id: string;
  readonly path: string;
  readonly ok: boolean;
  readonly reason?: string;
  readonly publicKey?: string;
  readonly signedAt?: string;
}

async function verifyAddon(
  addon: RegistryAddon,
  trustedKeys: ReadonlySet<string>,
  registryDir: string,
): Promise<AddonResult> {
  const dir = resolve(REPO_ROOT, addon.path);
  const manifestPath = resolve(dir, "manifest.json");
  const sigPath = resolve(dir, "manifest.sig.json");
  if (!(await exists(manifestPath))) {
    return { id: addon.id, path: addon.path, ok: false, reason: "manifest.json missing" };
  }
  if (!(await exists(sigPath))) {
    return { id: addon.id, path: addon.path, ok: false, reason: "manifest.sig.json missing" };
  }
  let sig: ManifestSignatureV1;
  try {
    sig = validateSignaturePayload(JSON.parse(await readFile(sigPath, "utf8")));
  } catch (err) {
    return {
      id: addon.id,
      path: addon.path,
      ok: false,
      reason: `signature schema: ${(err as Error).message}`,
    };
  }
  const manifestBytes = new Uint8Array(await readFile(manifestPath));
  const result = await verifyManifest({ manifestBytes, signature: sig, trustedKeys });
  if (!result.ok) {
    return {
      id: addon.id,
      path: addon.path,
      ok: false,
      reason: result.reason ?? "verify failed",
      publicKey: sig.publicKey,
      signedAt: sig.signedAt,
    };
  }
  // Cross-check: the manifest body's id/version/description must match the
  // registry entry. (Description match catches user-facing copy drift like
  // the local-vault "64 KiB single-frame" bug ultrareview surfaced.)
  const manifestText = new TextDecoder().decode(manifestBytes);
  const manifest = JSON.parse(manifestText) as {
    id?: unknown;
    version?: unknown;
    description?: unknown;
  };
  if (manifest.id !== addon.id) {
    return {
      id: addon.id,
      path: addon.path,
      ok: false,
      reason: `manifest.id ${String(manifest.id)} != registry id ${addon.id}`,
      publicKey: sig.publicKey,
      signedAt: sig.signedAt,
    };
  }
  if (manifest.version !== addon.version) {
    return {
      id: addon.id,
      path: addon.path,
      ok: false,
      reason: `manifest.version ${String(manifest.version)} != registry version ${addon.version}`,
      publicKey: sig.publicKey,
      signedAt: sig.signedAt,
    };
  }
  if (typeof manifest.description === "string" && manifest.description !== addon.description) {
    return {
      id: addon.id,
      path: addon.path,
      ok: false,
      reason: `manifest.description != registry description (manifest=${JSON.stringify(manifest.description)} registry=${JSON.stringify(addon.description)})`,
      publicKey: sig.publicKey,
      signedAt: sig.signedAt,
    };
  }
  void registryDir;
  return {
    id: addon.id,
    path: addon.path,
    ok: true,
    publicKey: sig.publicKey,
    signedAt: sig.signedAt,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!(await exists(args.registry))) {
    throw new Error(`registry not found: ${args.registry}`);
  }
  const registry = validateRegistry(JSON.parse(await readFile(args.registry, "utf8")));
  const trustedKeys = new Set(registry.trustedKeys);

  console.log(`registry  ${args.registry}`);
  console.log(`publisher ${registry.publisher.name}`);
  console.log(`keys      ${[...trustedKeys].join(", ")}`);
  console.log(`addons    ${registry.addons.length}`);
  console.log("");

  const results = await Promise.all(
    registry.addons.map((a) => verifyAddon(a, trustedKeys, dirname(args.registry))),
  );

  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ok    ${r.id.padEnd(28)}  ${r.path}`);
    } else {
      failed++;
      console.error(`  FAIL  ${r.id.padEnd(28)}  ${r.path}  — ${r.reason}`);
    }
  }
  console.log("");
  if (failed > 0) {
    console.error(`verify-official-addons: ${failed} of ${results.length} failed`);
    process.exit(1);
  }
  console.log(`verify-official-addons: ${results.length} ok`);

  if (await exists(args.meta)) {
    const meta = validateMetaIndex(JSON.parse(await readFile(args.meta, "utf8")));
    console.log("");
    console.log(`meta      ${args.meta}`);
    console.log(`kind      ${meta.kind} v${meta.v}`);
    console.log(`publishers ${meta.publishers.length}`);
    for (const p of meta.publishers) {
      const tag = p.featured ? "★" : " ";
      console.log(`  ${tag} ${(p.name ?? "(unnamed)").padEnd(28)}  ${p.url}`);
    }
    console.log("");
    console.log(`verify-meta-index: ${meta.publishers.length} publishers ok`);
  }
}

main().catch((err) => {
  console.error(`verify-official-addons: ${(err as Error).message}`);
  process.exit(1);
});
