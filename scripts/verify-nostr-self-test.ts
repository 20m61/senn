#!/usr/bin/env tsx
/**
 * pnpm verify:nostr-self-test
 *
 * In-process regression guard for `@senn/signaling-nostr`. Mirrors
 * `verify-http-poll-self-test.ts` for the Nostr Tier-1 adapter:
 *
 *   1. Stands up an in-memory NIP-01 mock relay that implements the
 *      slice of the wire contract the adapter exercises (REQ / EVENT /
 *      OK / CLOSE).
 *   2. Injects it into `NostrSignaling` via the `wsCtor` option.
 *   3. Runs each MUST clause from `docs/signaling-nostr-spec.md` as a
 *      named check, so a regression in the adapter or the spec mapping
 *      surfaces as a single line in the conformance summary.
 *
 * Fast (sub-second); included in `pnpm conformance`.
 *
 * The vitest contract suite under
 * `packages/signaling-nostr/test/contract.test.ts` covers the same
 * surface in unit-test form. This script exists so the conformance
 * gate ships a single, operator-readable smoke equivalent to
 * `verify:http-poll-self-test`.
 *
 * A real-relay equivalent (the analogue of `verify:http-poll-endpoint`)
 * is intentionally out of scope: WebSocket servers cannot be hosted by
 * the Node standard library, and the project's vendor-neutral stance
 * (ADR-0007) means the smoke MUST NOT bake in a default relay.
 */

import { type PeerId, type RoomId, newPeerId, newRoomId } from "../packages/protocol/src/index.js";
import { NostrSignaling, type SignalingMessage } from "../packages/signaling-nostr/src/index.js";

const SENN_NOSTR_KIND = 25556;
const SENN_TAG_PREFIX = "senn:";

interface NostrFilter {
  readonly kinds?: readonly number[];
  readonly "#t"?: readonly string[];
}

interface NostrEventLike {
  readonly id: string;
  readonly pubkey: string;
  readonly kind: number;
  readonly created_at: number;
  readonly tags: ReadonlyArray<readonly string[]>;
  readonly content: string;
  readonly sig: string;
}

class MockRelay {
  readonly published: NostrEventLike[] = [];
  private readonly subs = new Map<
    string,
    { readonly sock: FakeWebSocket; readonly filter: NostrFilter }
  >();
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  handle(sock: FakeWebSocket, raw: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(frame) || frame.length === 0) return;
    if (frame[0] === "REQ") {
      const subId = frame[1] as string;
      const filter = frame[2] as NostrFilter;
      this.subs.set(subId, { sock, filter });
      sock.deliver(JSON.stringify(["EOSE", subId]));
      return;
    }
    if (frame[0] === "CLOSE") {
      this.subs.delete(frame[1] as string);
      return;
    }
    if (frame[0] === "EVENT") {
      const event = frame[1] as NostrEventLike;
      this.published.push(event);
      sock.deliver(JSON.stringify(["OK", event.id, true, ""]));
      for (const [subId, { sock: s, filter }] of this.subs) {
        if (matches(filter, event)) s.deliver(JSON.stringify(["EVENT", subId, event]));
      }
    }
  }

  /**
   * Inject a kind-1 event with the same tag the adapter listens on.
   * The adapter MUST drop it (kind filter on the receive path).
   */
  injectForeignKind(roomId: RoomId, content: string): void {
    const fake: NostrEventLike = {
      id: `foreign-${this.name}-${this.published.length}`,
      pubkey: "00".repeat(32),
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["t", `${SENN_TAG_PREFIX}${roomId}`]],
      content,
      sig: "",
    };
    for (const [subId, { sock: s, filter }] of this.subs) {
      if (matches(filter, fake)) s.deliver(JSON.stringify(["EVENT", subId, fake]));
    }
  }
}

function matches(filter: NostrFilter, event: NostrEventLike): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter["#t"]) {
    const tagValues = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
    if (!filter["#t"].some((t) => tagValues.includes(t as string))) return false;
  }
  return true;
}

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  private static relays = new Map<string, MockRelay>();
  private readonly relay: MockRelay | null;

  static bindRelay(url: string, relay: MockRelay): void {
    FakeWebSocket.relays.set(url, relay);
  }

  static reset(): void {
    FakeWebSocket.relays.clear();
  }

  constructor(url: string) {
    super();
    this.relay = FakeWebSocket.relays.get(url) ?? null;
    queueMicrotask(() => {
      if (!this.relay) {
        this.dispatchEvent(new Event("error"));
        this.dispatchEvent(new Event("close"));
        return;
      }
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string): void {
    this.relay?.handle(this, data);
  }

  deliver(data: string): void {
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent("message", { data }));
    });
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

const FAKE_WS = FakeWebSocket as unknown as typeof WebSocket;

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

type CheckOutcome = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/**
 * Wraps a check body so each spec clause's check site only owns the
 * setup/assert/teardown shape — `name` is bound once at the call site
 * and surfacing a thrown error becomes an `{ ok: false, detail }`
 * result automatically. The body is responsible for its own
 * `try { … } finally { close() }` because adapter close is per-check.
 */
async function runCheck(name: string, body: () => Promise<CheckOutcome>): Promise<CheckResult> {
  try {
    const outcome = await body();
    return outcome.ok ? { name, ok: true } : { name, ok: false, detail: outcome.detail };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message };
  }
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 1_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v !== undefined && v !== null) return v as T;
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function offer(from: PeerId): SignalingMessage {
  return { kind: "offer", from, sdp: "v=0\r\n…" };
}

function hasSennRoomTag(event: NostrEventLike, roomId: RoomId): boolean {
  const expectedTag = `${SENN_TAG_PREFIX}${roomId}`;
  return event.tags.some((t) => t[0] === "t" && t[1] === expectedTag);
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. publish → subscribe round-trip via a single relay, with the
  //    adapter publishing kind 25556 and the matching #t tag (spec
  //    §"Normative checklist" 5–7).
  results.push(
    await runCheck("publish → subscribe round-trip", async () => {
      FakeWebSocket.reset();
      const relay = new MockRelay("solo");
      FakeWebSocket.bindRelay("ws://mock/solo", relay);
      const aliceTx = new NostrSignaling({ relays: ["ws://mock/solo"], wsCtor: FAKE_WS });
      const bobTx = new NostrSignaling({ relays: ["ws://mock/solo"], wsCtor: FAKE_WS });
      try {
        const room = newRoomId();
        const alice = newPeerId();
        const inbox: SignalingMessage[] = [];
        bobTx.subscribe(room, (m) => inbox.push(m));
        // Give the REQ a tick to land before the publish.
        await new Promise((r) => setTimeout(r, 5));
        await aliceTx.publish(room, offer(alice));
        await waitFor(() => (inbox.length > 0 ? inbox[0] : undefined));
        const got = inbox[0];
        const event = relay.published[0];
        if (!event) return { ok: false, detail: "no event seen by relay" };
        if (event.kind !== SENN_NOSTR_KIND) {
          return { ok: false, detail: `published kind ${event.kind}, expected ${SENN_NOSTR_KIND}` };
        }
        if (!hasSennRoomTag(event, room)) {
          return {
            ok: false,
            detail: `event tags missed the senn:<roomId> marker; got ${JSON.stringify(event.tags)}`,
          };
        }
        if (got?.kind === "offer" && got.from === alice) return { ok: true };
        return {
          ok: false,
          detail: `delivered ${JSON.stringify(got)} but expected offer from ${alice}`,
        };
      } finally {
        await aliceTx.close();
        await bobTx.close();
      }
    }),
  );

  // 2. Dedup across multiple relays — one logical message MUST surface
  //    once even when fanned out by N relays (spec §"Normative
  //    checklist" 8).
  results.push(
    await runCheck("dedup across multiple relays", async () => {
      FakeWebSocket.reset();
      const relayA = new MockRelay("a");
      const relayB = new MockRelay("b");
      FakeWebSocket.bindRelay("ws://mock/a", relayA);
      FakeWebSocket.bindRelay("ws://mock/b", relayB);
      const aliceTx = new NostrSignaling({
        relays: ["ws://mock/a", "ws://mock/b"],
        wsCtor: FAKE_WS,
      });
      const bobTx = new NostrSignaling({
        relays: ["ws://mock/a", "ws://mock/b"],
        wsCtor: FAKE_WS,
      });
      try {
        const room = newRoomId();
        const alice = newPeerId();
        const inbox: SignalingMessage[] = [];
        bobTx.subscribe(room, (m) => inbox.push(m));
        await new Promise((r) => setTimeout(r, 5));
        await aliceTx.publish(room, offer(alice));
        await waitFor(() => (inbox.length >= 1 ? inbox.length : undefined));
        // Settle window: a duplicate would arrive within a few ms via
        // the second relay's fan-out path.
        await new Promise((r) => setTimeout(r, 50));
        if (inbox.length === 1) return { ok: true };
        return { ok: false, detail: `delivered ${inbox.length} copies, expected 1` };
      } finally {
        await aliceTx.close();
        await bobTx.close();
      }
    }),
  );

  // 3. Receive-path kind filter — a relay that fans out a kind-1 event
  //    matching the same #t filter MUST NOT surface to the handler
  //    (spec §"Normative checklist" 5: "Every published event MUST be
  //    of kind: 25556" — the receive side has the symmetric obligation
  //    via the REQ filter).
  //
  //    Barrier strategy: inject the foreign-kind event first, then
  //    publish a real kind-25556 event through the same relay and wait
  //    for it to land in the inbox. The real event acts as a synchronous
  //    barrier — by the time it arrives, any earlier deliveries have
  //    already drained through the queueMicrotask chain. This avoids the
  //    timing fragility of a fixed `setTimeout`-only "absence" assertion.
  results.push(
    await runCheck("non-25556 events are dropped", async () => {
      FakeWebSocket.reset();
      const relay = new MockRelay("foreign");
      FakeWebSocket.bindRelay("ws://mock/foreign", relay);
      const subscriber = new NostrSignaling({ relays: ["ws://mock/foreign"], wsCtor: FAKE_WS });
      const publisher = new NostrSignaling({ relays: ["ws://mock/foreign"], wsCtor: FAKE_WS });
      try {
        const room = newRoomId();
        const probe = newPeerId();
        const inbox: SignalingMessage[] = [];
        subscriber.subscribe(room, (m) => inbox.push(m));
        await new Promise((r) => setTimeout(r, 5));
        // Foreign-kind first — would arrive before the real event if the
        // adapter's `handleEvent` failed to filter on kind.
        relay.injectForeignKind(
          room,
          JSON.stringify({ kind: "offer", from: newPeerId(), sdp: "x" }),
        );
        await publisher.publish(room, offer(probe));
        // Wait for the real event to land. Mock matches by #t, so the
        // relay's REQ filter alone wouldn't drop kind 1; the adapter's
        // `handleEvent` MUST filter on event.kind. (See
        // `packages/signaling-nostr/src/index.ts` `handleEvent`'s early
        // return when `event.kind !== SENN_NOSTR_KIND`.)
        await waitFor(() =>
          inbox.some((m) => m.kind === "offer" && m.from === probe) ? true : undefined,
        );
        if (inbox.length === 1 && inbox[0]?.kind === "offer" && inbox[0].from === probe) {
          return { ok: true };
        }
        return {
          ok: false,
          detail: `surfaced ${inbox.length} events; expected 1 real offer, got ${JSON.stringify(inbox)}`,
        };
      } finally {
        await subscriber.close();
        await publisher.close();
      }
    }),
  );

  // 4. publish rejects when every relay nacks (spec §"Reconnect
  //    behaviour" 3: "rejects only if every relay either NACKs or
  //    stays disconnected").
  results.push(
    await runCheck("publish rejects when every relay nacks", async () => {
      FakeWebSocket.reset();
      class AllNackWS extends EventTarget {
        static OPEN = 1;
        static CLOSED = 3;
        readyState = 0;
        constructor(_url: string) {
          super();
          queueMicrotask(() => {
            this.readyState = AllNackWS.OPEN;
            this.dispatchEvent(new Event("open"));
          });
        }
        send(raw: string): void {
          let frame: unknown;
          try {
            frame = JSON.parse(raw);
          } catch {
            return;
          }
          if (!Array.isArray(frame) || frame[0] !== "EVENT") return;
          const event = frame[1] as { id: string };
          queueMicrotask(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify(["OK", event.id, false, "rate-limited"]),
              }),
            );
          });
        }
        close(): void {
          if (this.readyState === AllNackWS.CLOSED) return;
          this.readyState = AllNackWS.CLOSED;
          this.dispatchEvent(new Event("close"));
        }
      }
      const tx = new NostrSignaling({
        relays: ["ws://nack/a", "ws://nack/b"],
        wsCtor: AllNackWS as unknown as typeof WebSocket,
        publishTimeoutMs: 500,
      });
      try {
        let rejection: string | null = null;
        try {
          await tx.publish(newRoomId(), offer(newPeerId()));
        } catch (err) {
          rejection = (err as Error).message;
        }
        if (rejection === null) return { ok: false, detail: "publish unexpectedly resolved" };
        if (/rate-limited/.test(rejection)) return { ok: true };
        return {
          ok: false,
          detail: `rejected, but message did not surface relay reason: ${rejection}`,
        };
      } finally {
        await tx.close();
      }
    }),
  );

  // 5. Each NostrSignaling construction uses a fresh ephemeral keypair
  //    (spec §"Normative checklist" 4: "MUST be ephemeral by default").
  results.push(
    await runCheck("ephemeral keypair per construction", async () => {
      FakeWebSocket.reset();
      const relay = new MockRelay("ephemeral");
      FakeWebSocket.bindRelay("ws://mock/ephemeral", relay);
      const a = new NostrSignaling({ relays: ["ws://mock/ephemeral"], wsCtor: FAKE_WS });
      const b = new NostrSignaling({ relays: ["ws://mock/ephemeral"], wsCtor: FAKE_WS });
      try {
        if (
          a.publicKey !== b.publicKey &&
          /^[0-9a-f]{64}$/.test(a.publicKey) &&
          /^[0-9a-f]{64}$/.test(b.publicKey)
        ) {
          return { ok: true };
        }
        return { ok: false, detail: `keys: ${a.publicKey} vs ${b.publicKey}` };
      } finally {
        await a.close();
        await b.close();
      }
    }),
  );

  return results;
}

async function main(): Promise<void> {
  console.log("verify-nostr-self-test: in-process NIP-01 mock relay");

  let results: readonly CheckResult[];
  try {
    results = await runChecks();
  } catch (err) {
    console.error(`verify-nostr-self-test: ${(err as Error).message}`);
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
    console.error(`verify-nostr-self-test: ${failed} of ${results.length} failed`);
    process.exit(1);
  }
  console.log(`verify-nostr-self-test: ${results.length} ok`);
}

main().catch((err) => {
  console.error(`verify-nostr-self-test: ${(err as Error).message}`);
  process.exit(1);
});
