# Writing an Add-on

## Intent

Build a SENN-conformant add-on. Conformance means: the add-on runs in a
sandboxed iframe, never opens its own network connection, talks to peers
only via the Core add-on API, and declares exactly the permissions it uses.

This page is normative. Use the [addon-cookbook.md](addon-cookbook.md) for
ready-to-adapt patterns and [ai-driven-addon-development.md](ai-driven-addon-development.md)
when an AI agent will generate the add-on.

## Add-on package layout (MUST)

```
your-addon/
  manifest.json       # required — see /docs/addon-manifest.md
  index.html          # required — entry document loaded in the sandboxed iframe
  addon.js            # required — bridge + add-on logic
  style.css           # optional
  assets/             # optional — images, fonts, audio
```

All paths in `manifest.json` MUST resolve inside the package. No external
URLs are allowed at runtime (CSP `connect-src 'none'`).

## Manifest (MUST)

Use the schema in [/docs/addon-manifest.md](../addon-manifest.md). Minimum
required fields: `id`, `name`, `version`, `entry`, `license`, `network`,
`permissions`, `capabilities`.

Positive example:

```json
{
  "id": "com.example.note",
  "name": "Note",
  "version": "0.1.0",
  "description": "A shared note. Strokes are P2P. Saving is local-first.",
  "entry": "index.html",
  "license": "Apache-2.0",
  "author": "Example",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "storage.local.write", "ui.panel"],
  "capabilities": ["note-v1"]
}
```

Negative example (and reasons SENN Core will reject it):

```json
{
  "id": "Note",
  "name": "Note",
  "version": "0.1",
  "entry": "https://example.com/index.html",
  "license": "Proprietary",
  "network": true,
  "permissions": ["peer.send", "fetch"],
  "capabilities": []
}
```

- `id` MUST be reverse-DNS, not a bare word.
- `version` MUST be SemVer 2.0.0 (`0.1.0`, not `0.1`).
- `entry` MUST be a relative path inside the package.
- `license` MUST be on the allow list ([/docs/license-policy.md](../license-policy.md)).
- `network` MUST be `false` in the current spec.
- `permissions` MUST contain only known strings; `fetch` is not a SENN permission.
- `capabilities` MUST contain at least one tag.

## Allowed runtime APIs (MUST limit yourself to these)

Inside the sandboxed iframe the add-on uses two surfaces:

1. Browser standards available under the iframe's CSP. `connect-src 'none'`
   prohibits all network requests; `script-src 'self'` prohibits inline JS
   and remote modules.
2. The Core add-on bridge, accessed via `postMessage` to `window.parent`.
   The `@senn/addon-sdk` runtime ships a classic script that exposes a
   single `window.senn` global; the add-on loads it before its own code.

`addon-sdk-spec.md` is the normative shape of `window.senn`. Minimum
useful surface:

```js
// addon.js — classic script, loaded after senn-addon-sdk.js
senn.on("deliver", ({ payload, from }) => {
  // handle a peer-sent payload (the host has already filtered to
  // envelopes whose `addon` field equals our manifest id)
});

senn.peer.send({ type: "stroke", payload: { x: 12, y: 34 } });

await senn.storage.put("draft", { title: "untitled" });
const draft = await senn.storage.get("draft");

const ctx = await senn.ready(); // ctx = { addonId, version, sessionId }
```

Larger surface (each gated by the matching `permissions` entry):

| Bridge | SDK call | Manifest permission |
|---|---|---|
| Receive binary blobs from a peer | `senn.on("deliver-bin", ({ mime, bytes }) => …)` | `peer.receive.bin` |
| Send binary blobs to a peer | `senn.peer.sendBinary({ mime, bytes })` (≤ 4 MiB chunked) | `peer.send.bin` |
| Microphone-derived energy values, no raw audio | `senn.audio.subscribeLevel(level => …)` | `audio.level` |
| Ask the host to attach the local mic / camera to the peer connection (ADR-0015) | `senn.media.startLocalAudio()` / `startLocalVideo({ source })` / `stop*()` | `media.send.audio`, `media.send.video` |
| Receive a remote track event when the peer publishes one | `senn.media.onTrack(({ direction, track, state }) => …)` plus `senn.media.subscribeRemoteAudio()` / `subscribeRemoteVideo()` | `media.receive.audio`, `media.receive.video` |

The add-on never sees a raw `MediaStreamTrack`. ADR-0015 is explicit
that the host owns `getUserMedia` and the host-controlled `<audio>` /
`<video>` element; the add-on only orchestrates start / stop / subscribe.

## TypeScript types (RECOMMENDED)

If you author your add-on in TypeScript, depend on `@senn/addon-sdk`
and let its declarations augment `Window.senn` for you. ADR-0018
documents the package shape.

```ts
// addon.ts — compiled to addon.js, loaded after senn-addon-sdk.js
/// <reference types="@senn/addon-sdk" />

const ctx = await window.senn!.ready();
window.senn!.peer.send({ kind: "hello", from: ctx.addonId });
```

A single `/// <reference types="@senn/addon-sdk" />` directive — or any
`import` from the package — activates the ambient
`Window.senn?: SennAddonGlobal` declaration. The exported interfaces
(`SennAddonContext`, `SennDeliverEvent`, `SennAddonStorage`, …) are
also available for your own helper signatures:

```ts
import type { SennDeliverEvent, SennAddonContext } from "@senn/addon-sdk";

function onPeerMessage(ev: SennDeliverEvent) { /* … */ }
function onReady(ctx: SennAddonContext) { /* … */ }
```

The package also exports the runtime classic-script path so build
scripts can copy it next to your `addon.js`:

```js
// build.mjs (Node)
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

copyFileSync(
  require.resolve("@senn/addon-sdk/runtime/senn-addon-sdk.js"),
  "dist/senn-addon-sdk.js",
);
```

Add-on `index.html` then loads it as a classic script:

```html
<script src="senn-addon-sdk.js"></script>
<script src="addon.js"></script>
```

`@senn/addon-sdk` is currently a workspace package (not yet published to
npm); inside this repo you depend on it via `"@senn/addon-sdk":
"workspace:*"`. A future ADR will own the public publish flow.

## Forbidden APIs (MUST NOT call)

| Disallowed | Why | Use instead |
|------------|-----|-------------|
| `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` | Add-ons MUST NOT open their own network. Default CSP blocks them anyway. | Core peer API only. |
| `RTCPeerConnection`, `RTCDataChannel`, `MediaStream` constructors | The transport belongs to Core. | `addon.peer.send` / `addon.peer.on`. |
| `localStorage`, `sessionStorage`, raw `indexedDB.open` | Storage is namespaced and gated by Core. | `addon.storage.*` / `addon.files.*`. |
| `window.open`, `<a target="_top">` to external origins | Breaks sandbox / spoofs Core UI. | `addon.ui.openLink` (planned) or omit. |
| Direct DOM access to the host page | The iframe boundary is a security boundary. | Bridge messages only. |
| Any third-party script tag at runtime | CSP rejects it. | Inline only what the manifest ships. |

## Permissions discipline (MUST)

- Declare only permissions you actually use.
- Each permission MUST be justified in your README. The SDD reviewer agent
  will strip unused permissions.
- `peer.send` and `peer.receive` are independent — request only what you use.
- `storage.local.write` implies `storage.local.read` only if you also need
  to read; declare both explicitly.

## Distribution and trust (MUST review before publishing)

- Sign the manifest. ADR-0008 / ADR-0009 / ADR-0010 cover the Ed25519
  detached signature, the keystore minimum, and key rotation. The host
  app's `verify` mode (`required` / `optional` / `none`) determines
  which loads even succeed; see `getting-started-addon.md` for the
  publish flow.
- A SENN gallery (ADR-0016) hands the user off to a SENN host with
  `?addon=<manifestUrl>&publisher=<registryUrl>`. The host MUST
  display the publisher's name + trustedKeys before loading. As an
  add-on author you only ship `manifest.json` + `manifest.sig.json`
  + your assets; the registry is the publisher's responsibility.

## Conformance commands (MUST run before declaring done)

```sh
pnpm validate:addon <path-to-your-manifest.json>   # tsx scripts/validate-addon-manifest.ts
pnpm check:addon-forbidden                          # forbidden-API grep over registry dirs
pnpm sign:manifest <addon-dir> --key keys/your.key.json
pnpm verify:manifest <addon-dir> --trusted-key <publicKey>
```

Manual checklist:

- [ ] Manifest validates.
- [ ] No `fetch`, `WebSocket`, or other forbidden APIs in your sources
      (`grep -RInE "fetch\(|WebSocket|RTCPeerConnection" your-addon/` returns
      no add-on-owned hits).
- [ ] All permissions in the manifest are actually used in code.
- [ ] CSP `connect-src 'none'` is not relaxed.
- [ ] `iframe sandbox="allow-scripts"` (no `allow-same-origin` unless the
      add-on README justifies it and the SDD agent has signed off).
- [ ] `manifest.json` size ≤ 16 KiB.

## Negative example (whole add-on)

Do **not** ship an add-on that calls `fetch("https://api.example.com/sync")`
to "back up" peer data. SENN Core revokes the load on principle: this would
violate the charter (no server custody of dynamic data) and the manifest
contract (`network: false`). If cross-device continuity is required, design
it as an explicit user-controlled local export/import flow, or as an
opt-in P2P sync handshake — not a silent server upload.
