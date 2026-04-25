/**
 * SENN Core PeerSession.
 *
 * Spec: docs/peer-session-spec.md.
 *
 * One PeerSession represents one logical connection from the local peer to
 * exactly one remote peer in one room, transported by an
 * RTCPeerConnection driven over a SignalingTransport adapter.
 */

import {
  type PeerId,
  type RoomId,
  type SignalingMessage,
  type SignalingTransport,
  type Unsubscribe,
  isPeerId,
} from "@senn/protocol";

export type PeerSessionState = "idle" | "connecting" | "connected" | "closed" | "failed";

export type PeerSessionRole = "inviter" | "joiner";

export interface PeerSessionBinaryMessage {
  /** Routing key (e.g. addon id). Used by AddonHost to demux per-addon. */
  readonly addon: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export interface PeerSessionEvents {
  state: PeerSessionState;
  text: string;
  binary: PeerSessionBinaryMessage;
  error: Error;
}

export interface PeerSessionOptions {
  readonly role: PeerSessionRole;
  readonly roomId: RoomId;
  readonly localPeerId: PeerId;
  readonly remotePeerId: PeerId | null;
  readonly signaling: SignalingTransport;
  readonly rtcConfig: RTCConfiguration;
}

const TEXT_CHANNEL_LABEL = "core.text";
const BIN_CHANNEL_LABEL = "core.bin";
const TEXT_MAX_BYTES = 64 * 1024;
const BIN_MAX_BYTES = 64 * 1024;

type Listener<T> = (value: T) => void;

export class PeerSession {
  readonly role: PeerSessionRole;
  readonly roomId: RoomId;
  readonly localPeerId: PeerId;

  private remotePeerId: PeerId | null;
  private readonly signaling: SignalingTransport;
  private readonly rtcConfig: RTCConfiguration;

  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private binChannel: RTCDataChannel | null = null;
  private signalingUnsub: Unsubscribe | null = null;

  private currentState: PeerSessionState = "idle";
  private readonly listeners: {
    [K in keyof PeerSessionEvents]: Set<Listener<PeerSessionEvents[K]>>;
  } = {
    state: new Set(),
    text: new Set(),
    binary: new Set(),
    error: new Set(),
  };

  constructor(opts: PeerSessionOptions) {
    this.role = opts.role;
    this.roomId = opts.roomId;
    this.localPeerId = opts.localPeerId;
    this.remotePeerId = opts.remotePeerId;
    this.signaling = opts.signaling;
    this.rtcConfig = opts.rtcConfig;
  }

  get state(): PeerSessionState {
    return this.currentState;
  }

  on<K extends keyof PeerSessionEvents>(
    event: K,
    handler: Listener<PeerSessionEvents[K]>,
  ): () => void {
    this.listeners[event].add(handler);
    return () => {
      this.listeners[event].delete(handler);
    };
  }

  private emit<K extends keyof PeerSessionEvents>(event: K, value: PeerSessionEvents[K]): void {
    for (const handler of this.listeners[event]) {
      try {
        handler(value);
      } catch (err) {
        // Listener exceptions must not propagate.
        console.error("senn: peer-session listener threw", err);
      }
    }
  }

  private setState(next: PeerSessionState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    this.emit("state", next);
  }

  async start(): Promise<void> {
    if (this.currentState !== "idle") {
      throw new Error(`PeerSession.start() called in state ${this.currentState}`);
    }
    this.setState("connecting");

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !this.remotePeerId) return;
      void this.signaling
        .publish(this.roomId, {
          kind: "ice",
          from: this.localPeerId,
          to: this.remotePeerId,
          candidate: ev.candidate.toJSON(),
        })
        .catch((err) => this.emit("error", err as Error));
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "closed") {
        if (this.currentState !== "closed") this.setState(s === "failed" ? "failed" : "closed");
      }
    };

    if (this.role === "inviter") {
      const channel = pc.createDataChannel(TEXT_CHANNEL_LABEL);
      this.bindDataChannel(channel);
      const binChannel = pc.createDataChannel(BIN_CHANNEL_LABEL, { ordered: true });
      binChannel.binaryType = "arraybuffer";
      this.bindBinaryChannel(binChannel);
    } else {
      pc.ondatachannel = (ev) => {
        if (ev.channel.label === TEXT_CHANNEL_LABEL) {
          this.bindDataChannel(ev.channel);
          return;
        }
        if (ev.channel.label === BIN_CHANNEL_LABEL) {
          ev.channel.binaryType = "arraybuffer";
          this.bindBinaryChannel(ev.channel);
          return;
        }
        ev.channel.close();
      };
    }

    // Subscribe to inbound signaling early so we don't miss anything.
    this.signalingUnsub = this.signaling.subscribe(this.roomId, (msg) => {
      void this.handleSignalingMessage(msg).catch((err) => this.emit("error", err as Error));
    });

    if (this.role === "inviter") {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!offer.sdp) throw new Error("PeerSession: createOffer() produced no SDP");
      await this.signaling.publish(this.roomId, {
        kind: "offer",
        from: this.localPeerId,
        sdp: offer.sdp,
      });
    }
  }

  async sendText(message: string): Promise<void> {
    if (this.currentState !== "connected") {
      throw new Error(`PeerSession.sendText() called in state ${this.currentState}`);
    }
    const bytes = new TextEncoder().encode(message).byteLength;
    if (bytes > TEXT_MAX_BYTES) {
      throw new Error(`PeerSession.sendText: payload ${bytes}B exceeds ${TEXT_MAX_BYTES}B`);
    }
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("PeerSession.sendText: data channel is not open");
    }
    this.channel.send(message);
  }

  async sendBinary(message: PeerSessionBinaryMessage): Promise<void> {
    if (this.currentState !== "connected") {
      throw new Error(`PeerSession.sendBinary() called in state ${this.currentState}`);
    }
    if (typeof message.addon !== "string" || message.addon.length === 0) {
      throw new Error("PeerSession.sendBinary: addon must be a non-empty string");
    }
    if (typeof message.mime !== "string") {
      throw new Error("PeerSession.sendBinary: mime must be a string");
    }
    if (!(message.bytes instanceof Uint8Array)) {
      throw new Error("PeerSession.sendBinary: bytes must be a Uint8Array");
    }
    if (message.bytes.byteLength > BIN_MAX_BYTES) {
      throw new Error(
        `PeerSession.sendBinary: payload ${message.bytes.byteLength}B exceeds ${BIN_MAX_BYTES}B`,
      );
    }
    if (!this.binChannel || this.binChannel.readyState !== "open") {
      throw new Error("PeerSession.sendBinary: binary channel is not open");
    }
    const headerJson = JSON.stringify({
      v: 1,
      addon: message.addon,
      mime: message.mime,
      size: message.bytes.byteLength,
    });
    const headerBytes = new TextEncoder().encode(headerJson);
    const frame = new ArrayBuffer(4 + headerBytes.byteLength + message.bytes.byteLength);
    const view = new DataView(frame);
    view.setUint32(0, headerBytes.byteLength, true);
    new Uint8Array(frame, 4, headerBytes.byteLength).set(headerBytes);
    new Uint8Array(frame, 4 + headerBytes.byteLength, message.bytes.byteLength).set(message.bytes);
    this.binChannel.send(frame);
  }

  async close(): Promise<void> {
    if (this.currentState === "closed") return;
    const wasActive = this.currentState !== "idle";
    this.setState("closed");

    try {
      if (wasActive) {
        await this.signaling
          .publish(this.roomId, { kind: "bye", from: this.localPeerId })
          .catch(() => undefined);
      }
    } finally {
      this.signalingUnsub?.();
      this.signalingUnsub = null;
      this.channel?.close();
      this.channel = null;
      this.binChannel?.close();
      this.binChannel = null;
      this.pc?.close();
      this.pc = null;
    }
  }

  private bindDataChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => this.setState("connected");
    channel.onclose = () => {
      if (this.currentState !== "closed") this.setState("closed");
    };
    channel.onerror = (ev) => {
      const err = (ev as RTCErrorEvent).error ?? new Error("RTCDataChannel error");
      this.emit("error", err as Error);
    };
    channel.onmessage = (ev) => {
      if (typeof ev.data !== "string") return; // binary frames belong on core.bin
      this.emit("text", ev.data);
    };
  }

  private bindBinaryChannel(channel: RTCDataChannel): void {
    this.binChannel = channel;
    channel.onerror = (ev) => {
      const err = (ev as RTCErrorEvent).error ?? new Error("RTCDataChannel error (bin)");
      this.emit("error", err as Error);
    };
    channel.onmessage = (ev) => {
      const data = ev.data;
      let buf: ArrayBuffer | null = null;
      if (data instanceof ArrayBuffer) {
        buf = data;
      } else if (data && typeof (data as Blob).arrayBuffer === "function") {
        // Some implementations deliver Blob even with binaryType=arraybuffer.
        void (data as Blob).arrayBuffer().then((b) => this.handleBinaryFrame(b));
        return;
      } else {
        this.emit("error", new Error("PeerSession.bin: unexpected non-binary frame"));
        return;
      }
      this.handleBinaryFrame(buf);
    };
  }

  private handleBinaryFrame(buf: ArrayBuffer): void {
    if (buf.byteLength < 4) {
      this.emit("error", new Error("PeerSession.bin: frame too short for header_len"));
      return;
    }
    const view = new DataView(buf);
    const headerLen = view.getUint32(0, true);
    if (headerLen === 0 || 4 + headerLen > buf.byteLength) {
      this.emit("error", new Error("PeerSession.bin: header_len out of range"));
      return;
    }
    let header: { v?: unknown; addon?: unknown; mime?: unknown; size?: unknown };
    try {
      const headerText = new TextDecoder().decode(new Uint8Array(buf, 4, headerLen));
      header = JSON.parse(headerText);
    } catch (err) {
      this.emit("error", new Error(`PeerSession.bin: header parse: ${(err as Error).message}`));
      return;
    }
    if (
      header.v !== 1 ||
      typeof header.addon !== "string" ||
      header.addon.length === 0 ||
      typeof header.mime !== "string" ||
      typeof header.size !== "number"
    ) {
      this.emit("error", new Error("PeerSession.bin: header schema invalid"));
      return;
    }
    const bodyOffset = 4 + headerLen;
    const bodyLen = buf.byteLength - bodyOffset;
    if (header.size !== bodyLen) {
      this.emit("error", new Error("PeerSession.bin: header.size != body length"));
      return;
    }
    const bytes = new Uint8Array(buf.slice(bodyOffset));
    this.emit("binary", { addon: header.addon, mime: header.mime, bytes });
  }

  private async handleSignalingMessage(msg: SignalingMessage): Promise<void> {
    if (!isPeerId(msg.from)) return;
    if (msg.from === this.localPeerId) return;
    if (this.remotePeerId && msg.from !== this.remotePeerId) return;
    if (msg.kind === "answer" || msg.kind === "ice") {
      if (!isPeerId(msg.to) || msg.to !== this.localPeerId) return;
    }

    const pc = this.pc;
    if (!pc) return;

    switch (msg.kind) {
      case "offer": {
        if (this.role !== "joiner") return;
        if (!this.remotePeerId) this.remotePeerId = msg.from;
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (!answer.sdp) throw new Error("PeerSession: createAnswer() produced no SDP");
        await this.signaling.publish(this.roomId, {
          kind: "answer",
          from: this.localPeerId,
          to: this.remotePeerId,
          sdp: answer.sdp,
        });
        return;
      }
      case "answer": {
        if (this.role !== "inviter") return;
        if (!this.remotePeerId) this.remotePeerId = msg.from;
        await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        return;
      }
      case "ice": {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch (err) {
          this.emit("error", err as Error);
        }
        return;
      }
      case "bye": {
        await this.close();
        return;
      }
    }
  }
}
