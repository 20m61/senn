#!/usr/bin/env tsx
/**
 * Conformance check for docs/room-and-invite-spec.md.
 *
 * Usage:
 *   pnpm tsx scripts/validate-invite.ts <payload.json>          # verify
 *   pnpm tsx scripts/validate-invite.ts <payload.json> --update # regenerate fixtures
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  INVITE_URL_MAX_LENGTH,
  type InvitePayload,
  buildInviteUrl,
  decodeInvite,
  encodeInvite,
  validateInvitePayload,
} from "../packages/protocol/src/invite.js";

const BASE_URL = "https://senn.example/r/";

function die(msg: string): never {
  console.error(`validate-invite: ${msg}`);
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
  if (!target) die("usage: validate-invite.ts <payload.json> [--update]");
  const update = flag === "--update";

  const payloadPath = resolve(target);
  const raw = await readFile(payloadPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(`payload is not valid JSON: ${(err as Error).message}`);
  }

  let payload: InvitePayload;
  try {
    payload = validateInvitePayload(parsed);
  } catch (err) {
    die(`payload failed schema validation: ${(err as Error).message}`);
  }

  const encoded = await encodeInvite(payload);
  const url = await buildInviteUrl(BASE_URL, payload);

  if (url.length > INVITE_URL_MAX_LENGTH) {
    die(`URL is ${url.length} chars, exceeds spec max ${INVITE_URL_MAX_LENGTH}`);
  }

  const roundTripped = await decodeInvite(encoded);
  if (!deepEqual(payload, roundTripped)) {
    die("round-trip mismatch: decode(encode(p)) !== p");
  }

  const dir = dirname(payloadPath);
  const encodedFile = resolve(dir, "encoded.txt");
  const urlFile = resolve(dir, "url.txt");

  if (update) {
    await writeFile(encodedFile, `${encoded}\n`, "utf8");
    await writeFile(urlFile, `${url}\n`, "utf8");
    console.log(`updated: ${encodedFile}`);
    console.log(`updated: ${urlFile}`);
  } else {
    const expected = await readFile(encodedFile, "utf8").catch(() => {
      die(`missing fixture: ${encodedFile} — run with --update to generate`);
    });
    if ((expected as string).trim() !== encoded) {
      die("encoded form drifted from fixture — run with --update if the spec changed");
    }
    const expectedUrl = await readFile(urlFile, "utf8").catch(() => {
      die(`missing fixture: ${urlFile} — run with --update to generate`);
    });
    if ((expectedUrl as string).trim() !== url) {
      die("url form drifted from fixture — run with --update if the spec changed");
    }
  }

  console.log(`ok: ${payloadPath}`);
  console.log(`    encoded length = ${encoded.length}`);
  console.log(`    url length     = ${url.length} (limit ${INVITE_URL_MAX_LENGTH})`);
}

void main();
