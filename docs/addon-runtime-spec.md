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

All host ↔ iframe messages are JSON objects with this shape:

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
- [security-model.md](security-model.md) — trust boundaries.
- [peer-session-spec.md](peer-session-spec.md) — `core.text` carries the envelope.
