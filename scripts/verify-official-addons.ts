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

// ADR-0017 v2 closed-enum categories. v1 readers ignore the new field.
const KNOWN_CATEGORIES: readonly string[] = [
  "communication",
  "creative",
  "productivity",
  "presence",
  "files",
  "games",
  "education",
  "accessibility",
  "developer-tools",
  "other",
];

const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

interface AddonDeprecation {
  readonly since: string;
  readonly reason: string;
  readonly supersededBy?: string;
}

interface RegistryAddon {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly path: string;
  readonly capabilities: readonly string[];
  // ADR-0017 v2 optional fields. Always undefined when reading a v1 registry.
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
  readonly deprecated?: AddonDeprecation;
}

interface Registry {
  readonly v: 1 | 2;
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

function validateAddonDeprecation(value: unknown, where: string): AddonDeprecation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}.deprecated: must be an object`);
  }
  const d = value as Record<string, unknown>;
  if (typeof d.since !== "string" || Number.isNaN(Date.parse(d.since))) {
    throw new Error(`${where}.deprecated.since: must be ISO-8601`);
  }
  if (typeof d.reason !== "string" || d.reason.length === 0 || d.reason.length > 280) {
    throw new Error(`${where}.deprecated.reason: must be 1..280 char string`);
  }
  if (d.supersededBy !== undefined && typeof d.supersededBy !== "string") {
    throw new Error(`${where}.deprecated.supersededBy: must be a string when present`);
  }
  return {
    since: d.since,
    reason: d.reason,
    ...(typeof d.supersededBy === "string" ? { supersededBy: d.supersededBy } : {}),
  };
}

function validateRegistry(input: unknown): Registry {
  if (!input || typeof input !== "object") throw new Error("registry: not an object");
  const o = input as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) throw new Error("registry: v must be 1 or 2");
  const v = o.v as 1 | 2;
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
    const where = `addon[${i}]`;
    if (!raw || typeof raw !== "object") throw new Error(`${where}: not an object`);
    const a = raw as Record<string, unknown>;
    for (const k of ["id", "name", "version", "description", "path"]) {
      if (typeof a[k] !== "string") throw new Error(`${where}.${k}: must be string`);
    }
    if (!isStringArray(a.capabilities))
      throw new Error(`${where}.capabilities: must be string array`);
    // v2 optional fields; absence is fine even on v2 registries.
    let categories: readonly string[] | undefined;
    if (a.categories !== undefined) {
      if (!isStringArray(a.categories)) {
        throw new Error(`${where}.categories: must be string array`);
      }
      for (const c of a.categories) {
        if (!KNOWN_CATEGORIES.includes(c)) {
          throw new Error(
            `${where}.categories: unknown category ${JSON.stringify(c)} (allowed: ${KNOWN_CATEGORIES.join(", ")})`,
          );
        }
      }
      categories = a.categories;
    }
    let tags: readonly string[] | undefined;
    if (a.tags !== undefined) {
      if (!isStringArray(a.tags)) throw new Error(`${where}.tags: must be string array`);
      if (a.tags.length > 8) throw new Error(`${where}.tags: at most 8 entries`);
      for (const t of a.tags) {
        if (!TAG_PATTERN.test(t)) {
          throw new Error(
            `${where}.tags: invalid tag ${JSON.stringify(t)} (kebab-case, ≤32 chars)`,
          );
        }
      }
      tags = a.tags;
    }
    let deprecated: AddonDeprecation | undefined;
    if (a.deprecated !== undefined) {
      deprecated = validateAddonDeprecation(a.deprecated, where);
    }
    return {
      id: a.id as string,
      name: a.name as string,
      version: a.version as string,
      description: a.description as string,
      path: a.path as string,
      capabilities: a.capabilities,
      ...(categories ? { categories } : {}),
      ...(tags ? { tags } : {}),
      ...(deprecated ? { deprecated } : {}),
    };
  });
  // Cross-check: deprecated.supersededBy SHOULD point at another id in this
  // registry. Across-registry pointers are allowed but not validated here.
  const ids = new Set(addons.map((a) => a.id));
  for (const a of addons) {
    if (a.deprecated?.supersededBy && !ids.has(a.deprecated.supersededBy)) {
      throw new Error(
        `addon ${a.id}: deprecated.supersededBy ${a.deprecated.supersededBy} is not present in this registry`,
      );
    }
  }
  return {
    v,
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
