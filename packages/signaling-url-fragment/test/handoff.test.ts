import {
  type InvitePayload,
  InviteValidationError,
  type PeerId,
  SENN_PROTOCOL_VERSION,
  SIGNALING_BUNDLE_VERSION,
  type SignalingBundleV1,
  type SignalingMessage,
  buildInviteBundleUrl,
  newPeerId,
  newRoomId,
  parseInviteBundleUrl,
} from "@senn/protocol";
import { describe, expect, it } from "vitest";

import { UrlFragmentSignaling } from "../src/index.ts";

function offer(from: PeerId): SignalingMessage {
  return { kind: "offer", from, sdp: "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\n" };
}

function answer(from: PeerId, to: PeerId): SignalingMessage {
  return { kind: "answer", from, to, sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
}

describe("invite + bundle handoff — two peers meet via a single URL", () => {
  const baseUrl = "https://senn.example/r/";

  async function makeInviteUrl(): Promise<{
    url: string;
    invite: InvitePayload;
    aliceTx: UrlFragmentSignaling;
    aliceId: PeerId;
    roomId: ReturnType<typeof newRoomId>;
  }> {
    const aliceTx = new UrlFragmentSignaling();
    const aliceId = newPeerId();
    const roomId = newRoomId();
    await aliceTx.publish(roomId, offer(aliceId));
    const encoded = await aliceTx.exportBundle(roomId);
    const invite: InvitePayload = {
      v: 1,
      roomId,
      from: aliceId,
      protocolVersion: SENN_PROTOCOL_VERSION,
      capabilities: ["text-v1"],
    };
    // Re-decode the bundle we just exported so we can pass it to the builder.
    const bundle: SignalingBundleV1 = {
      v: SIGNALING_BUNDLE_VERSION,
      roomId,
      messages: [offer(aliceId)],
    };
    const url = await buildInviteBundleUrl(baseUrl, invite, bundle);
    // sanity: encoded returned by the transport is not empty
    expect(encoded.length).toBeGreaterThan(0);
    return { url, invite, aliceTx, aliceId, roomId };
  }

  it("Bob learns the room from #i=, subscribes, then receives the offer from #s=", async () => {
    const { url, roomId, aliceId } = await makeInviteUrl();
    const parsed = await parseInviteBundleUrl(url);
    expect(parsed.invite.roomId).toBe(roomId);
    expect(parsed.invite.from).toBe(aliceId);
    expect(parsed.bundle).not.toBeNull();

    const bobTx = new UrlFragmentSignaling();
    const bobInbox: SignalingMessage[] = [];
    bobTx.subscribe(parsed.invite.roomId, (m) => bobInbox.push(m));

    // Feed the encoded bundle back into the adapter.
    // `importBundle` takes the *encoded* string — recover it from the URL.
    const encodedBundle = UrlFragmentSignaling.fromUrl(url);
    expect(encodedBundle).not.toBeNull();
    const r = await bobTx.importBundle(encodedBundle as string);
    expect(r.roomId).toBe(roomId);
    expect(r.delivered).toBe(1);
    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0]).toMatchObject({ kind: "offer", from: aliceId });
  });

  it("Bob answers, Alice receives the answer in the same room", async () => {
    const { url, aliceTx, aliceId, roomId } = await makeInviteUrl();
    const parsed = await parseInviteBundleUrl(url);
    const bobTx = new UrlFragmentSignaling();
    const bobId = newPeerId();

    bobTx.subscribe(parsed.invite.roomId, () => {}); // accept incoming
    await bobTx.importBundle(UrlFragmentSignaling.fromUrl(url) as string);

    // Bob replies.
    await bobTx.publish(parsed.invite.roomId, answer(bobId, aliceId));
    const returnEncoded = await bobTx.exportBundle(parsed.invite.roomId);

    const aliceInbox: SignalingMessage[] = [];
    aliceTx.subscribe(roomId, (m) => aliceInbox.push(m));
    const r = await aliceTx.importBundle(returnEncoded);
    expect(r.delivered).toBe(1);
    expect(aliceInbox[0]).toMatchObject({ kind: "answer", from: bobId, to: aliceId });
  });

  it("rejects a URL whose bundle.roomId differs from invite.roomId", async () => {
    const aliceId = newPeerId();
    const roomA = newRoomId();
    const roomB = newRoomId();
    const invite: InvitePayload = {
      v: 1,
      roomId: roomA,
      from: aliceId,
      protocolVersion: SENN_PROTOCOL_VERSION,
      capabilities: ["text-v1"],
    };
    const bundle: SignalingBundleV1 = {
      v: SIGNALING_BUNDLE_VERSION,
      roomId: roomB, // mismatch
      messages: [offer(aliceId)],
    };
    await expect(buildInviteBundleUrl(baseUrl, invite, bundle)).rejects.toBeInstanceOf(
      InviteValidationError,
    );
  });

  it("rejects a URL with unknown fragment keys", async () => {
    const { url } = await makeInviteUrl();
    // Splice a bogus key into the fragment.
    const tampered = url.replace(/#/, "#evil=1&");
    await expect(parseInviteBundleUrl(tampered)).rejects.toBeInstanceOf(InviteValidationError);
  });

  it("rejects a bundle whose message.from is not the inviter on the first hop", async () => {
    const aliceId = newPeerId();
    const mallory = newPeerId();
    const room = newRoomId();
    const invite: InvitePayload = {
      v: 1,
      roomId: room,
      from: aliceId,
      protocolVersion: SENN_PROTOCOL_VERSION,
      capabilities: ["text-v1"],
    };
    const bundle: SignalingBundleV1 = {
      v: SIGNALING_BUNDLE_VERSION,
      roomId: room,
      messages: [offer(mallory)],
    };
    await expect(buildInviteBundleUrl(baseUrl, invite, bundle)).rejects.toBeInstanceOf(
      InviteValidationError,
    );
  });
});
