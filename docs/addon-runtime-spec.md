# Add-on Runtime Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Intent

Define the runtime contract between SENN Core (host) and a static add-on
running inside a sandboxed iframe. This page is normative.

The runtime is the only place where add-on data crosses the trust
boundary into Core, so every cross-boundary message MUST be validated
and permission-checked here.

## Normative checklist

- When the host's verify mode is `optional` or `required`
  ([ADR-0008](adr/0008-manifest-signing.md) §6;
  [addon-signing-spec.md](addon-signing-spec.md)), the host MUST run
  detached signature verification against `manifest.sig.json` **before**
  the schema validation step below and **before** mounting the iframe.
  In `required` mode, a missing or invalid signature MUST abort the
  load. In `optional` mode, a missing signature MUST proceed but the
  host SHOULD surface a UI badge; an *invalid* signature (well-formed
  `manifest.sig.json` whose signature does not verify against any
  registry-pinned key) MUST abort the load.
- The host MUST validate the manifest (per [addon-manifest.md](addon-manifest.md))
  before mounting the iframe. A failed manifest MUST abort the load.
- The iframe MUST be created with `sandbox="allow-scripts"` and no other
  flags. `allow-same-origin` MUST NOT be added.
- The host MUST set `referrerpolicy="no-referrer"` on the iframe.
- The host MUST set `iframe.src` to the manifest's `entry` resolved
  against the manifest base URL. The src MUST be same-origin with the
  manifest URL.
- The host MUST NOT inject scripts into the add-on. Communication is
  via `postMessage` only.
- The host MUST treat all messages from the iframe as untrusted input
  and validate them against the bridge protocol below.
- The host MUST enforce the manifest's `permissions` set for every
  bridge operation that requires one.
- The host MUST silently ignore messages with a wrong `kind` or `op`,
  but MUST log validation failures (without payload contents) to its
  diagnostics channel.
- The host MUST refuse to forward bridge `send` operations from an
  add-on that lacks the corresponding permission.
- The host MUST NOT log payload bodies — they are user data.
- `close()` on the host MUST detach event listeners, remove the iframe,
  and reject any subsequent bridge call.

## Bridge protocol

All host ↔ iframe messages are JSON objects whose `kind` is
`"senn.addon.v1"`. The core text-message ops are defined here; binary,
storage, and media ops extend the same envelope and are normatively
defined in their sibling specs (see *Bridge extensions* below).

```ts
type AddonBridgeMessage =
  | { kind: "senn.addon.v1"; op: "init";    addonId: string; version: string; sessionId: string }
  | { kind: "senn.addon.v1"; op: "ready" }
  | { kind: "senn.addon.v1"; op: "send";    payload: unknown }
  | { kind: "senn.addon.v1"; op: "deliver"; payload: unknown; from?: string }
  | { kind: "senn.addon.v1"; op: "error";   message: string };
```

- `init` is sent by the host to the iframe immediately after the
  iframe's `load` event. The add-on MUST NOT act on bridge ops before
  receiving `init`.
- `ready` is sent by the iframe to the host after it has finished
  setup. The host MUST NOT call `deliver` before receiving `ready`.
- `send` is the iframe asking the host to forward `payload` to peers.
  The host MUST permission-check (`peer.send`) and MUST NOT forward an
  unknown shape.
- `deliver` is the host pushing a payload to the iframe (originating
  either from a peer or from a local source). Requires `peer.receive`
  on the add-on side.
- `error` is the iframe reporting a non-fatal error to the host.

### Bridge extensions

The `kind: "senn.addon.v1"` envelope is shared across multiple normative
op groups. A conformant host implementation MUST honour all groups whose
permissions appear in the loaded add-on's manifest. Unknown ops MUST be
dropped per the *Normative checklist*.

| Group | Ops | Permission gate | Normative spec |
|-------|-----|-----------------|----------------|
| Text peer | `send`, `deliver`, `error` | `peer.send`, `peer.receive` | this spec |
| Binary peer | `send-bin`, `deliver-bin` | `peer.send.bin`, `peer.receive.bin` | [addon-binary-transfer-spec.md](addon-binary-transfer-spec.md) |
| Storage | `storage.local.read`, `storage.local.write` and their replies | `storage.local.read`, `storage.local.write` | [addon-storage-spec.md](addon-storage-spec.md) |
| Media | `media.send.{audio,video}.{start,stop}`, `media.receive.{audio,video}.subscribe`, `media.receive.unsubscribe`, `media.element.create`, `media.element.created`, `media.track`, `media.level` | `media.send.{audio,video}`, `media.receive.{audio,video}` | [addon-media-spec.md](addon-media-spec.md) |
| Audio level | `audio.level` | `audio.level` | [addon-audio-level-spec.md](addon-audio-level-spec.md) |

The `error` op is shared across all groups. Each sibling spec defines
the additional `code` values its group MAY surface; a host MUST NOT
emit a code outside the union of values defined across the siblings
loaded for the add-on.

## Wire envelope (peer → peer)

When `send` is permitted, the host wraps the payload into the existing
add-on envelope from [core-spec.md](core-spec.md):

```ts
type AddonMessageEnvelope = {
  id: string;            // ULID
  kind: "addon.message";
  addon: string;         // add-on id
  version: string;       // add-on version
  createdAt: number;     // ms since epoch
  payload: unknown;
};
```

The envelope is JSON-encoded and emitted on the peer's `core.text`
channel via `PeerSession.sendText`. Receivers MUST validate the envelope
and route it to the matching add-on instance.

## Lifecycle

```
created ── load() ──▶ mounted ── iframe load event ──▶ initialized
                                                      │
                                                      ▼ "ready" from iframe
                                                    active
                                                      │
                                                      ▼ close()
                                                    closed
```

- `created` → `mounted`: manifest validated, iframe injected into the
  container.
- `mounted` → `initialized`: iframe `load` event fired, host posts `init`.
- `initialized` → `active`: iframe responded with `ready`. Host MAY
  call `deliver` from this point.
- Any state → `closed`: idempotent. Host detaches listeners, removes
  iframe, rejects further calls.

## Positive example (informative)

```ts
import { AddonHost } from "@senn/addon-runtime";

const host = await AddonHost.load({
  manifestUrl: "/addons/echo/manifest.json",
  container: document.querySelector("#addon-mount")!,
  session,                // PeerSession instance, optional
});

host.on("send", (msg) => console.log("addon asked to send", msg));
await host.deliver({ from: "peer-x", message: "hello" });
await host.close();
```

## Negative example

A host implementation that:

- Sets `iframe.sandbox = "allow-scripts allow-same-origin"` — **rejected**.
- Forwards `op: "send"` without checking `manifest.permissions` — **rejected**.
- Logs `payload` contents — **rejected**.
- Mounts before `validateManifestFile()` resolves — **rejected**.
- In `required` verify mode, mounts an iframe whose `manifest.sig.json`
  is missing or fails verification — **rejected** (ADR-0008 §6).
- Runs schema validation before signature verification when verify
  mode is `optional` or `required` — **rejected**; signature
  verification is the first gate.

## Conformance

```sh
pnpm --filter @senn/web e2e
```

The e2e drives two browser contexts: each loads the same echo add-on,
the inviter's add-on emits a payload, the joiner's add-on echoes it
back, and the inviter's add-on receives the echo. The test asserts the
add-on iframe never reaches `localStorage`, never opens `fetch`, and
that the host rejects `send` calls when the manifest does not declare
`peer.send`.

## Cross-references

- [addon-spec.md](addon-spec.md) — what an add-on may do.
- [addon-manifest.md](addon-manifest.md) — manifest schema (the source of permissions).
- [addon-signing-spec.md](addon-signing-spec.md) — detached `manifest.sig.json` wire format.
- [ADR-0008](adr/0008-manifest-signing.md) — manifest signing and the three host-selectable verify modes.
- [security-model.md](security-model.md) — trust boundaries.
- [peer-session-spec.md](peer-session-spec.md) — `core.text` carries the envelope; `core.bin` carries `send-bin`/`deliver-bin`.
- [addon-binary-transfer-spec.md](addon-binary-transfer-spec.md) — binary peer ops.
- [addon-storage-spec.md](addon-storage-spec.md) — storage ops.
- [addon-media-spec.md](addon-media-spec.md) — cross-peer media ops.
- [addon-audio-level-spec.md](addon-audio-level-spec.md) — host-derived audio level ops.
