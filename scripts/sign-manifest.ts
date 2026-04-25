#!/usr/bin/env tsx
/**
 * pnpm sign:manifest <addon-dir> --key <keystore.json>
 * pnpm sign:manifest <addon-dir> --generate-key <keystore.json> [--force]
 *
 * Reads `<addon-dir>/manifest.json` byte-for-byte, signs with Ed25519,
 * writes `<addon-dir>/manifest.sig.json`.
 *
 * Spec: docs/addon-signing-spec.md.  Keystore: docs/adr/0009-keystore-minimum.md.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type SennKeyPair,
  exportKeystore,
  generateKeyPair,
  loadKeystore,
  signManifest,
} from "../packages/manifest/src/index.js";

interface Args {
  readonly addonDir: string;
  readonly keyPath?: string;
  readonly generateKeyPath?: string;
  readonly force: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  let keyPath: string | undefined;
  let generateKeyPath: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--key") {
      keyPath = argv[++i];
    } else if (a === "--generate-key") {
      generateKeyPath = argv[++i];
    } else if (a === "--force") {
      force = true;
    } else if (a !== undefined) {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    throw new Error(
      "usage: sign-manifest <addon-dir> (--key <ks.json> | --generate-key <ks.json> [--force])",
    );
  }
  if (!keyPath && !generateKeyPath) {
    throw new Error("must provide --key or --generate-key");
  }
  if (keyPath && generateKeyPath) {
    throw new Error("--key and --generate-key are mutually exclusive");
  }
  return {
    addonDir: positional[0] as string,
    ...(keyPath !== undefined ? { keyPath } : {}),
    ...(generateKeyPath !== undefined ? { generateKeyPath } : {}),
    force,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadOrGenerate(args: Args): Promise<SennKeyPair> {
  if (args.keyPath) {
    const raw = await readFile(args.keyPath, "utf8");
    return loadKeystore(JSON.parse(raw));
  }
  const path = args.generateKeyPath as string;
  if (!args.force && (await exists(path))) {
    throw new Error(`refusing to overwrite existing keystore ${path} (use --force)`);
  }
  const kp = await generateKeyPair();
  const ks = await exportKeystore(kp);
  await writeFile(path, `${JSON.stringify(ks, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`generated keystore: ${path}  (publicKey ${kp.publicKeyBase64})`);
  return kp;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.addonDir);
  const manifestPath = resolve(dir, "manifest.json");
  const sigPath = resolve(dir, "manifest.sig.json");
  if (!(await exists(manifestPath))) {
    throw new Error(`manifest not found: ${manifestPath}`);
  }
  const bytes = await readFile(manifestPath);
  const kp = await loadOrGenerate(args);
  const sig = await signManifest({ manifestBytes: new Uint8Array(bytes), keyPair: kp });
  await writeFile(sigPath, `${JSON.stringify(sig, null, 2)}\n`, "utf8");
  console.log(`signed: ${manifestPath} -> ${sigPath}`);
  console.log(`  publicKey  ${sig.publicKey}`);
  console.log(`  signedAt   ${sig.signedAt}`);
}

main().catch((err) => {
  console.error(`sign-manifest: ${(err as Error).message}`);
  process.exit(1);
});
