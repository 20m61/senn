import {
  type RoomId,
  type SignalingHandler,
  type SignalingMessage,
  type SignalingTransport,
  type Unsubscribe,
  newPeerId,
  newRoomId,
} from "@senn/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PeerSession } from "../src/peer-session.ts";

/**
 * Regression tests for the chunked binary receiver cap.
 *
 * Pre-fix bug: the receiver enforced `total * BIN_BODY_PER_FRAME > CAP` on the
 * very first frame, which over-rejected payloads in the (4 177 920, 4 194 304]
 * band — including the 4 MiB cap exactly — even though sendBinary accepts
 * them. The fix moves the check to a body-bytes accumulation cap, so the
 * receiver matches the sender's strict-`>` bound.
 */

const BIN_CHANNEL_LABEL = "core.bin";
const BIN_BODY_PER_FRAME = 60 * 1024;
const BIN_MESSAGE_MAX_BYTES = 4 * 1024 * 1024;

class MockSignalingBus implements SignalingTransport {
  private readonly handlers = new Map<RoomId, Set<SignalingHandler>>();
  async publish(_roomId: RoomId, _message: SignalingMessage): Promise<void> {
    /* not used; tests drive the bin channel directly */
  }
  subscribe(roomId: RoomId, handler: SignalingHandler): Unsubscribe {
    let set = this.handlers.get(roomId);
    if (!set) {
      set = new Set();
      this.handlers.set(roomId, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }
  async close(): Promise<void> {
    this.handlers.clear();
  }
}

interface FakeBinChannel {
  label: string;
  binaryType: string;
  readyState: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null;
  send(_data: unknown): void;
  close(): void;
}

function makeBinChannel(label: string): FakeBinChannel {
  return {
    label,
    binaryType: "arraybuffer",
    readyState: "open",
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send(_data: unknown) {
      /* no-op */
    },
    close() {
      /* no-op */
    },
  };
}

class FakeRTCPeerConnection {
  static created: FakeRTCPeerConnection[] = [];
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((ev: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  ontrack: (() => void) | null = null;
  ondatachannel: ((ev: { channel: FakeBinChannel }) => void) | null = null;
  binChannel: FakeBinChannel | null = null;
  textChannel: FakeBinChannel | null = null;

  constructor(_config?: unknown) {
    FakeRTCPeerConnection.created.push(this);
  }

  createDataChannel(label: string, _opts?: unknown): FakeBinChannel {
    const channel = makeBinChannel(label);
    if (label === BIN_CHANNEL_LABEL) this.binChannel = channel;
    else this.textChannel = channel;
    queueMicrotask(() => this.onnegotiationneeded?.());
    return channel;
  }

  addTrack(): unknown {
    return {};
  }
  removeTrack(): void {}
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\nfake\r\n" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0\r\nfake\r\n" };
  }
  async setLocalDescription(): Promise<void> {
    this.localDescription = { type: "offer", sdp: "v=0\r\nfake-offer\r\n" };
    this.signalingState = "have-local-offer";
  }
  async setRemoteDescription(): Promise<void> {
    this.signalingState = "stable";
  }
  async addIceCandidate(): Promise<void> {}
  close(): void {
    this.connectionState = "closed";
  }
}

let savedRTC: typeof globalThis.RTCPeerConnection | undefined;

beforeEach(() => {
  FakeRTCPeerConnection.created = [];
  savedRTC = (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection as
    | typeof globalThis.RTCPeerConnection
    | undefined;
  (globalThis as { RTCPeerConnection: unknown }).RTCPeerConnection =
    FakeRTCPeerConnection as unknown as typeof RTCPeerConnection;
});

afterEach(() => {
  if (savedRTC) (globalThis as { RTCPeerConnection: unknown }).RTCPeerConnection = savedRTC;
});

function buildFrame(opts: {
  addon: string;
  mime: string;
  body: Uint8Array;
  id: string;
  seq: number;
  total: number;
}): ArrayBuffer {
  const headerObj = {
    v: 1,
    addon: opts.addon,
    mime: opts.mime,
    size: opts.body.byteLength,
    id: opts.id,
    seq: opts.seq,
    total: opts.total,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(headerObj));
  const frameLen = 4 + headerBytes.byteLength + opts.body.byteLength;
  const frame = new ArrayBuffer(frameLen);
  const view = new DataView(frame);
  view.setUint32(0, headerBytes.byteLength, true);
  new Uint8Array(frame, 4, headerBytes.byteLength).set(headerBytes);
  new Uint8Array(frame, 4 + headerBytes.byteLength, opts.body.byteLength).set(opts.body);
  return frame;
}

function dispatchFrames(channel: FakeBinChannel, frames: ArrayBuffer[]): void {
  if (!channel.onmessage) throw new Error("bin channel onmessage not bound");
  for (const f of frames) channel.onmessage({ data: f });
}

async function freshSession(): Promise<{ session: PeerSession; bin: FakeBinChannel }> {
  const session = new PeerSession({
    role: "inviter",
    roomId: newRoomId(),
    localPeerId: newPeerId(),
    remotePeerId: newPeerId(),
    signaling: new MockSignalingBus(),
    rtcConfig: {} as RTCConfiguration,
  });
  await session.start();
  // Let microtasks run so the data channels register.
  await new Promise((r) => setTimeout(r, 5));
  const pc = FakeRTCPeerConnection.created[0];
  if (!pc?.binChannel) throw new Error("bin channel not created");
  return { session, bin: pc.binChannel };
}

describe("PeerSession — chunked binary receiver cap (regression for bug_001)", () => {
  it("accepts a 4 MiB-exact reassembled message (the documented cap)", async () => {
    const { session, bin } = await freshSession();
    const received: { addon: string; mime: string; bytes: Uint8Array }[] = [];
    session.on("binary", (msg) => received.push(msg));

    const total = Math.ceil(BIN_MESSAGE_MAX_BYTES / BIN_BODY_PER_FRAME); // 69
    const id = "msg-cap-exact";
    const frames: ArrayBuffer[] = [];
    let bytesEmitted = 0;
    for (let seq = 0; seq < total; seq++) {
      const start = seq * BIN_BODY_PER_FRAME;
      const end = Math.min(start + BIN_BODY_PER_FRAME, BIN_MESSAGE_MAX_BYTES);
      const body = new Uint8Array(end - start);
      // Fill with a recognisable pattern so reassembly errors are obvious.
      for (let i = 0; i < body.byteLength; i++) body[i] = (start + i) & 0xff;
      bytesEmitted += body.byteLength;
      frames.push(
        buildFrame({
          addon: "dev.senn.test",
          mime: "application/octet-stream",
          body,
          id,
          seq,
          total,
        }),
      );
    }
    expect(bytesEmitted).toBe(BIN_MESSAGE_MAX_BYTES);

    dispatchFrames(bin, frames);

    expect(received).toHaveLength(1);
    const msg = received[0];
    if (!msg) throw new Error("expected one binary message");
    expect(msg.addon).toBe("dev.senn.test");
    expect(msg.bytes.byteLength).toBe(BIN_MESSAGE_MAX_BYTES);
    // Spot-check the first and last bytes of the reassembled payload.
    expect(msg.bytes[0]).toBe(0);
    expect(msg.bytes[BIN_MESSAGE_MAX_BYTES - 1]).toBe((BIN_MESSAGE_MAX_BYTES - 1) & 0xff);

    await session.close();
  });

  it("rejects a chunked message that overruns the 4 MiB cap by even one byte", async () => {
    const { session, bin } = await freshSession();
    const errors: Error[] = [];
    session.on("error", (err) => errors.push(err));
    const received: { addon: string; mime: string; bytes: Uint8Array }[] = [];
    session.on("binary", (msg) => received.push(msg));

    const oversize = BIN_MESSAGE_MAX_BYTES + 1;
    const total = Math.ceil(oversize / BIN_BODY_PER_FRAME); // 69
    const id = "msg-cap-overflow";
    const frames: ArrayBuffer[] = [];
    for (let seq = 0; seq < total; seq++) {
      const start = seq * BIN_BODY_PER_FRAME;
      const end = Math.min(start + BIN_BODY_PER_FRAME, oversize);
      const body = new Uint8Array(end - start);
      frames.push(
        buildFrame({
          addon: "dev.senn.test",
          mime: "application/octet-stream",
          body,
          id,
          seq,
          total,
        }),
      );
    }

    dispatchFrames(bin, frames);

    expect(received).toHaveLength(0);
    expect(errors.some((e) => /exceeds cap/.test(e.message))).toBe(true);

    await session.close();
  });
});
