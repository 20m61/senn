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
2. The Core add-on API, accessed via `postMessage` to `window.parent`. The
   `@senn/addon-sdk` package wraps this bridge. Use it.

```ts
// addon.ts (compiled or shipped as an ES module)
import { createAddon } from "@senn/addon-sdk";

const addon = await createAddon({
  id: "com.example.note",
  version: "0.1.0",
});

addon.peer.on("note-v1", (msg) => {
  // handle a peer-sent envelope tagged with the "note-v1" capability
});

await addon.peer.send({
  type: "stroke",
  payload: { x: 12, y: 34 },
});

await addon.storage.put("draft", { title: "untitled" });
const draft = await addon.storage.get("draft");
```

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

## Conformance commands (MUST run before declaring done)

```sh
pnpm tsx scripts/validate-addon-manifest.ts <path-to-your manifest.json>
# Once available:
pnpm tsx scripts/build-addon.ts <addon-dir>
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
