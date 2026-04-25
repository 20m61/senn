# Getting started — write a SENN add-on

This walkthrough builds a third-party SENN add-on from scratch and
takes it through the same conformance gates the official add-ons go
through. End-to-end it is ~30 lines of JavaScript and a small
`manifest.json`.

> **Who this is for:** anyone who wants to ship a SENN experience
> without touching Core. SENN's
> [Charter](../charter.md) Principle 9 says you should be able to
> build and distribute add-ons as a third party — this is the
> shortest path.

## Prerequisites

- A clone of <https://github.com/20m61/senn> at the version you are
  targeting (this guide assumes the current `develop`).
- Node ≥ 22, pnpm ≥ 9. `pnpm install` in the repo root.
- A static host of your own: any server that can serve
  `manifest.json` + `index.html` + `addon.js` over HTTPS will do.

You do **not** need an account, an API key, or anything from the
SENN project to publish. Everything below is offline-first.

## 1. Lay out the addon directory

```
my-addon/
├── manifest.json
├── index.html
├── addon.js
└── senn-addon-sdk.js   ← copied from packages/addon-sdk/runtime/
```

The SDK runtime is a hand-written classic script. Copy the canonical
file into your addon directory so it is served from the same opaque
origin as the addon iframe (CSP `default-src 'self'` blocks loading
it from anywhere else).

```sh
cp packages/addon-sdk/runtime/senn-addon-sdk.js my-addon/
```

## 2. Write `manifest.json`

The full schema is in [`addon-manifest.md`](../addon-manifest.md);
the [`addon-spec.md`](../addon-spec.md) lists every permission
string. A minimal manifest:

```json
{
  "id": "com.example.timer",
  "name": "Timer",
  "version": "0.1.0",
  "description": "Countdown timer that broadcasts ticks to the connected peer.",
  "entry": "index.html",
  "license": "MIT",
  "author": "Your Name",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "ui.panel"],
  "capabilities": ["timer-v1"]
}
```

Two non-negotiable points:

- `network` MUST be `false`. SENN add-ons cannot make their own
  network calls; everything you need crosses the bridge to Core.
- `id` MUST match the reverse-DNS pattern (the validator gives
  precise diagnostics — see step 5).

## 3. Write `index.html` and `addon.js`

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'none'; frame-ancestors 'self'"
    />
    <title>Timer add-on</title>
  </head>
  <body>
    <main>
      <p>state: <span id="state">booting</span></p>
      <p>peer ticks: <span id="count">0</span></p>
      <button id="start" type="button">start 10-second countdown</button>
    </main>
    <script src="senn-addon-sdk.js"></script>
    <script src="addon.js"></script>
  </body>
</html>
```

`addon.js`:

```js
const stateEl = document.getElementById("state");
const countEl = document.getElementById("count");
const start = document.getElementById("start");

let count = 0;

senn.on("deliver", ({ payload }) => {
  if (payload && payload.type === "tick") {
    count++;
    countEl.textContent = String(count);
  }
});

start.addEventListener("click", () => {
  let n = 10;
  const id = setInterval(() => {
    senn.peer.send({ type: "tick", remaining: n });
    n--;
    if (n < 0) clearInterval(id);
  }, 1000);
});

senn.ready().then((ctx) => {
  stateEl.textContent = `init (${ctx.addonId} v${ctx.version})`;
});
```

That's the entire bridge surface you need for a peer-to-peer add-on.
Storage, binary transfer, and microphone level are also one call
away (`senn.storage.put / get`, `senn.peer.sendBinary`,
`senn.audio.subscribeLevel`) — see
[`addon-sdk-spec.md`](../addon-sdk-spec.md).

## 4. What you must not do

The runtime CSP and the iframe sandbox catch most mistakes, but the
audit grep (next step) flags them earlier:

- ❌ `fetch(...)`, `new WebSocket(...)`, `new RTCPeerConnection(...)`
- ❌ `localStorage` / `sessionStorage` / `indexedDB` directly —
  use `senn.storage`
- ❌ `eval`, `new Function(...)`, `<script src>` from any other origin
- ❌ exfiltrating bytes through `<img src="https://…">` (CSP blocks
  it, but the audit will flag it as suspicious)

The forbidden-API rule is enforced by
`pnpm check:addon-forbidden` against every directory in
[`addons/official/index.json`](../../addons/official/index.json) and
in CI. If you fork a publisher trust root, run the same check on
your registry.

## 5. Validate locally

```sh
pnpm validate:addon path/to/my-addon/manifest.json
pnpm check:addon-forbidden        # scans every official addon dir; add yours to a registry first
```

Errors are precise (id pattern, missing fields, unknown permission
strings). Both gates are wired into CI for the official registry —
they are the same gates your fork will want.

## 6. Sign your manifest

[ADR-0009](../adr/0009-keystore-minimum.md) defines the keystore
format; [ADR-0008](../adr/0008-manifest-signing.md) defines the
detached signature.

Generate a keystore (kept out of git):

```sh
mkdir -p keys
pnpm sign:manifest my-addon --generate-key keys/myaddon.key.json
# prints: publicKey <base64url>  ← share this string with anyone
# who wants to verify your addons
```

Subsequent signs reuse the keystore:

```sh
pnpm sign:manifest my-addon --key keys/myaddon.key.json
```

The result is `my-addon/manifest.sig.json`, served alongside
`manifest.json`. Verify the round-trip:

```sh
pnpm verify:manifest my-addon --trusted-key <your-base64url-public-key>
```

If you change `manifest.json` after signing, the verifier will
correctly fail — the signature is over byte-for-byte content. Re-sign
after every manifest edit.

## 7. Publish

Upload the directory to any HTTPS host:

```
https://addons.example.com/timer/
  ├── manifest.json
  ├── manifest.sig.json
  ├── index.html
  ├── addon.js
  └── senn-addon-sdk.js
```

Tell anyone who wants to load your addon to point their host at the
manifest URL with your public key in `trustedKeys`. Using
`@senn/addon-runtime` directly:

```ts
const host = await AddonHost.load({
  manifestUrl: "https://addons.example.com/timer/manifest.json",
  container: document.querySelector("#mount"),
  session,                        // your PeerSession (or omit for solo)
  storage: storageBackend,        // e.g. IndexedDbStorageBackend
  verify: {
    mode: "required",
    trustedKeys: new Set(["<your-base64url-public-key>"]),
  },
});
```

The host is now enforcing your trust root for *your* addon. SENN
itself is uninvolved — there is no central registry to register
with.

## 8. Optional: ship a registry

If you publish more than one addon, the same shape the official
publisher uses is in
[`addons/official/index.json`](../../addons/official/index.json) and
documented in
[`addons/official/README.md`](../../addons/official/README.md). A
host application that wants to trust your bundle adds your
publisher's `trustedKeys` to its own startup config — independently
of whether it also trusts the official one (multi-publisher trust is
just `Set` union; ADR-0010 covers rotation).

## 9. Common pitfalls

- **Iframe stays at "init" forever** — you forgot `senn.ready()`,
  or the bridge handler is not wired before `ready()`. Always
  register `senn.on(...)` listeners *before* calling `ready()`.
- **CSP blocks your image** — add the host to the addon's
  `Content-Security-Policy` `img-src`. SENN does not loosen the
  default; you control it.
- **`senn.peer.send(...)` silently drops** — your manifest does not
  declare `peer.send`. Watch the host's `addon -> peers` log and
  the host's `error` op stream.
- **Signature stops verifying** — you edited `manifest.json` after
  signing. Re-sign.
- **Add-on runs locally but breaks when embedded** — embedding hosts
  (e.g. the WordPress plugin scaffold) sandbox the iframe; check
  that you have not started using `allow-top-navigation` or
  document.domain workarounds.

## 10. Where to read next

- [`addon-runtime-spec.md`](../addon-runtime-spec.md) — the bridge
  protocol your addon talks to Core through.
- [`addon-binary-transfer-spec.md`](../addon-binary-transfer-spec.md) —
  if you need files-over-peer.
- [`addon-storage-spec.md`](../addon-storage-spec.md) — namespacing
  and quotas for `senn.storage`.
- [`addon-audio-level-spec.md`](../addon-audio-level-spec.md) —
  speaking detection without raw audio.
- [`security-model.md`](../security-model.md) — what Core promises
  the user vs. what add-ons can be expected to honour.

When your addon does something the existing specs do not cover,
that's a signal to open an ADR rather than to bend the bridge — the
contract is intentionally narrow so reviewers can audit by reading.
