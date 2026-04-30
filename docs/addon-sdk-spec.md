# Add-on SDK Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Intent

Define the JavaScript surface that `@sennjs/addon-sdk` installs as
`window.senn` inside an add-on iframe. This page is normative for
the **shape** of the global; the underlying wire is the bridge in
[addon-runtime-spec.md](addon-runtime-spec.md), which is what both
the host and any non-SDK add-on speak.

The SDK is **optional sugar**. An add-on MAY skip it entirely and
talk to the bridge directly via `parent.postMessage`. Conformance
tests verify both paths.

## Distribution

- The runtime ships as a single hand-written classic script
  (`packages/addon-sdk/runtime/senn-addon-sdk.js`).
- A build step (`pnpm build:addon-sdk`) copies it into every add-on
  directory listed in `addons/official/index.json` as
  `senn-addon-sdk.js`. Each add-on's `index.html` loads it with a
  same-origin relative `<script src>` BEFORE its own `addon.js`.
- The SDK is not loaded across origins. CSP `connect-src 'none'`
  is unaffected.

This shape keeps the SDK auditable as a static file: a reviewer can
diff `senn-addon-sdk.js` byte-for-byte against the canonical copy in
`packages/addon-sdk/runtime/`.

## `window.senn` surface

```ts
interface SennAddonGlobal {
  readonly context: SennAddonContext | null;
  ready(): Promise<SennAddonContext>;
  on<K extends keyof SennAddonEventMap>(
    event: K,
    handler: (value: SennAddonEventMap[K]) => void,
  ): () => void;
  readonly peer: { send(p: unknown): void; sendBinary(r: { mime?: string; bytes: Uint8Array }): void };
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown): Promise<null>;
    delete(key: string): Promise<null>;
    list(): Promise<readonly string[]>;
    clear(): Promise<null>;
  };
}

interface SennAddonContext {
  readonly addonId: string;
  readonly version: string;
  readonly sessionId: string;
}

interface SennAddonEventMap {
  init: SennAddonContext;
  deliver: { payload: unknown; from?: string };
  "deliver-bin": { mime: string; bytes: Uint8Array; from?: string };
  error: Error & { code?: string };
}
```

The full TypeScript types live in `@sennjs/addon-sdk` (`src/index.ts`).

## Normative checklist

- The SDK MUST install `window.senn` exactly once per iframe load
  (`if (window.senn) return;`).
- `senn.ready()` MUST send the bridge `ready` op, return a Promise,
  and resolve to the `init` context the host posts back.
- `senn.on("init", fn)` MUST also fire on init, **after** the
  `ready()` Promise resolves.
- `senn.peer.send(payload)` MUST forward the payload via the
  `send` bridge op without modification. Permission enforcement
  remains entirely on the host.
- `senn.peer.sendBinary({ mime, bytes })` MUST throw `TypeError` if
  `bytes` is not a `Uint8Array`. It MUST NOT enforce the 64 KiB cap
  itself — that check is on the host (so the rule has one source of
  truth, per [addon-binary-transfer-spec.md](addon-binary-transfer-spec.md)).
- `senn.storage.*` MUST queue requests with unique correlation ids
  and reject the returned Promise on `storage.result.ok === false`.
- The SDK MUST surface bridge `error` ops to listeners registered
  with `senn.on("error", fn)`. The error MUST carry `code` when the
  host supplied one.
- The SDK MUST NOT log private bytes. It MAY log when a listener
  throws.

## Example (informative)

```html
<script src="senn-addon-sdk.js"></script>
<script src="addon.js"></script>
```

```js
// addon.js
senn.on("deliver", ({ payload }) => {
  console.log("received", payload);
});

senn.ready().then((ctx) => {
  console.log("addon", ctx.addonId, "v" + ctx.version);
  senn.peer.send({ hello: "world" });
});

document.querySelector("#save").addEventListener("click", async () => {
  await senn.storage.put("note", { text: "hi" });
});
```

The same add-on without the SDK uses `parent.postMessage(...)`
directly with `kind: "senn.addon.v1"`. Both are valid.

## Negative examples

- Calling `senn.peer.sendBinary({ bytes: "not-a-uint8array" })` —
  **rejected** by the SDK with `TypeError`.
- Loading the SDK from a different origin — the iframe's CSP
  `default-src 'self'` blocks it; the add-on must ship the SDK on
  its own origin.
- An add-on importing `@sennjs/addon-sdk` as an ES module — works for
  bundler-based builds, but the static add-ons that ship in this
  repo intentionally use the classic-script form so they remain
  drop-in deployable.

## Conformance

The SDK is exercised in every add-on e2e (echo, local-vault, etc.)
that has been refactored onto it. The host-side bridge tests in
`@senn/manifest` and the e2e in `apps/web/e2e` cover both paths
(SDK and direct postMessage), so wire compatibility is verified
in both directions.

## Cross-references

- [addon-runtime-spec.md](addon-runtime-spec.md)
- [addon-binary-transfer-spec.md](addon-binary-transfer-spec.md)
- [addon-storage-spec.md](addon-storage-spec.md)
- [addon-spec.md](addon-spec.md)
