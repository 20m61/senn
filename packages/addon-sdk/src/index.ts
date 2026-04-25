/**
 * Public TypeScript surface for `@senn/addon-sdk`.
 *
 * The runtime ships as a hand-written classic script
 * (`runtime/senn-addon-sdk.js`) that is copied into each add-on
 * directory at build time and loaded by the add-on's HTML. These types
 * describe the `window.senn` global the runtime installs.
 *
 * Spec: docs/addon-sdk-spec.md.  Bridge protocol: docs/addon-runtime-spec.md.
 */

export const SENN_ADDON_SDK_VERSION = "0.0.0";

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
}

declare global {
  interface Window {
    senn?: SennAddonGlobal;
  }
}
