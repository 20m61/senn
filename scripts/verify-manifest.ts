#!/usr/bin/env tsx
/**
 * pnpm verify:manifest <addon-dir> [--trusted-key <b64url>]...
 *
 * Reads `<addon-dir>/manifest.json` and `<addon-dir>/manifest.sig.json`,
 * runs the verifier against the bytes, and exits non-zero on failure.
 *
 * Spec: docs/addon-signing-spec.md.
 */
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateSignaturePayload, verifyManifest } from "../packages/manifest/src/index.js";

interface Args {
  readonly addonDir: string;
  readonly trustedKeys: ReadonlySet<string>;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const trustedKeys = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--trusted-key") {
      const k = argv[++i];
      if (typeof k === "string") trustedKeys.add(k);
    } else if (a !== undefined) {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    throw new Error("usage: verify-manifest <addon-dir> [--trusted-key <b64url>]…");
  }
  return { addonDir: positional[0] as string, trustedKeys };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.addonDir);
  const manifestPath = resolve(dir, "manifest.json");
  const sigPath = resolve(dir, "manifest.sig.json");
  if (!(await exists(manifestPath))) throw new Error(`missing manifest: ${manifestPath}`);
  if (!(await exists(sigPath))) throw new Error(`missing signature: ${sigPath}`);

  const manifestBytes = new Uint8Array(await readFile(manifestPath));
  const sigPayload = validateSignaturePayload(JSON.parse(await readFile(sigPath, "utf8")));

  const result = await verifyManifest({
    manifestBytes,
    signature: sigPayload,
    ...(args.trustedKeys.size > 0 ? { trustedKeys: args.trustedKeys } : {}),
  });

  if (!result.ok) {
    console.error(`verify-manifest: FAIL — ${result.reason ?? "unknown"}`);
    process.exit(1);
  }
  console.log(`ok: ${manifestPath}`);
  console.log(`  publicKey  ${sigPayload.publicKey}`);
  console.log(`  signedAt   ${sigPayload.signedAt}`);
  if (args.trustedKeys.size === 0) {
    console.log("  (no --trusted-key supplied; signature was verified against its own key)");
  }
}

main().catch((err) => {
  console.error(`verify-manifest: ${(err as Error).message}`);
  process.exit(1);
});
