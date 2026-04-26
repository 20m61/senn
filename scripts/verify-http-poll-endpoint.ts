#!/usr/bin/env tsx
/**
 * pnpm verify:http-poll-endpoint <endpoint-url> [--interval <ms>] [--keep]
 *
 * Black-box conformance check for any Tier-1 HTTP-poll signaling
 * endpoint (docs/signaling-http-poll-spec.md). Operators point this
 * at their deployed signal.php / server.mjs / language-of-choice
 * implementation to confirm it speaks the wire contract.
 *
 * Endpoint URL form: `https://your-host/signal` (no trailing slash,
 * no roomId — the adapter appends `/<roomId>`).
 *
 * Exits 0 on success, non-zero with a precise reason on failure.
 */
import { newPeerId, newRoomId } from "../packages/protocol/src/index.js";
import { HttpPollSignaling } from "../packages/signaling-http-poll/src/index.js";

interface Args {
  readonly endpoint: string;
  readonly intervalMs: number;
  readonly keepRoom: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  let intervalMs = 250;
  let keepRoom = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--interval") {
      intervalMs = Number(argv[++i]);
      if (!Number.isFinite(intervalMs) || intervalMs < 50) {
        throw new Error("--interval must be ≥ 50 ms");
      }
    } else if (a === "--keep") {
      keepRoom = true;
    } else if (typeof a === "string") {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    throw new Error("usage: verify-http-poll-endpoint <endpoint-url> [--interval <ms>] [--keep]");
  }
  return { endpoint: positional[0] as string, intervalMs, keepRoom };
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v !== undefined && v !== null) return v as T;
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface RunChecksArgs {
  readonly endpoint: string;
  readonly intervalMs: number;
}

export async function runChecks(args: RunChecksArgs): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const room = newRoomId();
  const alice = newPeerId();

  // 1. publish + subscribe round-trip
  const aliceTx = new HttpPollSignaling({ endpoint: args.endpoint, intervalMs: args.intervalMs });
  const bobTx = new HttpPollSignaling({ endpoint: args.endpoint, intervalMs: args.intervalMs });
  try {
    const inbox: { kind: string; from: string }[] = [];
    bobTx.subscribe(room, (m) => inbox.push({ kind: m.kind, from: m.from }));
    await aliceTx.publish(room, { kind: "offer", from: alice, sdp: "v=0\r\n…" });
    try {
      const got = await waitFor(() => (inbox.length > 0 ? inbox[0] : undefined));
      if (got?.kind === "offer" && got.from === alice) {
        results.push({ name: "POST then GET delivers the message", ok: true });
      } else {
        results.push({
          name: "POST then GET delivers the message",
          ok: false,
          detail: `delivered ${JSON.stringify(got)} but expected offer from ${alice}`,
        });
      }
    } catch (err) {
      results.push({
        name: "POST then GET delivers the message",
        ok: false,
        detail: (err as Error).message,
      });
    }
  } finally {
    await aliceTx.close();
    await bobTx.close();
  }

  // 2. malformed roomId rejected with 4xx
  const badRoomTx = new HttpPollSignaling({
    endpoint: args.endpoint,
    intervalMs: args.intervalMs,
  });
  try {
    const bogus = "not-a-room-id" as unknown as ReturnType<typeof newRoomId>;
    await badRoomTx.publish(bogus, { kind: "offer", from: newPeerId(), sdp: "v=0" });
    results.push({
      name: "malformed roomId rejected",
      ok: false,
      detail: "publish unexpectedly succeeded",
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/400|bad room|invalid room/i.test(msg)) {
      results.push({ name: "malformed roomId rejected", ok: true });
    } else {
      results.push({
        name: "malformed roomId rejected",
        ok: false,
        detail: `rejected, but message did not mention 400/bad-room: ${msg}`,
      });
    }
  } finally {
    await badRoomTx.close();
  }

  // 3. unknown signaling kind rejected with 4xx
  const badKindTx = new HttpPollSignaling({
    endpoint: args.endpoint,
    intervalMs: args.intervalMs,
  });
  try {
    const otherRoom = newRoomId();
    const bogus = { kind: "not-a-kind", from: newPeerId() } as unknown as Parameters<
      HttpPollSignaling["publish"]
    >[1];
    await badKindTx.publish(otherRoom, bogus);
    results.push({
      name: "unknown signaling kind rejected",
      ok: false,
      detail: "publish unexpectedly succeeded",
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/400/.test(msg)) {
      results.push({ name: "unknown signaling kind rejected", ok: true });
    } else {
      results.push({
        name: "unknown signaling kind rejected",
        ok: false,
        detail: `rejected, but message did not mention 400: ${msg}`,
      });
    }
  } finally {
    await badKindTx.close();
  }

  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`endpoint     ${args.endpoint}`);
  console.log(`interval     ${args.intervalMs} ms`);
  console.log("");

  let results: readonly CheckResult[];
  try {
    results = await runChecks(args);
  } catch (err) {
    console.error(`verify-http-poll-endpoint: ${(err as Error).message}`);
    process.exit(2);
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
    console.error(`verify-http-poll-endpoint: ${failed} of ${results.length} failed`);
    process.exit(1);
  }
  console.log(`verify-http-poll-endpoint: ${results.length} ok`);
}

// Run main() only when this file is invoked directly (as a script). When
// it is imported as a module (e.g., by `verify-http-poll-self-test.ts`),
// only the exports — `runChecks` and the result types — are needed.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`verify-http-poll-endpoint: ${(err as Error).message}`);
    process.exit(1);
  });
}
