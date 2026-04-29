/**
 * Public TypeScript surface for `@sennjs/addon-sdk`.
 *
 * The runtime ships as a hand-written classic script
 * (`runtime/senn-addon-sdk.js`) that is copied into each add-on
 * directory at build time and loaded by the add-on's HTML. These types
 * describe the `window.senn` global the runtime installs.
 *
 * Spec: docs/addon-sdk-spec.md.  Bridge protocol: docs/addon-runtime-spec.md.
 */

export const SENN_ADDON_SDK_VERSION = "0.1.0";

export interface SennAddonContext {
  readonly addonId: string;
  readonly version: string;
  readonly sessionId: string;
}

export interface SennDeliverEvent {
  readonly payload: unknown;
  readonly from?: string;
}

export interface SennDeliverBinEvent {
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly from?: string;
}

export interface SennAddonError extends Error {
  readonly code?: string;
}

export interface SennAddonEventMap {
  init: SennAddonContext;
  deliver: SennDeliverEvent;
  "deliver-bin": SennDeliverBinEvent;
  error: SennAddonError;
}

export interface SennAddonPeer {
  send(payload: unknown): void;
  sendBinary(req: { mime?: string; bytes: Uint8Array }): void;
}

export interface SennAddonAudio {
  /**
   * Start receiving microphone-derived level values in [0,1]. Returns
   * an unsubscribe function. Multiple calls inside one add-on share a
   * single host-side subscription.
   */
  subscribeLevel(handler: (level: number) => void): () => void;
}

/**
 * ADR-0015 — cross-peer audio/video. The SDK surface is intentionally
 * minimal: addons request the host to start/stop sending tracks and to
 * route incoming tracks to its host-managed sink. The addon NEVER
 * receives a `MediaStreamTrack` reference.
 */
export interface SennAddonMedia {
  startLocalAudio(): void;
  stopLocalAudio(): void;
  startLocalVideo(opts?: { source?: "camera" | "display" }): void;
  stopLocalVideo(): void;
  subscribeRemoteAudio(): void;
  unsubscribeRemoteAudio(): void;
  subscribeRemoteVideo(): void;
  unsubscribeRemoteVideo(): void;
  /** Lifecycle events for tracks the host knows about. */
  onTrack(
    handler: (event: {
      direction: "local" | "remote";
      track: "audio" | "video";
      state: "added" | "removed";
    }) => void,
  ): () => void;
}

export interface SennAddonStorage {
  get<T = unknown>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<null>;
  delete(key: string): Promise<null>;
  list(): Promise<readonly string[]>;
  clear(): Promise<null>;
}

export interface SennAddonGlobal {
  readonly context: SennAddonContext | null;
  ready(): Promise<SennAddonContext>;
  on<K extends keyof SennAddonEventMap>(
    event: K,
    handler: (value: SennAddonEventMap[K]) => void,
  ): () => void;
  readonly peer: SennAddonPeer;
  readonly storage: SennAddonStorage;
  readonly audio: SennAddonAudio;
  readonly media: SennAddonMedia;
}

declare global {
  interface Window {
    senn?: SennAddonGlobal;
  }
}
