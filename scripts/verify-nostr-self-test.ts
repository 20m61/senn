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
 * Fast (~50 ms); included in `pnpm conformance`.
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

import { type PeerId, newPeerId, newRoomId } from "../packages/protocol/src/index.js";
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
  private readonly id: string;

  constructor(id: string) {
    this.id = id;
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
  injectForeignKind(roomId: string, content: string): void {
    const fake: NostrEventLike = {
      id: `foreign-${this.id}-${this.published.length}`,
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

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. publish → subscribe round-trip via a single relay, with the
  //    adapter publishing kind 25556 and the matching #t tag (spec
  //    §"Normative checklist" 5–7).
  {
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
      if (!event) {
        results.push({
          name: "publish → subscribe round-trip",
          ok: false,
          detail: "no event seen by relay",
        });
      } else if (event.kind !== SENN_NOSTR_KIND) {
        results.push({
          name: "publish → subscribe round-trip",
          ok: false,
          detail: `published kind ${event.kind}, expected ${SENN_NOSTR_KIND}`,
        });
      } else if (
        !event.tags.some(
          (t) => t[0] === "t" && typeof t[1] === "string" && t[1] === `${SENN_TAG_PREFIX}${room}`,
        )
      ) {
        results.push({
          name: "publish → subscribe round-trip",
          ok: false,
          detail: `event tags missed the senn:<roomId> marker; got ${JSON.stringify(event.tags)}`,
        });
      } else if (got?.kind === "offer" && got.from === alice) {
        results.push({ name: "publish → subscribe round-trip", ok: true });
      } else {
        results.push({
          name: "publish → subscribe round-trip",
          ok: false,
          detail: `delivered ${JSON.stringify(got)} but expected offer from ${alice}`,
        });
      }
    } catch (err) {
      results.push({
        name: "publish → subscribe round-trip",
        ok: false,
        detail: (err as Error).message,
      });
    } finally {
      await aliceTx.close();
      await bobTx.close();
    }
  }

  // 2. Dedup across multiple relays — one logical message MUST surface
  //    once even when fanned out by N relays (spec §"Normative
  //    checklist" 8).
  {
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
      // Settle window: a duplicate would arrive within a few ms via the
      // second relay's fan-out path.
      await new Promise((r) => setTimeout(r, 50));
      if (inbox.length === 1) {
        results.push({ name: "dedup across multiple relays", ok: true });
      } else {
        results.push({
          name: "dedup across multiple relays",
          ok: false,
          detail: `delivered ${inbox.length} copies, expected 1`,
        });
      }
    } catch (err) {
      results.push({
        name: "dedup across multiple relays",
        ok: false,
        detail: (err as Error).message,
      });
    } finally {
      await aliceTx.close();
      await bobTx.close();
    }
  }

  // 3. Receive-path kind filter — a relay that fans out a kind-1 event
  //    matching the same #t filter MUST NOT surface to the handler
  //    (spec §"Normative checklist" 5: "Every published event MUST be
  //    of kind: 25556" — the receive side has the symmetric obligation
  //    via the REQ filter).
  {
    FakeWebSocket.reset();
    const relay = new MockRelay("foreign");
    FakeWebSocket.bindRelay("ws://mock/foreign", relay);
    const tx = new NostrSignaling({ relays: ["ws://mock/foreign"], wsCtor: FAKE_WS });
    try {
      const room = newRoomId();
      const inbox: SignalingMessage[] = [];
      tx.subscribe(room, (m) => inbox.push(m));
      await new Promise((r) => setTimeout(r, 5));
      relay.injectForeignKind(room, JSON.stringify({ kind: "offer", from: newPeerId(), sdp: "x" }));
      await new Promise((r) => setTimeout(r, 30));
      // Mock matches by #t, so the relay's REQ filter alone wouldn't
      // drop kind 1; the adapter's `handleEvent` MUST filter on
      // event.kind. (See `packages/signaling-nostr/src/index.ts`
      // `handleEvent` early return when `event.kind !== SENN_NOSTR_KIND`.)
      if (inbox.length === 0) {
        results.push({ name: "non-25556 events are dropped", ok: true });
      } else {
        results.push({
          name: "non-25556 events are dropped",
          ok: false,
          detail: `surfaced ${inbox.length} foreign-kind events`,
        });
      }
    } catch (err) {
      results.push({
        name: "non-25556 events are dropped",
        ok: false,
        detail: (err as Error).message,
      });
    } finally {
      await tx.close();
    }
  }

  // 4. publish rejects when every relay nacks (spec §"Reconnect
  //    behaviour" 3: "rejects only if every relay either NACKs or
  //    stays disconnected").
  {
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
      let failed = false;
      let rejection = "";
      try {
        await tx.publish(newRoomId(), offer(newPeerId()));
      } catch (err) {
        failed = true;
        rejection = (err as Error).message;
      }
      if (failed && /rate-limited/.test(rejection)) {
        results.push({ name: "publish rejects when every relay nacks", ok: true });
      } else if (failed) {
        results.push({
          name: "publish rejects when every relay nacks",
          ok: false,
          detail: `rejected, but message did not surface relay reason: ${rejection}`,
        });
      } else {
        results.push({
          name: "publish rejects when every relay nacks",
          ok: false,
          detail: "publish unexpectedly resolved",
        });
      }
    } finally {
      await tx.close();
    }
  }

  // 5. Each NostrSignaling construction uses a fresh ephemeral keypair
  //    (spec §"Normative checklist" 4: "MUST be ephemeral by default").
  {
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
        results.push({ name: "ephemeral keypair per construction", ok: true });
      } else {
        results.push({
          name: "ephemeral keypair per construction",
          ok: false,
          detail: `keys: ${a.publicKey} vs ${b.publicKey}`,
        });
      }
    } finally {
      await a.close();
      await b.close();
    }
  }

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
