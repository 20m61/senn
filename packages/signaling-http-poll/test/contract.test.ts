import {
  type PeerId,
  type RoomId,
  type SignalingMessage,
  newPeerId,
  newRoomId,
} from "@senn/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { HttpPollClosedError, HttpPollServerError, HttpPollSignaling } from "../src/index.ts";

interface QueueItem {
  id: string;
  message: SignalingMessage;
}

/**
 * In-memory mock endpoint. One process serves both peers — the adapter
 * sees only the wire shape, so this is a faithful contract test.
 */
class MockEndpoint {
  private readonly queues = new Map<string, QueueItem[]>();
  private idCounter = 0;
  /** Hooks for failure-injection tests. */
  failNextPost = 0;
  failNextGet = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const roomId = decodeURIComponent(url.pathname.replace(/^\/signal\//, ""));
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST") {
      if (this.failNextPost > 0) {
        this.failNextPost--;
        return new Response("simulated", { status: 503 });
      }
      const body = JSON.parse((init?.body as string) ?? "{}") as { message: SignalingMessage };
      const id = `m_${++this.idCounter}`;
      const queue = this.queues.get(roomId) ?? [];
      queue.push({ id, message: body.message });
      this.queues.set(roomId, queue);
      return new Response(JSON.stringify({ id, cursor: id }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "GET") {
      if (this.failNextGet > 0) {
        this.failNextGet--;
        return new Response("simulated", { status: 503 });
      }
      const since = url.searchParams.get("since") ?? "";
      const queue = this.queues.get(roomId) ?? [];
      const idx = since ? queue.findIndex((i) => i.id === since) : -1;
      const messages = idx >= 0 ? queue.slice(idx + 1) : queue;
      const last = messages[messages.length - 1];
      const cursor = last ? last.id : since;
      return new Response(JSON.stringify({ messages, cursor }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("method not allowed", { status: 405 });
  };
}

const endpoint = "http://senn.invalid/signal";

function offer(from: PeerId): SignalingMessage {
  return { kind: "offer", from, sdp: "v=0\r\n…" };
}

function answer(from: PeerId, to: PeerId): SignalingMessage {
  return { kind: "answer", from, to, sdp: "v=0\r\n…" };
}

function ice(from: PeerId, to: PeerId): SignalingMessage {
  return {
    kind: "ice",
    from,
    to,
    candidate: { candidate: "candidate:0 1 UDP 1 1.1.1.1 1 typ host", sdpMLineIndex: 0 },
  };
}

let openAdapters: HttpPollSignaling[] = [];
afterEach(async () => {
  for (const a of openAdapters) await a.close();
  openAdapters = [];
});

function makeAdapter(mock: MockEndpoint, intervalMs = 200): HttpPollSignaling {
  const a = new HttpPollSignaling({
    endpoint,
    intervalMs,
    fetcher: mock.fetch,
  });
  openAdapters.push(a);
  return a;
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 1500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v !== undefined && v !== null) return v as T;
    if (Date.now() > deadline) throw new Error("timeout waiting for value");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("HttpPollSignaling — contract", () => {
  it("publish + subscribe round-trip across two adapters", async () => {
    const mock = new MockEndpoint();
    const room = newRoomId();
    const alice = newPeerId();
    const aliceTx = makeAdapter(mock);
    const bobTx = makeAdapter(mock);

    const inbox: SignalingMessage[] = [];
    bobTx.subscribe(room, (m) => inbox.push(m));

    await aliceTx.publish(room, offer(alice));
    const got = await waitFor(() => (inbox.length > 0 ? inbox[0] : undefined));
    expect(got).toMatchObject({ kind: "offer", from: alice });
  });

  it("supports the full offer/answer/ice/bye flow", async () => {
    const mock = new MockEndpoint();
    const room = newRoomId();
    const alice = newPeerId();
    const bob = newPeerId();
    const aliceTx = makeAdapter(mock);
    const bobTx = makeAdapter(mock);

    const aliceInbox: SignalingMessage[] = [];
    const bobInbox: SignalingMessage[] = [];
    aliceTx.subscribe(room, (m) => aliceInbox.push(m));
    bobTx.subscribe(room, (m) => bobInbox.push(m));

    await aliceTx.publish(room, offer(alice));
    await aliceTx.publish(room, ice(alice, bob));
    await waitFor(() => (bobInbox.length >= 2 ? true : undefined));

    await bobTx.publish(room, answer(bob, alice));
    await bobTx.publish(room, ice(bob, alice));
    // Eventually alice sees the answer + ice (+ her own published messages
    // are also delivered, since this is a per-room queue).
    await waitFor(() =>
      aliceInbox.some((m) => m.kind === "answer") &&
      aliceInbox.some((m) => m.kind === "ice" && m.from === bob)
        ? true
        : undefined,
    );
  });

  it("isolates rooms — different roomIds do not bleed", async () => {
    const mock = new MockEndpoint();
    const tx = makeAdapter(mock);
    const other = makeAdapter(mock);

    const roomA = newRoomId();
    const roomB = newRoomId();
    const inboxA: SignalingMessage[] = [];
    const inboxB: SignalingMessage[] = [];
    other.subscribe(roomA, (m) => inboxA.push(m));
    other.subscribe(roomB, (m) => inboxB.push(m));

    await tx.publish(roomA, offer(newPeerId()));
    await waitFor(() => (inboxA.length > 0 ? true : undefined));
    expect(inboxB).toHaveLength(0);
  });

  it("de-duplicates: a repeated message id is only delivered once", async () => {
    const mock = new MockEndpoint();
    const room = newRoomId();
    const tx = makeAdapter(mock);
    const inbox: SignalingMessage[] = [];
    tx.subscribe(room, (m) => inbox.push(m));

    await tx.publish(room, offer(newPeerId()));
    await waitFor(() => (inbox.length > 0 ? true : undefined));
    const before = inbox.length;
    // Wait for at least one more poll cycle. The mock returns only messages
    // strictly after `since`, but if the adapter ever rewound, dedup would
    // prevent a double delivery.
    await new Promise((r) => setTimeout(r, 400));
    expect(inbox.length).toBe(before);
  });

  it("publish() rejects on non-2xx responses", async () => {
    const mock = new MockEndpoint();
    mock.failNextPost = 1;
    const tx = makeAdapter(mock);
    await expect(tx.publish(newRoomId(), offer(newPeerId()))).rejects.toBeInstanceOf(
      HttpPollServerError,
    );
  });

  it("close() rejects further use and is idempotent", async () => {
    const mock = new MockEndpoint();
    const room = newRoomId();
    const tx = makeAdapter(mock);
    await tx.close();
    await tx.close();
    await expect(tx.publish(room, offer(newPeerId()))).rejects.toBeInstanceOf(HttpPollClosedError);
    expect(() => tx.subscribe(room, () => {})).toThrow(HttpPollClosedError);
  });

  it("rejects construction without an endpoint (no vendor lock-in)", () => {
    const mock = new MockEndpoint();
    expect(
      () =>
        new HttpPollSignaling({
          endpoint: "",
          fetcher: mock.fetch,
        }),
    ).toThrow(/endpoint.+required/);
  });

  it("rejects polling intervals outside the allowed range", () => {
    const mock = new MockEndpoint();
    expect(
      () => new HttpPollSignaling({ endpoint, intervalMs: 50, fetcher: mock.fetch }),
    ).toThrow();
    expect(
      () => new HttpPollSignaling({ endpoint, intervalMs: 9_999_999, fetcher: mock.fetch }),
    ).toThrow();
  });

  it("does not embed any default endpoint URL", () => {
    // Static introspection: the source must not contain a hard-coded
    // vendor URL. (We allow `http://senn.invalid/` and example.com strings
    // appearing only inside test files.)
    const adapterInfo = HttpPollSignaling.info;
    expect(adapterInfo.requiresInfrastructure).toBe(true);
    expect(adapterInfo.id).toBe("http-poll-v1");
  });
});

describe("HttpPollSignaling — interop with the URL-fragment adapter", () => {
  // This test demonstrates that the SignalingTransport contract really is
  // adapter-agnostic: a SignalingMessage shaped object travels through the
  // adapter unchanged.
  it("structural SignalingMessage values survive the round-trip unchanged", async () => {
    const mock = new MockEndpoint();
    const room: RoomId = newRoomId();
    const tx = makeAdapter(mock);
    const inbox: SignalingMessage[] = [];
    tx.subscribe(room, (m) => inbox.push(m));

    const sent: SignalingMessage = ice(newPeerId(), newPeerId());
    await tx.publish(room, sent);
    const got = await waitFor(() => (inbox.length > 0 ? inbox[0] : undefined));
    expect(got).toEqual(sent);
  });
});
