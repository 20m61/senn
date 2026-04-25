import {
  type PeerId,
  type RoomId,
  type SignalingMessage,
  newPeerId,
  newRoomId,
} from "@senn/protocol";
import { describe, expect, it } from "vitest";

import { AdapterClosedError, UrlFragmentSignaling } from "../src/index.ts";

function offer(from: PeerId): SignalingMessage {
  return { kind: "offer", from, sdp: "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n" };
}

function answer(from: PeerId, to: PeerId): SignalingMessage {
  return { kind: "answer", from, to, sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
}

function ice(from: PeerId, to: PeerId): SignalingMessage {
  return {
    kind: "ice",
    from,
    to,
    candidate: { candidate: "candidate:0 1 UDP 1 1.1.1.1 1 typ host", sdpMLineIndex: 0 },
  };
}

function bye(from: PeerId): SignalingMessage {
  return { kind: "bye", from };
}

describe("UrlFragmentSignaling", () => {
  it("delivers a single offer round-trip across two adapters", async () => {
    const room = newRoomId();
    const alice = newPeerId();
    const aliceTx = new UrlFragmentSignaling();
    const bobTx = new UrlFragmentSignaling();

    const received: SignalingMessage[] = [];
    bobTx.subscribe(room, (m) => received.push(m));

    await aliceTx.publish(room, offer(alice));
    const encoded = await aliceTx.exportBundle(room);
    expect(encoded.length).toBeGreaterThan(0);

    const result = await bobTx.importBundle(encoded);
    expect(result.roomId).toBe(room);
    expect(result.delivered).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: "offer", from: alice });
  });

  it("supports the full offer/answer/ice/bye flow", async () => {
    const room = newRoomId();
    const alice = newPeerId();
    const bob = newPeerId();
    const aliceTx = new UrlFragmentSignaling();
    const bobTx = new UrlFragmentSignaling();

    const aliceInbox: SignalingMessage[] = [];
    const bobInbox: SignalingMessage[] = [];
    aliceTx.subscribe(room, (m) => aliceInbox.push(m));
    bobTx.subscribe(room, (m) => bobInbox.push(m));

    // 1) Alice → Bob: offer + first ICE candidate.
    await aliceTx.publish(room, offer(alice));
    await aliceTx.publish(room, ice(alice, bob));
    await bobTx.importBundle(await aliceTx.exportBundle(room));
    expect(bobInbox.map((m) => m.kind)).toEqual(["offer", "ice"]);

    // 2) Bob → Alice: answer + ICE.
    await bobTx.publish(room, answer(bob, alice));
    await bobTx.publish(room, ice(bob, alice));
    await aliceTx.importBundle(await bobTx.exportBundle(room));
    expect(aliceInbox.map((m) => m.kind)).toEqual(["answer", "ice"]);

    // 3) Either side ends the session.
    await aliceTx.publish(room, bye(alice));
    await bobTx.importBundle(await aliceTx.exportBundle(room));
    expect(bobInbox.at(-1)).toMatchObject({ kind: "bye", from: alice });
  });

  it("isolates rooms — message in room A is not delivered to a handler in room B", async () => {
    const roomA = newRoomId();
    const roomB = newRoomId();
    const alice = newPeerId();
    const tx = new UrlFragmentSignaling();
    const other = new UrlFragmentSignaling();

    const inboxA: SignalingMessage[] = [];
    const inboxB: SignalingMessage[] = [];
    other.subscribe(roomA, (m) => inboxA.push(m));
    other.subscribe(roomB, (m) => inboxB.push(m));

    await tx.publish(roomA, offer(alice));
    await other.importBundle(await tx.exportBundle(roomA));

    expect(inboxA).toHaveLength(1);
    expect(inboxB).toHaveLength(0);
  });

  it("unsubscribe stops further delivery", async () => {
    const room = newRoomId();
    const alice = newPeerId();
    const tx = new UrlFragmentSignaling();
    const peer = new UrlFragmentSignaling();

    const inbox: SignalingMessage[] = [];
    const off = peer.subscribe(room, (m) => inbox.push(m));

    await tx.publish(room, offer(alice));
    await peer.importBundle(await tx.exportBundle(room));
    expect(inbox).toHaveLength(1);

    off();
    await tx.publish(room, bye(alice));
    await peer.importBundle(await tx.exportBundle(room));
    expect(inbox).toHaveLength(1);
  });

  it("close() rejects further use and is idempotent", async () => {
    const room = newRoomId();
    const alice = newPeerId();
    const tx = new UrlFragmentSignaling();

    await tx.publish(room, offer(alice));
    await tx.close();
    await tx.close(); // idempotent

    await expect(tx.publish(room, bye(alice))).rejects.toBeInstanceOf(AdapterClosedError);
    expect(() => tx.subscribe(room, () => {})).toThrow(AdapterClosedError);
    await expect(tx.exportBundle(room)).rejects.toBeInstanceOf(AdapterClosedError);
    await expect(tx.importBundle("AAAA")).rejects.toBeInstanceOf(AdapterClosedError);
  });

  it("exportBundle returns empty string when the outbox is empty", async () => {
    const tx = new UrlFragmentSignaling();
    const room = newRoomId();
    await expect(tx.exportBundle(room)).resolves.toBe("");
  });

  it("rejects bundles with unknown fields", async () => {
    const tx = new UrlFragmentSignaling();
    // A hand-built bundle with an unknown top-level key is rejected by the
    // protocol decoder; importBundle surfaces the error.
    const bogusBundle = { v: 1, roomId: newRoomId(), messages: [], extra: "no" };
    const json = JSON.stringify(bogusBundle);
    const compressed = await new Response(
      new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer();
    const bytes = new Uint8Array(compressed);
    const b64 = Buffer.from(bytes)
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    await expect(tx.importBundle(b64)).rejects.toThrow(/bundle validation failed/);
  });

  it("toFragment / fromUrl are inverses", async () => {
    const room = newRoomId();
    const alice = newPeerId();
    const tx = new UrlFragmentSignaling();
    await tx.publish(room, offer(alice));
    const encoded = await tx.exportBundle(room);
    const fragment = UrlFragmentSignaling.toFragment(encoded);
    const url = `https://senn.example/r/#${fragment}`;
    expect(UrlFragmentSignaling.fromUrl(url)).toBe(encoded);
  });
});
