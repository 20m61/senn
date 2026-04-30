/**
 * @senn/signaling-nostr
 *
 * Tier-1 SENN signaling adapter that ferries SDP/ICE messages
 * through Nostr ephemeral events (kind 25556).
 *
 * Spec: docs/signaling-nostr-spec.md.  ADR: docs/adr/0014-signaling-nostr.md.
 *
 * The adapter is opt-in. SENN Core depends only on `SignalingTransport`;
 * a deployment swaps in `NostrSignaling` for `HttpPollSignaling` or
 * `UrlFragmentSignaling` without recompiling Core or any add-on.
 */

import type {
  RoomId,
  SignalingHandler,
  SignalingMessage,
  SignalingTransport,
  Unsubscribe,
} from "@senn/protocol";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  type V2DecryptResult,
  deriveRoomKey,
  encryptV2,
  runConstructionTimeKAT,
  tryDecryptV2,
} from "./v2.js";

const SENN_NOSTR_KIND = 25556;
const SENN_TAG_PREFIX = "senn:";

const WebSocketReadyState = {
  Connecting: 0,
  Open: 1,
  Closing: 2,
  Closed: 3,
} as const;

const ADAPTER_INFO = {
  id: "nostr-v1",
  name: "Nostr (Tier 1, federated)",
  requiresInfrastructure: true,
  description:
    "SENN Tier-1 adapter. Publishes ephemeral events (kind 25556) to a configured set of Nostr relays; subscribes by `t` tag.",
} as const;

export class NostrClosedError extends Error {
  constructor() {
    super("senn: nostr adapter closed");
    this.name = "NostrClosedError";
  }
}

export class NostrPublishError extends Error {
  constructor(message: string) {
    super(`senn: nostr publish failed — ${message}`);
    this.name = "NostrPublishError";
  }
}

export interface NostrSignalingOptions {
  /** Relay WebSocket URLs (`wss://…`). At least one. */
  readonly relays: readonly string[];
  /** Optional pre-existing 32-byte secp256k1 secret. Defaults to a fresh ephemeral key. */
  readonly secretKey?: Uint8Array;
  /**
   * WebSocket constructor override. Defaults to `globalThis.WebSocket`.
   * Used by the in-process tests to inject a fake.
   */
  readonly wsCtor?: typeof WebSocket;
  /**
   * Per-publish ack timeout. publish() resolves when at least one relay
   * acks; rejects only if every relay either nacks or fails to respond
   * within this window.
   */
  readonly publishTimeoutMs?: number;
  /**
   * Opt-in to NIP-44 v2 content encryption (ADR-0024 / ADR-0027).
   *
   * When `true`:
   *   - The adapter derives a room-symmetric key per ADR-0024 §2 and
   *     encrypts the kind-25556 `content` field with NIP-44 v2.
   *   - On receive, the adapter tries v2 decryption first and falls
   *     back to v1 plaintext JSON parsing per ADR-0024 §5.
   *   - A construction-time KAT (ADR-0027 §5) runs on first publish /
   *     subscribe; if it fails, the v2 init promise rejects and the
   *     adapter MUST NOT silently downgrade to v1.
   *
   * When `false` (default), the adapter is v1-only (ADR-0014 wire shape):
   * sends and receives plaintext JSON, ignores v2 ciphertext silently.
   */
  readonly enableV2Encryption?: boolean;
}

/** Subset of the Nostr event we serialize (matches nostr-tools `Event`). */
interface NostrEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly kind: number;
  readonly created_at: number;
  readonly tags: ReadonlyArray<readonly string[]>;
  readonly content: string;
  readonly sig: string;
}

interface RoomState {
  readonly handlers: Set<SignalingHandler>;
  readonly subId: string;
  readonly delivered: Set<string>;
}

const DEFAULT_PUBLISH_TIMEOUT_MS = 5_000;

export class NostrSignaling implements SignalingTransport {
  static readonly info = ADAPTER_INFO;

  readonly publicKey: string;

  private readonly relays: readonly string[];
  private readonly secretKey: Uint8Array;
  private readonly wsCtor: typeof WebSocket;
  private readonly publishTimeoutMs: number;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly rooms = new Map<RoomId, RoomState>();
  private closed = false;
  private subCounter = 0;
  private readonly pendingAcks = new Map<string, (ok: boolean, msg?: string) => void>();
  private readonly v2Enabled: boolean;
  /**
   * Resolves when the NIP-44 v2 KAT (ADR-0027 §5) succeeds, rejects
   * if the upstream cipher envelope mismatches the bundled fixture.
   * Awaited inside `publish()` and `subscribe()` whenever v2 is on,
   * so a KAT failure surfaces deterministically before the first
   * peer message — the strict reading of "throw at construction
   * time" is impossible in JS without an async constructor; this is
   * the closest legal pattern. `undefined` when v2 is disabled.
   */
  private readonly v2InitPromise: Promise<void> | undefined;
  private readonly v2RoomKeys = new Map<RoomId, Promise<Uint8Array>>();

  constructor(opts: NostrSignalingOptions) {
    if (!opts.relays || opts.relays.length === 0) {
      throw new Error("NostrSignaling: at least one relay URL is required");
    }
    this.relays = [...opts.relays];
    this.secretKey = opts.secretKey ?? generateSecretKey();
    this.publicKey = getPublicKey(this.secretKey);
    const ctor = opts.wsCtor ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!ctor) {
      throw new Error("NostrSignaling: no WebSocket constructor available");
    }
    this.wsCtor = ctor;
    this.publishTimeoutMs = opts.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;
    this.v2Enabled = opts.enableV2Encryption ?? false;
    this.v2InitPromise = this.v2Enabled ? runConstructionTimeKAT() : undefined;
    // Surface the KAT promise's rejection to the runtime if nothing
    // else awaits it (e.g., a constructor immediately followed by
    // .close() with no publish/subscribe in between). Without this,
    // the rejection becomes an unhandled promise event. The catch
    // here is intentionally swallowing — every legitimate code path
    // (publish, subscribe) re-awaits v2InitPromise and surfaces the
    // error there.
    this.v2InitPromise?.catch(() => undefined);
  }

  async publish(roomId: RoomId, message: SignalingMessage): Promise<void> {
    if (this.closed) throw new NostrClosedError();
    const content = await this.encodeContent(roomId, message);
    const event = finalizeEvent(
      {
        kind: SENN_NOSTR_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["t", `${SENN_TAG_PREFIX}${roomId}`]],
        content,
      },
      this.secretKey,
    ) as NostrEvent;

    let relayCount = 0;
    let loopFinalized = false;
    let lastNackMsg: string | undefined;
    let finalizeAndCheck: () => void = () => undefined;
    // Lifted out so the early "no reachable relay" throw can cancel the
    // timeout. Without this, the setTimeout fires after the synchronous
    // throw and surfaces as an unhandled rejection from the abandoned
    // ackPromise (the throw bypasses `await ackPromise`).
    let cancelAckTimeout: () => void = () => undefined;
    const ackPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let nacked = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const tryReject = () => {
        if (settled) return;
        if (!loopFinalized || nacked < relayCount) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.pendingAcks.delete(event.id);
        reject(new NostrPublishError(lastNackMsg ?? "all relays nacked"));
      };
      const finish = (ok: boolean, msg?: string) => {
        if (settled) return;
        if (ok) {
          settled = true;
          if (timer) clearTimeout(timer);
          this.pendingAcks.delete(event.id);
          resolve();
        } else {
          nacked++;
          if (typeof msg === "string") lastNackMsg = msg;
          tryReject();
        }
      };
      this.pendingAcks.set(event.id, finish);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.pendingAcks.delete(event.id);
        reject(new NostrPublishError("ack timeout"));
      }, this.publishTimeoutMs);
      finalizeAndCheck = () => {
        loopFinalized = true;
        tryReject();
      };
      cancelAckTimeout = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        // Do not resolve or reject. The caller's synchronous throw is
        // the user-visible error and nothing awaits ackPromise on the
        // early-return path. With `settled = true`, the timer's
        // callback no-ops if it has already been queued, so no later
        // rejection can leak.
      };
    });

    const frame = JSON.stringify(["EVENT", event]);
    for (const url of this.relays) {
      const ws = await this.ensureSocket(url).catch(() => null);
      if (!ws) continue;
      relayCount++;
      try {
        ws.send(frame);
      } catch {
        // count this relay as a nack so the publish resolves on remaining ones
        const cb = this.pendingAcks.get(event.id);
        cb?.(false, `send failed on ${url}`);
      }
    }
    if (relayCount === 0) {
      cancelAckTimeout();
      this.pendingAcks.delete(event.id);
      throw new NostrPublishError("no reachable relay");
    }
    finalizeAndCheck();
    await ackPromise;
  }

  subscribe(roomId: RoomId, handler: SignalingHandler): Unsubscribe {
    if (this.closed) throw new NostrClosedError();
    // Pre-warm the v2 room key + KAT promise so the first inbound
    // event for this room can decrypt without a cold-start delay.
    // The await is fire-and-forget; the actual decode in handleEvent
    // re-awaits the cached promise, so a KAT failure still surfaces
    // (as a logged warning when the first event arrives — see
    // decodeContent fallback path).
    if (this.v2Enabled) {
      void this.getV2RoomKey(roomId).catch(() => undefined);
    }
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        handlers: new Set(),
        subId: this.newSubId(roomId),
        delivered: new Set(),
      };
      this.rooms.set(roomId, room);
      void this.openReqOnAll(roomId, room);
    }
    room.handlers.add(handler);
    return () => {
      const cur = this.rooms.get(roomId);
      if (!cur) return;
      cur.handlers.delete(handler);
      if (cur.handlers.size === 0) {
        this.closeReqOnAll(cur.subId);
        this.rooms.delete(roomId);
      }
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const room of this.rooms.values()) this.closeReqOnAll(room.subId);
    this.rooms.clear();
    for (const ws of this.sockets.values()) {
      try {
        ws.close();
      } catch {
        /* idempotent */
      }
    }
    this.sockets.clear();
  }

  private newSubId(roomId: RoomId): string {
    this.subCounter = (this.subCounter + 1) % 0xffffff;
    return `s_${roomId.slice(0, 8)}_${this.subCounter.toString(36)}`;
  }

  private async ensureSocket(url: string): Promise<WebSocket | null> {
    const existing = this.sockets.get(url);
    if (existing && existing.readyState === WebSocketReadyState.Open) return existing;
    if (existing && existing.readyState === WebSocketReadyState.Connecting) {
      await this.waitForOpen(existing);
      return (existing.readyState as number) === WebSocketReadyState.Open ? existing : null;
    }
    const ws = new this.wsCtor(url);
    this.sockets.set(url, ws);
    ws.addEventListener("message", (ev: MessageEvent) => this.onRelayMessage(url, ev));
    ws.addEventListener("close", () => {
      if (this.sockets.get(url) === ws) this.sockets.delete(url);
    });
    ws.addEventListener("error", () => {
      // Leave the socket entry so close() will still call .close().
    });
    await this.waitForOpen(ws);
    if ((ws.readyState as number) !== WebSocketReadyState.Open) {
      this.sockets.delete(url);
      return null;
    }
    // Re-emit any active room subscriptions on this freshly-opened relay.
    for (const [roomId, room] of this.rooms) {
      ws.send(this.reqFrame(room.subId, roomId));
    }
    return ws;
  }

  private waitForOpen(ws: WebSocket): Promise<void> {
    if (ws.readyState === WebSocketReadyState.Open) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        ws.removeEventListener("open", done);
        ws.removeEventListener("error", done);
        ws.removeEventListener("close", done);
        resolve();
      };
      ws.addEventListener("open", done);
      ws.addEventListener("error", done);
      ws.addEventListener("close", done);
    });
  }

  private reqFrame(subId: string, roomId: RoomId): string {
    return JSON.stringify([
      "REQ",
      subId,
      { kinds: [SENN_NOSTR_KIND], "#t": [`${SENN_TAG_PREFIX}${roomId}`] },
    ]);
  }

  private async openReqOnAll(roomId: RoomId, room: RoomState): Promise<void> {
    for (const url of this.relays) {
      const ws = await this.ensureSocket(url).catch(() => null);
      if (!ws) continue;
      try {
        ws.send(this.reqFrame(room.subId, roomId));
      } catch {
        /* relay-specific failure; others may still work */
      }
    }
  }

  private closeReqOnAll(subId: string): void {
    const frame = JSON.stringify(["CLOSE", subId]);
    for (const ws of this.sockets.values()) {
      try {
        ws.send(frame);
      } catch {
        /* best-effort */
      }
    }
  }

  private onRelayMessage(_url: string, ev: MessageEvent): void {
    let frame: unknown;
    try {
      frame = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch {
      return;
    }
    if (!Array.isArray(frame) || frame.length === 0) return;
    const tag = frame[0];
    if (tag === "EVENT") {
      const subId = frame[1];
      const event = frame[2] as NostrEvent | undefined;
      if (typeof subId !== "string" || !event || typeof event !== "object") return;
      this.handleEvent(subId, event);
      return;
    }
    if (tag === "OK") {
      const eventId = frame[1];
      const ok = frame[2];
      const msg = frame[3];
      if (typeof eventId !== "string") return;
      const cb = this.pendingAcks.get(eventId);
      if (cb) cb(Boolean(ok), typeof msg === "string" ? msg : undefined);
      return;
    }
    // EOSE / NOTICE / AUTH / COUNT — not load-bearing for v1.
  }

  private handleEvent(subId: string, event: NostrEvent): void {
    if (event.kind !== SENN_NOSTR_KIND) return;
    let matched: { roomId: RoomId; room: RoomState } | null = null;
    for (const [roomId, room] of this.rooms) {
      if (room.subId === subId) {
        matched = { roomId, room };
        break;
      }
    }
    if (!matched) return;
    if (matched.room.delivered.has(event.id)) return;
    matched.room.delivered.add(event.id);
    void this.decodeAndDispatch(matched.room, event.content);
  }

  private async decodeAndDispatch(room: RoomState, content: string): Promise<void> {
    const parsed = await this.decodeContent(content);
    if (!parsed) return; // discarded per ADR-0024 §5
    for (const handler of room.handlers) {
      try {
        handler(parsed);
      } catch (err) {
        console.error("senn: nostr handler threw", err);
      }
    }
  }

  private async encodeContent(roomId: RoomId, message: SignalingMessage): Promise<string> {
    if (!this.v2Enabled) return JSON.stringify(message);
    // ADR-0027 §5: KAT must succeed before any v2 op. Re-await
    // here so a KAT failure rejects publish() rather than producing
    // a non-conformant ciphertext. Caching is implicit in the
    // promise.
    await this.v2InitPromise;
    const key = await this.getV2RoomKey(roomId);
    return encryptV2(message, key);
  }

  /**
   * ADR-0024 §5 receive path (7 steps). Returns a `SignalingMessage`
   * for v2 success (steps 1–3) or v1 fallback (step 5); returns
   * `null` to discard (steps 4 / 6) — the adapter MUST NOT surface
   * a parse error to the handler.
   */
  private async decodeContent(content: string): Promise<SignalingMessage | null> {
    if (this.v2Enabled) {
      let result: V2DecryptResult;
      try {
        await this.v2InitPromise;
        // Find the active room key. handleEvent already matched a
        // room before delegating; in the current 1-room-per-subId
        // wiring we can re-resolve via the only room, but to keep
        // decodeContent reusable from the verify-self-test we walk
        // the cache.
        let v2Decoded = false;
        for (const keyPromise of this.v2RoomKeys.values()) {
          const key = await keyPromise;
          result = tryDecryptV2(content, key);
          if (result.kind === "v2") return result.message;
          if (result.kind === "v2-no-sentinel") {
            // ADR-0024 §5 step 4: decrypt OK but no sentinel ⇒
            // discard. MUST NOT v1-fallback for this content.
            v2Decoded = true;
            break;
          }
          // result.kind === "decrypt-fail" with this key — try the
          // next room key (covers multi-room subscriptions).
        }
        if (v2Decoded) return null;
      } catch (err) {
        // KAT or HKDF failure surfaced here. Log once and fall
        // through to v1 parsing — but only if v2 init is the
        // failure. A failed KAT means we cannot safely parse v2,
        // and v1 plaintext content is still valid (it is plain
        // JSON), so the operator does not lose v1 messages.
        console.warn("senn: nostr v2 init failed, falling back to v1 only:", err);
      }
    }
    // ADR-0024 §5 step 5: v1 fallback (also the v1-only path).
    try {
      return JSON.parse(content) as SignalingMessage;
    } catch {
      return null; // step 6: drop silently
    }
  }

  private getV2RoomKey(roomId: RoomId): Promise<Uint8Array> {
    let promise = this.v2RoomKeys.get(roomId);
    if (!promise) {
      promise = deriveRoomKey(roomId);
      this.v2RoomKeys.set(roomId, promise);
    }
    return promise;
  }
}

export type { SignalingMessage, SignalingTransport };
