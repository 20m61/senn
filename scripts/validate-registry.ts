#!/usr/bin/env tsx
/**
 * pnpm validate:registry <path-to-index-or-meta-or-submissions.json>
 *
 * Schema-only validation for the publisher index (v1/v2/v3),
 * publisher meta-index (ADR-0017 §3 + ADR-0020 §3b), and publisher
 * submissions index (ADR-0020 §2). Detects the document kind by
 * peeking at `kind` / `v` and dispatches accordingly. Does NOT verify
 * signatures or walk the filesystem; pair with `pnpm verify:official`
 * for the full check.
 *
 * Spec:
 *   - addons/official/README.md (v1)
 *   - docs/adr/0017-registry-schema-v2.md (v2)
 *   - docs/adr/0020-registry-schema-v3.md (v3)
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateMetaIndex, validateRegistry, validateSubmissions } from "./lib/registry-schema.js";

interface Args {
  readonly path: string;
}

function parseArgs(argv: readonly string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const first = positional[0];
  if (positional.length !== 1 || typeof first !== "string") {
    throw new Error("usage: pnpm validate:registry <path-to-json>");
  }
  return { path: resolve(first) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readFile(args.path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${args.path}: invalid JSON — ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${args.path}: top-level must be an object`);
  }
  const o = parsed as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "senn-publisher-meta") {
    const meta = validateMetaIndex(parsed);
    console.log(
      `validate-registry: meta-index v${meta.v} ok (${meta.publishers.length} publishers)`,
    );
    return;
  }
  if (kind === "senn-publisher-submissions") {
    const subs = validateSubmissions(parsed);
    console.log(
      `validate-registry: submissions v${subs.v} ok (${subs.submissions.length} submissions)`,
    );
    return;
  }
  // No discriminator → must be a publisher index.
  const reg = validateRegistry(parsed);
  console.log(
    `validate-registry: registry v${reg.v} ok (${reg.publisher.name}; ${reg.addons.length} addons)`,
  );
}

main().catch((err) => {
  console.error(`validate-registry: ${(err as Error).message}`);
  process.exit(1);
});
