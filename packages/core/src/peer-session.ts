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

export interface PeerSessionEvents {
  state: PeerSessionState;
  text: string;
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

const DATA_CHANNEL_LABEL = "core.text";
const TEXT_MAX_BYTES = 64 * 1024;

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
  private signalingUnsub: Unsubscribe | null = null;

  private currentState: PeerSessionState = "idle";
  private readonly listeners: {
    [K in keyof PeerSessionEvents]: Set<Listener<PeerSessionEvents[K]>>;
  } = {
    state: new Set(),
    text: new Set(),
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
      const channel = pc.createDataChannel(DATA_CHANNEL_LABEL);
      this.bindDataChannel(channel);
    } else {
      pc.ondatachannel = (ev) => {
        if (ev.channel.label !== DATA_CHANNEL_LABEL) {
          ev.channel.close();
          return;
        }
        this.bindDataChannel(ev.channel);
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
      if (typeof ev.data !== "string") return; // binary frames not yet defined
      this.emit("text", ev.data);
    };
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
