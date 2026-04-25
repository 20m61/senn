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

interface RegistryAddon {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly path: string;
  readonly capabilities: readonly string[];
}

interface RegistryV1 {
  readonly v: 1;
  readonly publisher: { readonly name: string; readonly homepage?: string };
  readonly trustedKeys: readonly string[];
  readonly addons: readonly RegistryAddon[];
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REGISTRY = resolve(REPO_ROOT, "addons/official/index.json");

interface Args {
  readonly registry: string;
}

function parseArgs(argv: readonly string[]): Args {
  let registry = DEFAULT_REGISTRY;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--registry") {
      const v = argv[++i];
      if (typeof v !== "string") throw new Error("--registry needs a path");
      registry = resolve(v);
    } else if (a !== undefined) {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { registry };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateRegistry(input: unknown): RegistryV1 {
  if (!input || typeof input !== "object") throw new Error("registry: not an object");
  const o = input as Record<string, unknown>;
  if (o.v !== 1) throw new Error("registry: v must be 1");
  const pub = o.publisher;
  if (!pub || typeof pub !== "object") throw new Error("registry: publisher must be an object");
  const publisher = pub as Record<string, unknown>;
  if (typeof publisher.name !== "string")
    throw new Error("registry: publisher.name must be string");
  if (!isStringArray(o.trustedKeys) || o.trustedKeys.length === 0) {
    throw new Error("registry: trustedKeys must be a non-empty string array");
  }
  if (!Array.isArray(o.addons)) throw new Error("registry: addons must be an array");
  const addons: RegistryAddon[] = o.addons.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`addon[${i}]: not an object`);
    const a = raw as Record<string, unknown>;
    for (const k of ["id", "name", "version", "description", "path"]) {
      if (typeof a[k] !== "string") throw new Error(`addon[${i}].${k}: must be string`);
    }
    if (!isStringArray(a.capabilities))
      throw new Error(`addon[${i}].capabilities: must be string array`);
    return {
      id: a.id as string,
      name: a.name as string,
      version: a.version as string,
      description: a.description as string,
      path: a.path as string,
      capabilities: a.capabilities,
    };
  });
  return {
    v: 1,
    publisher: {
      name: publisher.name,
      ...(typeof publisher.homepage === "string" ? { homepage: publisher.homepage } : {}),
    },
    trustedKeys: o.trustedKeys,
    addons,
  };
}

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
}

main().catch((err) => {
  console.error(`verify-official-addons: ${(err as Error).message}`);
  process.exit(1);
});
