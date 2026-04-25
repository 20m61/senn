/**
 * @senn/signaling-url-fragment
 *
 * Tier-0 SENN signaling adapter. Implements `SignalingTransport` from
 * `@senn/protocol` with an out-of-band carrier: messages buffered in an
 * outbox are exported as a base64url bundle (URL fragment, QR, copy/paste),
 * delivered to the peer's adapter via `importBundle`, and dispatched to
 * subscribers.
 *
 * Spec: docs/signaling-url-fragment-spec.md.
 */

import {
  type RoomId,
  SIGNALING_BUNDLE_FRAGMENT_KEY,
  SIGNALING_BUNDLE_VERSION,
  type SignalingBundleV1,
  type SignalingHandler,
  type SignalingMessage,
  type SignalingTransport,
  type Unsubscribe,
  decodeSignalingBundle,
  encodeSignalingBundle,
  extractBundleFromUrl,
} from "@senn/protocol";

const ADAPTER_INFO = {
  id: "url-fragment-v1",
  name: "URL fragment (out-of-band)",
  requiresInfrastructure: false,
  description: "SENN Tier-0 adapter. Bundles are exported and imported via URL fragment or QR.",
} as const;

export class AdapterClosedError extends Error {
  constructor() {
    super("senn: adapter closed");
    this.name = "AdapterClosedError";
  }
}

export class UrlFragmentSignaling implements SignalingTransport {
  static readonly info = ADAPTER_INFO;

  private readonly outbox = new Map<RoomId, SignalingMessage[]>();
  private readonly handlers = new Map<RoomId, Set<SignalingHandler>>();
  private closed = false;

  publish(roomId: RoomId, message: SignalingMessage): Promise<void> {
    if (this.closed) return Promise.reject(new AdapterClosedError());
    const list = this.outbox.get(roomId);
    if (list) list.push(message);
    else this.outbox.set(roomId, [message]);
    return Promise.resolve();
  }

  subscribe(roomId: RoomId, handler: SignalingHandler): Unsubscribe {
    if (this.closed) throw new AdapterClosedError();
    let set = this.handlers.get(roomId);
    if (!set) {
      set = new Set();
      this.handlers.set(roomId, set);
    }
    set.add(handler);
    return () => {
      const live = this.handlers.get(roomId);
      live?.delete(handler);
      if (live && live.size === 0) this.handlers.delete(roomId);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.outbox.clear();
    this.handlers.clear();
  }

  /**
   * Drain the outbox for `roomId` and return a base64url-encoded bundle.
   * Returns `""` if the outbox is empty. Throws if the adapter is closed.
   */
  async exportBundle(roomId: RoomId): Promise<string> {
    if (this.closed) throw new AdapterClosedError();
    const messages = this.outbox.get(roomId);
    if (!messages || messages.length === 0) return "";
    const bundle: SignalingBundleV1 = {
      v: SIGNALING_BUNDLE_VERSION,
      roomId,
      messages: [...messages],
    };
    this.outbox.delete(roomId);
    return encodeSignalingBundle(bundle);
  }

  /**
   * Decode and validate `encoded`, then synchronously deliver each message
   * to subscribers of the bundle's room. Subscriber exceptions are caught.
   * Throws if the adapter is closed or if validation fails.
   */
  async importBundle(encoded: string): Promise<{ roomId: RoomId; delivered: number }> {
    if (this.closed) throw new AdapterClosedError();
    const bundle = await decodeSignalingBundle(encoded);
    const handlers = this.handlers.get(bundle.roomId);
    if (!handlers || handlers.size === 0) {
      return { roomId: bundle.roomId, delivered: 0 };
    }
    let delivered = 0;
    for (const message of bundle.messages) {
      for (const handler of handlers) {
        try {
          handler(message);
        } catch (err) {
          // Swallow handler exceptions per the SignalingTransport contract.
          // Surface in dev via console.error; never log message body.
          console.error("senn: signaling handler threw", err);
        }
      }
      delivered++;
    }
    return { roomId: bundle.roomId, delivered };
  }

  /** Build a fragment string `s=<encoded>` (no leading `#`). */
  static toFragment(encoded: string): string {
    return `${SIGNALING_BUNDLE_FRAGMENT_KEY}=${encoded}`;
  }

  /** Pull the encoded bundle out of any URL whose fragment carries `s=`. */
  static fromUrl(href: string): string | null {
    return extractBundleFromUrl(href);
  }
}

export { ADAPTER_INFO as URL_FRAGMENT_ADAPTER_INFO };
