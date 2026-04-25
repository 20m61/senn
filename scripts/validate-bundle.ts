#!/usr/bin/env tsx
/**
 * Conformance check for docs/signaling-url-fragment-spec.md.
 *
 * Usage:
 *   pnpm validate:bundle <bundle.json>
 *   pnpm validate:bundle <bundle.json> --update
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  type SignalingBundleV1,
  decodeSignalingBundle,
  encodeSignalingBundle,
  validateSignalingBundle,
} from "../packages/protocol/src/bundle.js";

function die(msg: string): never {
  console.error(`validate-bundle: ${msg}`);
  process.exit(1);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ae = Object.entries(a as Record<string, unknown>);
    const be = b as Record<string, unknown>;
    if (ae.length !== Object.keys(be).length) return false;
    return ae.every(([k, v]) => deepEqual(v, be[k]));
  }
  return false;
}

async function main(): Promise<void> {
  const [, , target, flag] = process.argv;
  if (!target) die("usage: validate-bundle.ts <bundle.json> [--update]");
  const update = flag === "--update";

  const bundlePath = resolve(target);
  const raw = await readFile(bundlePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(`bundle is not valid JSON: ${(err as Error).message}`);
  }

  let bundle: SignalingBundleV1;
  try {
    bundle = validateSignalingBundle(parsed);
  } catch (err) {
    die(`bundle failed schema validation: ${(err as Error).message}`);
  }

  const encoded = await encodeSignalingBundle(bundle);
  const roundTripped = await decodeSignalingBundle(encoded);
  if (!deepEqual(bundle, roundTripped)) {
    die("round-trip mismatch: decode(encode(b)) !== b");
  }

  const dir = dirname(bundlePath);
  const encodedFile = resolve(dir, "encoded.txt");

  if (update) {
    await writeFile(encodedFile, `${encoded}\n`, "utf8");
    console.log(`updated: ${encodedFile}`);
  } else {
    const expected = await readFile(encodedFile, "utf8").catch(() => {
      die(`missing fixture: ${encodedFile} — run with --update to generate`);
    });
    if ((expected as string).trim() !== encoded) {
      die("encoded form drifted from fixture — run with --update if the spec changed");
    }
  }

  console.log(`ok: ${bundlePath}`);
  console.log(`    encoded length = ${encoded.length}`);
  console.log(`    messages       = ${bundle.messages.length}`);
}

void main();
