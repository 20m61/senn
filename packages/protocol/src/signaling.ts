/**
 * Vendor-neutral signaling contract.
 *
 * SENN Core depends only on this interface for the SDP / ICE exchange.
 * Reference adapters (URL/QR fragment, HTTP short-poll, WebSocket, …) live
 * outside Core. See ADR-0007 and docs/dev/signaling-adapter.md.
 */

import type { PeerId, RoomId } from "./ids.js";

export type SignalingMessage =
  | {
      readonly kind: "offer";
      readonly from: PeerId;
      readonly sdp: string;
    }
  | {
      readonly kind: "answer";
      readonly from: PeerId;
      readonly to: PeerId;
      readonly sdp: string;
    }
  | {
      readonly kind: "ice";
      readonly from: PeerId;
      readonly to: PeerId;
      readonly candidate: RTCIceCandidateInit;
    }
  | {
      readonly kind: "bye";
      readonly from: PeerId;
    };

export type SignalingHandler = (msg: SignalingMessage) => void;

export type Unsubscribe = () => void;

/**
 * Adapters MUST implement these methods. They MUST NOT add side channels.
 *
 * Conformance:
 * - `publish` resolves only after the message has reached the underlying
 *   transport. Failure rejects with an `Error`.
 * - `subscribe` invokes the handler once per distinct `SignalingMessage`
 *   delivered for the given room. Handler exceptions MUST be caught.
 * - `close` releases all resources held by the adapter and terminates any
 *   background polling, sockets, or subscriptions.
 */
export interface SignalingTransport {
  publish(roomId: RoomId, message: SignalingMessage): Promise<void>;
  subscribe(roomId: RoomId, handler: SignalingHandler): Unsubscribe;
  close(): Promise<void>;
}

export type { PeerId, RoomId };

/** Capability descriptor exposed to host apps for adapter selection. */
export interface SignalingAdapterInfo {
  readonly id: string;
  readonly name: string;
  readonly requiresInfrastructure: boolean;
  readonly description: string;
}
