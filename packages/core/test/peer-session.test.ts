import {
  type PeerId,
  type RoomId,
  type SignalingHandler,
  type SignalingMessage,
  type SignalingTransport,
  type Unsubscribe,
  newPeerId,
  newRoomId,
} from "@senn/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PeerSession } from "../src/peer-session.ts";

/**
 * Conformance tests for `docs/peer-session-spec.md`.
 *
 * The spec previously deferred Vitest coverage to a future Node-side
 * RTCPeerConnection shim; in practice every behaviour the spec
 * normatively requires can be exercised against the minimal fake here
 * (we are testing PeerSession's *contract*, not the WebRTC stack
 * underneath). The Playwright e2e in `apps/web` keeps the real-stack
 * surface; this file fills in the spec-checklist surface.
 */

interface FakeDataChannel {
  label: string;
  binaryType: string;
  readyState: "connecting" | "open" | "closing" | "closed";
  closed: boolean;
  sent: unknown[];
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: unknown): void;
  close(): void;
}

function makeFakeDataChannel(label: string): FakeDataChannel {
  const ch: FakeDataChannel = {
    label,
    binaryType: "arraybuffer",
    readyState: "connecting",
    closed: false,
    sent: [],
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send(data: unknown) {
      ch.sent.push(data);
    },
    close() {
      ch.closed = true;
      ch.readyState = "closed";
      ch.onclose?.();
    },
  };
  return ch;
}

class FakeRTCPeerConnection {
  static created: FakeRTCPeerConnection[] = [];
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  closed = false;

  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((ev: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  ontrack: ((ev: { track: { kind: string; id: string }; streams: unknown[] }) => void) | null =
    null;
  ondatachannel: ((ev: { channel: FakeDataChannel }) => void) | null = null;

  readonly channels: FakeDataChannel[] = [];
  readonly addedTracks: Array<{ track: { kind: string }; stream?: unknown }> = [];
  readonly removedSenders: unknown[] = [];

  constructor(_config?: unknown) {
    FakeRTCPeerConnection.created.push(this);
  }

  createDataChannel(label: string): FakeDataChannel {
    const ch = makeFakeDataChannel(label);
    this.channels.push(ch);
    queueMicrotask(() => this.onnegotiationneeded?.());
    return ch;
  }

  addTrack(track: { kind: string }, stream?: unknown): { kind: string } {
    this.addedTracks.push({ track, stream });
    queueMicrotask(() => this.onnegotiationneeded?.());
    return track;
  }

  removeTrack(sender: unknown): void {
    this.removedSenders.push(sender);
  }

  async setLocalDescription(_desc?: unknown): Promise<void> {
    this.localDescription = { type: "offer", sdp: "v=0\r\nfake-offer-auto\r\n" };
    this.signalingState = "have-local-offer";
  }

  async setRemoteDescription(_desc?: unknown): Promise<void> {
    this.signalingState = "stable";
  }

  async addIceCandidate(_c: unknown): Promise<void> {
    /* no-op */
  }

  close(): void {
    this.closed = true;
    this.connectionState = "closed";
  }

  // Test helpers — drive lifecycle events the FakePc would emit in a real run.

  fireConnectionStateChange(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  /** Inviter side: fire onopen on the channel with the given label. */
  openChannel(label: string): void {
    const ch = this.channels.find((c) => c.label === label);
    if (!ch) throw new Error(`no channel with label ${label}`);
    ch.readyState = "open";
    ch.onopen?.();
  }

  /** Joiner side: simulate ondatachannel callback the inviter would trigger. */
  fireDataChannel(label: string): FakeDataChannel {
    const ch = makeFakeDataChannel(label);
    this.ondatachannel?.({ channel: ch });
    return ch;
  }
}

class MockSignalingBus implements SignalingTransport {
  private readonly handlers = new Map<RoomId, Set<SignalingHandler>>();
  readonly published: Array<{ room: RoomId; message: SignalingMessage }> = [];
  readonly unsubCalls: number[] = [];
  closed = false;

  async publish(roomId: RoomId, message: SignalingMessage): Promise<void> {
    this.published.push({ room: roomId, message });
    const set = this.handlers.get(roomId);
    if (!set) return;
    queueMicrotask(() => {
      for (const h of [...set]) {
        try {
          h(message);
        } catch {
          /* swallow listener errors */
        }
      }
    });
  }

  subscribe(roomId: RoomId, handler: SignalingHandler): Unsubscribe {
    let set = this.handlers.get(roomId);
    if (!set) {
      set = new Set();
      this.handlers.set(roomId, set);
    }
    set.add(handler);
    const idx = this.unsubCalls.length;
    return () => {
      this.unsubCalls.push(idx);
      set?.delete(handler);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
  }

  /** Inject a message that did not originate from any local PeerSession publish. */
  inject(room: RoomId, message: SignalingMessage): void {
    const set = this.handlers.get(room);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(message);
      } catch {
        /* swallow */
      }
    }
  }

  countSubscribers(room: RoomId): number {
    return this.handlers.get(room)?.size ?? 0;
  }
}

const RTC_CONFIG = {} as RTCConfiguration;
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

function makeSession(role: "inviter" | "joiner", remote: PeerId | null = newPeerId()) {
  const bus = new MockSignalingBus();
  const room = newRoomId();
  const me = newPeerId();
  const session = new PeerSession({
    role,
    roomId: room,
    localPeerId: me,
    remotePeerId: remote,
    signaling: bus,
    rtcConfig: RTC_CONFIG,
  });
  return { bus, room, me, remote, session };
}

async function flushMicro(): Promise<void> {
  await new Promise((r) => setTimeout(r, 5));
}

describe("PeerSession — DataChannel labels (spec §Roles)", () => {
  it("inviter creates `core.text` and `core.bin` data channels", async () => {
    const { session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const pc = FakeRTCPeerConnection.created[0];
    expect(pc).toBeDefined();
    if (!pc) return;
    const labels = pc.channels.map((c) => c.label);
    expect(labels).toContain("core.text");
    expect(labels).toContain("core.bin");
    await session.close();
  });

  it("joiner accepts `core.text` and `core.bin` arriving via pc.ondatachannel", async () => {
    const { session } = makeSession("joiner");
    await session.start();
    const pc = FakeRTCPeerConnection.created[0];
    expect(pc).toBeDefined();
    if (!pc) return;
    pc.fireDataChannel("core.text");
    pc.fireDataChannel("core.bin");
    // No throw, no unhandled rejection — handled silently is the contract.
    await session.close();
  });

  it("joiner closes any DataChannel whose label is unknown", async () => {
    const { session } = makeSession("joiner");
    await session.start();
    const pc = FakeRTCPeerConnection.created[0];
    expect(pc).toBeDefined();
    if (!pc) return;
    const stray = pc.fireDataChannel("malicious.channel");
    expect(stray.closed).toBe(true);
    await session.close();
  });
});

describe("PeerSession — state machine (spec §Events)", () => {
  it("transitions idle → connecting on start()", async () => {
    const { session } = makeSession("inviter");
    expect(session.state).toBe("idle");
    await session.start();
    expect(session.state).toBe("connecting");
    await session.close();
  });

  it("transitions connecting → connected when core.text opens", async () => {
    const { session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const pc = FakeRTCPeerConnection.created[0];
    if (!pc) return;
    pc.openChannel("core.text");
    expect(session.state).toBe("connected");
    await session.close();
  });

  it("emits the 'state' event on every transition", async () => {
    const { session } = makeSession("inviter");
    const seen: string[] = [];
    session.on("state", (s) => seen.push(s));
    await session.start();
    await flushMicro();
    const pc = FakeRTCPeerConnection.created[0];
    if (!pc) return;
    pc.openChannel("core.text");
    await session.close();
    expect(seen).toEqual(["connecting", "connected", "closed"]);
  });

  it("transitions to 'failed' when the underlying connection fails", async () => {
    const { session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const pc = FakeRTCPeerConnection.created[0];
    if (!pc) return;
    pc.fireConnectionStateChange("failed");
    expect(session.state).toBe("failed");
    await session.close();
  });

  it("does not regress 'closed' to 'failed' if it already closed", async () => {
    const { session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const pc = FakeRTCPeerConnection.created[0];
    if (!pc) return;
    await session.close();
    pc.fireConnectionStateChange("failed");
    expect(session.state).toBe("closed");
  });
});

describe("PeerSession.sendText — bounds (spec §Wire)", () => {
  it("rejects when the session is not in 'connected' state", async () => {
    const { session } = makeSession("inviter");
    await session.start();
    // Channel has not been opened, so state is still 'connecting'.
    await expect(session.sendText("hi")).rejects.toThrow(/state connecting/);
    await session.close();
  });

  it("rejects payloads exceeding 64 KiB UTF-8", async () => {
    const { session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const pc = FakeRTCPeerConnection.created[0];
    if (!pc) return;
    pc.openChannel("core.text");
    const tooBig = "a".repeat(64 * 1024 + 1);
    await expect(session.sendText(tooBig)).rejects.toThrow(/exceeds/);
    await session.close();
  });

  it("delivers UTF-8 strings on the open core.text channel", async () => {
    const { session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const pc = FakeRTCPeerConnection.created[0];
    if (!pc) return;
    pc.openChannel("core.text");
    await session.sendText("hello, peer");
    const text = pc.channels.find((c) => c.label === "core.text");
    expect(text?.sent).toEqual(["hello, peer"]);
    await session.close();
  });
});

describe("PeerSession.close (spec §Lifecycle)", () => {
  it("publishes a 'bye' signaling message before tearing down", async () => {
    const { bus, session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    await session.close();
    const byes = bus.published.filter((p) => p.message.kind === "bye");
    expect(byes.length).toBe(1);
  });

  it("does not publish 'bye' when called from idle", async () => {
    const { bus, session } = makeSession("inviter");
    await session.close();
    const byes = bus.published.filter((p) => p.message.kind === "bye");
    expect(byes.length).toBe(0);
  });

  it("is idempotent (multiple calls are safe and silent)", async () => {
    const { bus, session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    await session.close();
    await session.close();
    await session.close();
    const byes = bus.published.filter((p) => p.message.kind === "bye");
    expect(byes.length).toBe(1);
    expect(session.state).toBe("closed");
  });

  it("releases the signaling subscription", async () => {
    const { bus, room, session } = makeSession("inviter");
    await session.start();
    expect(bus.countSubscribers(room)).toBeGreaterThan(0);
    await session.close();
    expect(bus.countSubscribers(room)).toBe(0);
  });

  it("closes the underlying RTCPeerConnection", async () => {
    const { session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const pc = FakeRTCPeerConnection.created[0];
    if (!pc) return;
    await session.close();
    expect(pc.closed).toBe(true);
  });
});

describe("PeerSession — signaling validation (spec §MUSTs)", () => {
  it("ignores signaling messages whose `from` is the local peer id", async () => {
    const { bus, room, me, session } = makeSession("joiner");
    await session.start();
    const errs: Error[] = [];
    session.on("error", (e) => errs.push(e));
    bus.inject(room, {
      kind: "offer",
      from: me, // locally authored — must be ignored
      sdp: "v=0\r\nbogus\r\n",
    });
    await flushMicro();
    expect(errs.length).toBe(0);
    // No answer should have been published in response to our own offer.
    const answers = bus.published.filter((p) => p.message.kind === "answer");
    expect(answers.length).toBe(0);
    await session.close();
  });

  it("ignores answer messages addressed to a different `to` peer", async () => {
    const { bus, room, session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const errs: Error[] = [];
    session.on("error", (e) => errs.push(e));
    const otherPeer = newPeerId();
    const otherRecipient = newPeerId();
    bus.inject(room, {
      kind: "answer",
      from: otherPeer,
      to: otherRecipient,
      sdp: "v=0\r\nbogus\r\n",
    });
    await flushMicro();
    expect(errs.length).toBe(0);
    await session.close();
  });

  it("ignores ice messages addressed to a different `to` peer", async () => {
    const { bus, room, session } = makeSession("inviter");
    await session.start();
    await flushMicro();
    const errs: Error[] = [];
    session.on("error", (e) => errs.push(e));
    bus.inject(room, {
      kind: "ice",
      from: newPeerId(),
      to: newPeerId(),
      candidate: { candidate: "fake", sdpMid: "0", sdpMLineIndex: 0 } as RTCIceCandidateInit,
    });
    await flushMicro();
    expect(errs.length).toBe(0);
    await session.close();
  });

  it("ignores messages from a peer other than `remotePeerId` (when known)", async () => {
    const { bus, room, session } = makeSession("inviter", newPeerId());
    await session.start();
    await flushMicro();
    const errs: Error[] = [];
    session.on("error", (e) => errs.push(e));
    bus.inject(room, {
      kind: "offer",
      from: newPeerId(), // not our remote
      sdp: "v=0\r\n",
    });
    await flushMicro();
    expect(errs.length).toBe(0);
    await session.close();
  });
});

describe("PeerSession — peer-initiated bye (spec §Lifecycle)", () => {
  it("closes when a `bye` arrives from the remote peer", async () => {
    const { bus, room, session, remote } = makeSession("inviter");
    await session.start();
    await flushMicro();
    expect(remote).not.toBeNull();
    if (!remote) return;
    bus.inject(room, { kind: "bye", from: remote });
    await flushMicro();
    expect(session.state).toBe("closed");
  });
});

describe("PeerSession — listener exception isolation (spec §Events)", () => {
  it("a thrown listener does not propagate or break sibling listeners", async () => {
    const { session } = makeSession("inviter");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const stateA = vi.fn();
      session.on("state", () => {
        throw new Error("listener boom");
      });
      session.on("state", stateA);
      await session.start();
      // Both listeners are attached after the constructor; the throwing one
      // must not prevent stateA from being called.
      expect(stateA).toHaveBeenCalledWith("connecting");
      await session.close();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
