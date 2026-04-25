import { type PeerId, type SignalingMessage, newPeerId, newRoomId } from "@senn/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NostrSignaling } from "../src/index.ts";

/**
 * In-memory mock relay implementing the slice of NIP-01 the adapter
 * exercises: REQ → live event delivery, EVENT → ack + fan-out to
 * every subscriber whose filter matches, CLOSE → drop the sub.
 */
class MockRelay {
  private readonly subs = new Map<string, { sock: FakeWebSocket; filter: NostrFilter }>();

  handle(sock: FakeWebSocket, raw: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(frame)) return;
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
      const event = frame[1] as { id: string; kind: number; tags: string[][] };
      // ack the publisher
      sock.deliver(JSON.stringify(["OK", event.id, true, ""]));
      // fan out to matching subs
      for (const [subId, { sock: s, filter }] of this.subs) {
        if (matches(filter, event)) {
          s.deliver(JSON.stringify(["EVENT", subId, event]));
        }
      }
    }
  }
}

interface NostrFilter {
  kinds?: number[];
  "#t"?: string[];
}

function matches(filter: NostrFilter, event: { kind: number; tags: string[][] }): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter["#t"]) {
    const tagValues = event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
    if (!filter["#t"].some((t) => tagValues.includes(t))) return false;
  }
  return true;
}

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  private static relay: MockRelay | null = null;

  static bindRelay(relay: MockRelay): void {
    FakeWebSocket.relay = relay;
  }

  constructor(_url: string) {
    super();
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string): void {
    FakeWebSocket.relay?.handle(this, data);
  }

  deliver(data: string): void {
    queueMicrotask(() => {
      const ev = new MessageEvent("message", { data });
      this.dispatchEvent(ev);
    });
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

const FAKE_WS = FakeWebSocket as unknown as typeof WebSocket;

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

describe("@senn/signaling-nostr — contract", () => {
  let relay: MockRelay;

  beforeEach(() => {
    relay = new MockRelay();
    FakeWebSocket.bindRelay(relay);
  });

  afterEach(async () => {
    // close happens per-test
  });

  it("publish → subscribe round-trip via a single mock relay", async () => {
    const aliceTx = new NostrSignaling({ relays: ["ws://mock"], wsCtor: FAKE_WS });
    const bobTx = new NostrSignaling({ relays: ["ws://mock"], wsCtor: FAKE_WS });
    try {
      const room = newRoomId();
      const alice = newPeerId();
      const inbox: SignalingMessage[] = [];
      bobTx.subscribe(room, (m) => inbox.push(m));

      // Give Bob's REQ a tick to land before Alice publishes.
      await new Promise((r) => setTimeout(r, 10));

      await aliceTx.publish(room, offer(alice));
      const got = await waitFor(() => (inbox.length > 0 ? inbox[0] : undefined));
      expect(got).toMatchObject({ kind: "offer", from: alice });
    } finally {
      await aliceTx.close();
      await bobTx.close();
    }
  });

  it("dedups across multiple relays — one logical message surfaces once", async () => {
    const aliceTx = new NostrSignaling({
      relays: ["ws://mock-a", "ws://mock-b"],
      wsCtor: FAKE_WS,
    });
    const bobTx = new NostrSignaling({
      relays: ["ws://mock-a", "ws://mock-b"],
      wsCtor: FAKE_WS,
    });
    try {
      const room = newRoomId();
      const alice = newPeerId();
      const inbox: SignalingMessage[] = [];
      bobTx.subscribe(room, (m) => inbox.push(m));

      await new Promise((r) => setTimeout(r, 10));
      await aliceTx.publish(room, offer(alice));

      // Wait for at least one delivery, then a settle window in case a
      // duplicate is in flight.
      await waitFor(() => (inbox.length >= 1 ? inbox.length : undefined));
      await new Promise((r) => setTimeout(r, 50));
      expect(inbox.length).toBe(1);
    } finally {
      await aliceTx.close();
      await bobTx.close();
    }
  });

  it("publish rejects when no relay accepts the WebSocket connection", async () => {
    class FailingWS extends EventTarget {
      static OPEN = 1;
      readyState = 0;
      constructor(_url: string) {
        super();
        queueMicrotask(() => {
          this.dispatchEvent(new Event("error"));
          this.dispatchEvent(new Event("close"));
        });
      }
      send(): void {
        throw new Error("not open");
      }
      close(): void {}
    }
    const tx = new NostrSignaling({
      relays: ["ws://broken"],
      wsCtor: FailingWS as unknown as typeof WebSocket,
      publishTimeoutMs: 100,
    });
    try {
      const room = newRoomId();
      await expect(tx.publish(room, offer(newPeerId()))).rejects.toThrow(
        /no reachable relay|ack timeout/i,
      );
    } finally {
      await tx.close();
    }
  });

  it("uses a fresh ephemeral keypair per construction", () => {
    const a = new NostrSignaling({ relays: ["ws://x"], wsCtor: FAKE_WS });
    const b = new NostrSignaling({ relays: ["ws://x"], wsCtor: FAKE_WS });
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.publicKey).toMatch(/^[0-9a-f]{64}$/);
    void a.close();
    void b.close();
  });

  it("requires at least one relay URL", () => {
    expect(() => new NostrSignaling({ relays: [], wsCtor: FAKE_WS })).toThrow(
      /at least one relay URL/,
    );
  });
});
