#!/usr/bin/env tsx
/**
 * pnpm verify:http-poll-self-test
 *
 * In-process regression guard that boots the Node reference server
 * (`examples/signaling-http-poll-server/node/server.mjs`) on an
 * ephemeral port and runs the same `runChecks` suite that
 * `pnpm verify:http-poll-endpoint` ships to operators.
 *
 * It catches three classes of regression at once:
 *
 *   1. The black-box probe script's check logic stops matching the
 *      spec (`runChecks` in `verify-http-poll-endpoint.ts`).
 *   2. The Node reference server drifts away from
 *      `docs/signaling-http-poll-spec.md` (publish/subscribe
 *      round-trip, 4xx for malformed roomId / unknown kind).
 *   3. `@senn/signaling-http-poll` adapter changes break the wire
 *      contract end-to-end.
 *
 * Fast (~1 s); included in `pnpm conformance`.
 */

// @ts-expect-error — the reference server is a hand-written .mjs without
// type declarations; the surface we use (`startServer`) is documented in
// the file header and the README.
import { startServer } from "../examples/signaling-http-poll-server/node/server.mjs";

import { type CheckResult, runChecks } from "./verify-http-poll-endpoint.ts";

interface ServerHandle {
  readonly url: string;
  close(): Promise<void>;
}

async function main(): Promise<void> {
  const handle = (await startServer({ port: 0, host: "127.0.0.1" })) as ServerHandle;
  // The server treats every URL's last path segment as the roomId, so we
  // append `/signal` for ergonomic parity with the operator-facing
  // `verify:http-poll-endpoint` examples — `${endpoint}/<roomId>` is
  // exactly the URL shape the adapter constructs.
  const endpoint = `${handle.url}/signal`;
  console.log(`spawned reference server at ${endpoint}`);

  let results: readonly CheckResult[];
  try {
    // 200 ms is the adapter's minimum allowed poll interval. Self-test
    // is in-process so latency-of-poll dominates the runtime; we keep
    // it at the floor for the fastest possible regression run.
    results = await runChecks({ endpoint, intervalMs: 200 });
  } finally {
    await handle.close().catch(() => undefined);
  }

  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log(`  ok    ${r.name}`);
    } else {
      failed++;
      console.error(`  FAIL  ${r.name}  — ${r.detail ?? "no detail"}`);
    }
  }

  console.log("");
  if (failed > 0) {
    console.error(`verify-http-poll-self-test: ${failed} of ${results.length} failed`);
    process.exit(1);
  }
  console.log(`verify-http-poll-self-test: ${results.length} ok`);
}

main().catch((err) => {
  console.error(`verify-http-poll-self-test: ${(err as Error).message}`);
  process.exit(1);
});
