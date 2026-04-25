/**
 * @senn/addon-runtime — host side of the SENN add-on runtime.
 *
 * Spec: docs/addon-runtime-spec.md.
 *
 * Loads a static add-on into a sandboxed iframe, validates its manifest,
 * and exchanges typed bridge messages over postMessage. Optionally binds
 * to a PeerSession so add-on `send` ops are wrapped into AddonMessage
 * envelopes and forwarded to the remote peer.
 */

import { type ManifestSignatureV1, validateSignaturePayload, verifyManifest } from "@senn/manifest";
import {
  type AddonMessageEnvelope,
  tryParseAddonEnvelope,
  validateAddonEnvelope,
} from "@senn/protocol";
import {
  type AddonStorage,
  type StorageBackend,
  StorageError,
  createAddonStorage,
} from "@senn/storage";

/**
 * Minimal duck-typed contract that AddonHost needs from a transport.
 * @senn/core's PeerSession satisfies this structurally; addon-runtime
 * stays free of any dependency on @senn/core.
 */
export interface AddonPeerLink {
  on(event: "text", handler: (text: string) => void): () => void;
  on(
    event: "binary",
    handler: (msg: { addon: string; mime: string; bytes: Uint8Array }) => void,
  ): () => void;
  sendText(message: string): Promise<void>;
  sendBinary(message: { addon: string; mime: string; bytes: Uint8Array }): Promise<void>;
}

export const SENN_ADDON_RUNTIME_VERSION = "0.0.0";
export const ADDON_BRIDGE_KIND = "senn.addon.v1" as const;

export type AddonHostState = "created" | "mounted" | "initialized" | "active" | "closed";

export type AddonStorageOp = "get" | "put" | "delete" | "list" | "clear";

export type AddonBridgeMessage =
  | {
      kind: typeof ADDON_BRIDGE_KIND;
      op: "init";
      addonId: string;
      version: string;
      sessionId: string;
    }
  | { kind: typeof ADDON_BRIDGE_KIND; op: "ready" }
  | { kind: typeof ADDON_BRIDGE_KIND; op: "send"; payload: unknown }
  | { kind: typeof ADDON_BRIDGE_KIND; op: "deliver"; payload: unknown; from?: string }
  | { kind: typeof ADDON_BRIDGE_KIND; op: "send-bin"; mime: string; bytes: Uint8Array }
  | {
      kind: typeof ADDON_BRIDGE_KIND;
      op: "deliver-bin";
      mime: string;
      bytes: Uint8Array;
      from?: string;
    }
  | { kind: typeof ADDON_BRIDGE_KIND; op: "error"; code?: string; message: string }
  | { kind: typeof ADDON_BRIDGE_KIND; op: "audio.level.subscribe" }
  | { kind: typeof ADDON_BRIDGE_KIND; op: "audio.level.unsubscribe" }
  | { kind: typeof ADDON_BRIDGE_KIND; op: "audio.level"; level: number }
  | {
      kind: typeof ADDON_BRIDGE_KIND;
      op: "storage";
      rid: string;
      storage: AddonStorageOp;
      key?: string;
      value?: unknown;
    }
  | {
      kind: typeof ADDON_BRIDGE_KIND;
      op: "storage.result";
      rid: string;
      ok: true;
      value: unknown;
    }
  | {
      kind: typeof ADDON_BRIDGE_KIND;
      op: "storage.result";
      rid: string;
      ok: false;
      error: string;
    };

export interface AddonManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly entry: string;
  readonly license: string;
  readonly network: false;
  readonly permissions: readonly string[];
  readonly capabilities: readonly string[];
}

export class AddonValidationError extends Error {
  constructor(message: string) {
    super(`senn: addon validation failed — ${message}`);
    this.name = "AddonValidationError";
  }
}

export interface AddonHostEvents {
  state: AddonHostState;
  send: unknown; // payload the add-on asked to send
  error: Error;
}

export type VerifyMode = "none" | "optional" | "required";

export interface AddonHostVerifyOptions {
  readonly mode: VerifyMode;
  /** base64url Ed25519 public keys the host trusts. Required for `optional` and `required`. */
  readonly trustedKeys?: ReadonlySet<string>;
}

export interface AddonHostOptions {
  readonly manifestUrl: string;
  readonly container: HTMLElement;
  readonly session?: AddonPeerLink;
  /** Optional storage backend; without it, storage ops respond with permission-denied. */
  readonly storage?: StorageBackend;
  /** Override fetch (used by tests). */
  readonly fetcher?: typeof fetch;
  /** Manifest-signature verification mode (default: `{ mode: "none" }`). */
  readonly verify?: AddonHostVerifyOptions;
}

const ADDON_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set([
  "peer.send",
  "peer.receive",
  "peer.send.bin",
  "peer.receive.bin",
  "storage.local.read",
  "storage.local.write",
  "file.read.user_selected",
  "file.write.user_approved",
  "ui.panel",
  "ui.overlay",
  "presence.read",
  "audio.level",
  // ADR-0015 (design only). The runtime accepts these in the manifest now;
  // bridge ops for media.send.* / media.receive.* land in follow-up PRs.
  "media.send.audio",
  "media.send.video",
  "media.receive.audio",
  "media.receive.video",
]);

// Per-message cap for add-on binary payloads. PeerSession chunks the
// body into ≤ 60 KiB per-frame slices on the wire (ADR-0012); the
// add-on sees a single logical send-bin / deliver-bin.
const ADDON_BIN_MAX_BYTES = 4 * 1024 * 1024;

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AddonValidationError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function validateManifest(value: unknown): AddonManifest {
  const obj = asObject(value, "manifest");
  if (typeof obj.id !== "string" || !ADDON_ID_PATTERN.test(obj.id))
    throw new AddonValidationError("id must match reverse-DNS");
  if (typeof obj.name !== "string" || obj.name.length === 0)
    throw new AddonValidationError("name must be non-empty string");
  if (typeof obj.version !== "string" || !SEMVER_PATTERN.test(obj.version))
    throw new AddonValidationError("version must be SemVer");
  if (typeof obj.entry !== "string" || obj.entry.length === 0)
    throw new AddonValidationError("entry must be non-empty string");
  if (typeof obj.license !== "string" || obj.license.length === 0)
    throw new AddonValidationError("license must be non-empty string");
  if (obj.network !== false) throw new AddonValidationError("network must be false");
  if (!Array.isArray(obj.permissions)) throw new AddonValidationError("permissions must be array");
  for (const perm of obj.permissions) {
    if (typeof perm !== "string" || !KNOWN_PERMISSIONS.has(perm)) {
      throw new AddonValidationError(`unknown permission: ${String(perm)}`);
    }
  }
  if (!Array.isArray(obj.capabilities) || obj.capabilities.length === 0)
    throw new AddonValidationError("capabilities must be non-empty array");

  return {
    id: obj.id,
    name: obj.name,
    version: obj.version,
    entry: obj.entry,
    license: obj.license,
    network: false,
    permissions: [...(obj.permissions as string[])],
    capabilities: [...(obj.capabilities as string[])],
  };
}

function isBridgeMessage(value: unknown): value is AddonBridgeMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown; op?: unknown };
  if (v.kind !== ADDON_BRIDGE_KIND) return false;
  return typeof v.op === "string";
}

let counter = 0;
function newEnvelopeId(): string {
  counter = (counter + 1) % 0xffffff;
  return `addon_${Date.now().toString(36)}_${counter.toString(36)}`;
}

type Listener<T> = (value: T) => void;

export class AddonHost {
  readonly manifest: AddonManifest;
  readonly manifestUrl: URL;
  readonly entryUrl: URL;
  readonly sessionId: string;

  private readonly container: HTMLElement;
  private readonly session: AddonPeerLink | null;
  private readonly storage: AddonStorage | null;
  private iframe: HTMLIFrameElement | null = null;
  private currentState: AddonHostState = "created";
  private detachPeer: (() => void) | null = null;
  private audioLevelSubscribed = false;
  private readonly listeners: {
    [K in keyof AddonHostEvents]: Set<Listener<AddonHostEvents[K]>>;
  } = { state: new Set(), send: new Set(), error: new Set() };
  private readonly windowMessageHandler: (ev: MessageEvent) => void;

  private constructor(opts: AddonHostOptions, manifest: AddonManifest, manifestUrl: URL) {
    this.manifest = manifest;
    this.manifestUrl = manifestUrl;
    this.entryUrl = new URL(manifest.entry, manifestUrl);
    this.container = opts.container;
    this.session = opts.session ?? null;
    this.storage = opts.storage ? createAddonStorage(manifest.id, opts.storage) : null;
    this.sessionId = newEnvelopeId();
    this.windowMessageHandler = (ev) => this.handleWindowMessage(ev);
  }

  static async load(opts: AddonHostOptions): Promise<AddonHost> {
    const fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
    const manifestUrl = new URL(
      opts.manifestUrl,
      globalThis.location?.href ?? "http://senn.invalid/",
    );

    // 1. Fetch the manifest as raw bytes. We MUST verify the bytes
    //    before parsing them as JSON.
    const res = await fetcher(manifestUrl);
    if (!res.ok) {
      throw new AddonValidationError(`fetch ${manifestUrl} returned ${res.status}`);
    }
    const manifestBytes = new Uint8Array(await res.arrayBuffer());

    // 2. If verification is requested, fetch and check the signature
    //    BEFORE deserialising the manifest body.
    const verify = opts.verify ?? { mode: "none" };
    if (verify.mode !== "none") {
      if (!verify.trustedKeys || verify.trustedKeys.size === 0) {
        throw new AddonValidationError(
          "verify.trustedKeys is required when verify.mode is not 'none'",
        );
      }
      const sigUrl = new URL("manifest.sig.json", manifestUrl);
      const sigRes = await fetcher(sigUrl);
      if (sigRes.status === 404) {
        if (verify.mode === "required") {
          throw new AddonValidationError(`required signature missing: ${sigUrl}`);
        }
        // optional + absent → accept the unsigned manifest
      } else if (!sigRes.ok) {
        throw new AddonValidationError(`fetch ${sigUrl} returned ${sigRes.status}`);
      } else {
        let sigPayload: ManifestSignatureV1;
        try {
          sigPayload = validateSignaturePayload(await sigRes.json());
        } catch (err) {
          throw new AddonValidationError(`signature payload invalid: ${(err as Error).message}`);
        }
        const result = await verifyManifest({
          manifestBytes,
          signature: sigPayload,
          trustedKeys: verify.trustedKeys,
        });
        if (!result.ok) {
          throw new AddonValidationError(
            `signature verification failed: ${result.reason ?? "unknown"}`,
          );
        }
      }
    }

    // 3. Only after verification, parse + validate the manifest schema.
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch (err) {
      throw new AddonValidationError(`manifest is not valid JSON: ${(err as Error).message}`);
    }
    const manifest = validateManifest(parsed);
    const host = new AddonHost(opts, manifest, manifestUrl);
    host.mount();
    if (host.session) host.bindToSession(host.session);
    return host;
  }

  get state(): AddonHostState {
    return this.currentState;
  }

  on<K extends keyof AddonHostEvents>(event: K, handler: Listener<AddonHostEvents[K]>): () => void {
    this.listeners[event].add(handler);
    return () => {
      this.listeners[event].delete(handler);
    };
  }

  /** Push a payload to the add-on. Requires the add-on to declare `peer.receive`. */
  async deliver(payload: unknown, from?: string): Promise<void> {
    if (this.currentState !== "active") {
      throw new Error(`AddonHost.deliver() called in state ${this.currentState}`);
    }
    if (!this.manifest.permissions.includes("peer.receive")) {
      throw new Error("addon manifest does not declare peer.receive");
    }
    this.postToIframe(
      from === undefined
        ? { kind: ADDON_BRIDGE_KIND, op: "deliver", payload }
        : { kind: ADDON_BRIDGE_KIND, op: "deliver", payload, from },
    );
  }

  /** Push binary bytes to the add-on. Requires `peer.receive.bin`. */
  async deliverBinary(mime: string, bytes: Uint8Array, from?: string): Promise<void> {
    if (this.currentState !== "active") {
      throw new Error(`AddonHost.deliverBinary() called in state ${this.currentState}`);
    }
    if (!this.manifest.permissions.includes("peer.receive.bin")) {
      throw new Error("addon manifest does not declare peer.receive.bin");
    }
    this.postToIframe(
      from === undefined
        ? { kind: ADDON_BRIDGE_KIND, op: "deliver-bin", mime, bytes }
        : { kind: ADDON_BRIDGE_KIND, op: "deliver-bin", mime, bytes, from },
    );
  }

  async close(): Promise<void> {
    if (this.currentState === "closed") return;
    this.setState("closed");
    globalThis.removeEventListener?.("message", this.windowMessageHandler);
    this.detachPeer?.();
    this.detachPeer = null;
    this.audioLevelSubscribed = false;
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private mount(): void {
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    // Browsers gate Blob URL downloads in sandboxed iframes behind
    // `allow-downloads`. Grant it only when the manifest declares
    // file.write.user_approved (per docs/addon-file-transfer-spec.md).
    if (this.manifest.permissions.includes("file.write.user_approved")) {
      iframe.sandbox.add("allow-downloads");
    }
    iframe.referrerPolicy = "no-referrer";
    iframe.title = `SENN add-on: ${this.manifest.name}`;
    iframe.src = this.entryUrl.toString();
    iframe.addEventListener("load", () => this.onIframeLoad(), { once: true });
    this.container.appendChild(iframe);
    this.iframe = iframe;
    this.setState("mounted");
    globalThis.addEventListener("message", this.windowMessageHandler);
  }

  private onIframeLoad(): void {
    if (this.currentState !== "mounted") return;
    this.setState("initialized");
    this.postToIframe({
      kind: ADDON_BRIDGE_KIND,
      op: "init",
      addonId: this.manifest.id,
      version: this.manifest.version,
      sessionId: this.sessionId,
    });
  }

  private ensureInitPosted(): void {
    // If "ready" arrived before the iframe's load event, we still want to
    // deliver init; otherwise the add-on never sees its own id/version.
    if (this.currentState === "mounted") {
      this.setState("initialized");
      this.postToIframe({
        kind: ADDON_BRIDGE_KIND,
        op: "init",
        addonId: this.manifest.id,
        version: this.manifest.version,
        sessionId: this.sessionId,
      });
    }
  }

  private postToIframe(message: AddonBridgeMessage): void {
    const target = this.iframe?.contentWindow;
    if (!target) return;
    // Sandboxed iframe has an opaque origin, so "*" is required and acceptable
    // here — the iframe is the only window the host is talking to from this
    // contentWindow reference, and the add-on never trusts inbound messages
    // either (it relies on the bridge protocol shape).
    target.postMessage(message, "*");
  }

  private handleWindowMessage(ev: MessageEvent): void {
    if (!this.iframe || ev.source !== this.iframe.contentWindow) return;
    if (!isBridgeMessage(ev.data)) return;
    const msg = ev.data;
    switch (msg.op) {
      case "ready":
        // ready may arrive before or after the iframe's load event; ensure
        // init is posted regardless, then transition to active.
        this.ensureInitPosted();
        if (this.currentState === "initialized") this.setState("active");
        return;
      case "send":
        this.handleSend(msg.payload);
        return;
      case "send-bin":
        this.handleSendBin(msg.mime, msg.bytes);
        return;
      case "audio.level.subscribe":
        this.handleAudioLevelSubscribe();
        return;
      case "audio.level.unsubscribe":
        this.audioLevelSubscribed = false;
        return;
      case "error":
        this.emit("error", new Error(`addon: ${msg.message}`));
        return;
      case "storage":
        void this.handleStorage(msg);
        return;
      default:
        // init / deliver / storage.result are host → iframe ops; ignore if echoed back.
        return;
    }
  }

  private storageReply(rid: string, value: unknown): void {
    this.postToIframe({ kind: ADDON_BRIDGE_KIND, op: "storage.result", rid, ok: true, value });
  }

  private storageError(rid: string, error: string): void {
    this.postToIframe({ kind: ADDON_BRIDGE_KIND, op: "storage.result", rid, ok: false, error });
  }

  private async handleStorage(msg: Extract<AddonBridgeMessage, { op: "storage" }>): Promise<void> {
    const { rid, storage: subOp, key, value } = msg;
    if (typeof rid !== "string" || rid.length === 0) return;
    if (this.currentState === "closed") {
      this.storageError(rid, "closed");
      return;
    }
    if (!this.storage) {
      this.storageError(rid, "permission-denied");
      return;
    }
    const needsRead = subOp === "get" || subOp === "list";
    const needsWrite = subOp === "put" || subOp === "delete" || subOp === "clear";
    if (needsRead && !this.manifest.permissions.includes("storage.local.read")) {
      this.storageError(rid, "permission-denied");
      return;
    }
    if (needsWrite && !this.manifest.permissions.includes("storage.local.write")) {
      this.storageError(rid, "permission-denied");
      return;
    }
    try {
      switch (subOp) {
        case "get": {
          if (typeof key !== "string") {
            this.storageError(rid, "invalid-request");
            return;
          }
          const got = await this.storage.get(key);
          this.storageReply(rid, got);
          return;
        }
        case "put": {
          if (typeof key !== "string") {
            this.storageError(rid, "invalid-request");
            return;
          }
          await this.storage.put(key, value);
          this.storageReply(rid, null);
          return;
        }
        case "delete": {
          if (typeof key !== "string") {
            this.storageError(rid, "invalid-request");
            return;
          }
          await this.storage.delete(key);
          this.storageReply(rid, null);
          return;
        }
        case "list": {
          const keys = await this.storage.list();
          this.storageReply(rid, keys);
          return;
        }
        case "clear": {
          await this.storage.clear();
          this.storageReply(rid, null);
          return;
        }
        default:
          this.storageError(rid, "invalid-request");
      }
    } catch (err) {
      if (err instanceof StorageError) {
        this.storageError(rid, err.code);
      } else {
        this.storageError(rid, "invalid-request");
        this.emit("error", err as Error);
      }
    }
  }

  private handleSend(payload: unknown): void {
    if (!this.manifest.permissions.includes("peer.send")) {
      this.emit("error", new Error("addon attempted send without peer.send permission"));
      return;
    }
    this.emit("send", payload);
    if (this.session) {
      const envelope: AddonMessageEnvelope = {
        id: newEnvelopeId(),
        kind: "addon.message",
        addon: this.manifest.id,
        version: this.manifest.version,
        createdAt: Date.now(),
        payload,
      };
      // Validate before serialization just to catch shape drift early.
      validateAddonEnvelope(envelope);
      void this.session.sendText(JSON.stringify(envelope)).catch((err) => {
        this.emit("error", err as Error);
      });
    }
  }

  private handleAudioLevelSubscribe(): void {
    if (!this.manifest.permissions.includes("audio.level")) {
      this.postToIframe({
        kind: ADDON_BRIDGE_KIND,
        op: "error",
        code: "permission-denied",
        message: "addon attempted audio.level.subscribe without audio.level permission",
      });
      return;
    }
    this.audioLevelSubscribed = true;
  }

  /**
   * Push a microphone-derived audio level into the add-on. Per
   * docs/addon-audio-level-spec.md the level is clamped to [0,1] and only
   * delivered while the add-on has an active subscription. The host owns
   * the actual MediaStream; the add-on never sees raw audio.
   */
  publishAudioLevel(level: number): void {
    if (!this.audioLevelSubscribed) return;
    if (this.currentState !== "active") return;
    if (!Number.isFinite(level)) return;
    const clamped = level < 0 ? 0 : level > 1 ? 1 : level;
    this.postToIframe({ kind: ADDON_BRIDGE_KIND, op: "audio.level", level: clamped });
  }

  /** True iff the add-on currently has an active audio.level subscription. */
  get isSubscribedToAudioLevel(): boolean {
    return this.audioLevelSubscribed;
  }

  private handleSendBin(mime: unknown, bytes: unknown): void {
    if (!this.manifest.permissions.includes("peer.send.bin")) {
      this.postToIframe({
        kind: ADDON_BRIDGE_KIND,
        op: "error",
        code: "permission-denied",
        message: "addon attempted send-bin without peer.send.bin permission",
      });
      return;
    }
    if (typeof mime !== "string" || !(bytes instanceof Uint8Array)) {
      this.postToIframe({
        kind: ADDON_BRIDGE_KIND,
        op: "error",
        code: "bad-payload",
        message: "send-bin: mime must be string and bytes must be Uint8Array",
      });
      return;
    }
    if (bytes.byteLength > ADDON_BIN_MAX_BYTES) {
      this.postToIframe({
        kind: ADDON_BRIDGE_KIND,
        op: "error",
        code: "payload-too-large",
        message: `send-bin: ${bytes.byteLength}B exceeds ${ADDON_BIN_MAX_BYTES}B`,
      });
      return;
    }
    if (!this.session) {
      this.postToIframe({
        kind: ADDON_BRIDGE_KIND,
        op: "error",
        code: "not-connected",
        message: "send-bin: no peer link",
      });
      return;
    }
    void this.session.sendBinary({ addon: this.manifest.id, mime, bytes }).catch((err: Error) => {
      this.postToIframe({
        kind: ADDON_BRIDGE_KIND,
        op: "error",
        code: "not-connected",
        message: err.message,
      });
    });
  }

  private bindToSession(session: AddonPeerLink): void {
    const offText = session.on("text", (json) => {
      const envelope = tryParseAddonEnvelope(json);
      if (!envelope) return;
      if (envelope.addon !== this.manifest.id) return;
      void this.deliver(envelope.payload, envelope.addon).catch((err) => {
        this.emit("error", err as Error);
      });
    });
    const offBin = session.on("binary", (msg) => {
      if (msg.addon !== this.manifest.id) return;
      if (!this.manifest.permissions.includes("peer.receive.bin")) return;
      void this.deliverBinary(msg.mime, msg.bytes, msg.addon).catch((err) => {
        this.emit("error", err as Error);
      });
    });
    this.detachPeer = () => {
      offText();
      offBin();
    };
  }

  private setState(next: AddonHostState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    this.emit("state", next);
  }

  private emit<K extends keyof AddonHostEvents>(event: K, value: AddonHostEvents[K]): void {
    for (const handler of this.listeners[event]) {
      try {
        handler(value);
      } catch (err) {
        console.error("senn: addon-host listener threw", err);
      }
    }
  }
}
