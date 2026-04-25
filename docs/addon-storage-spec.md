# Add-on Storage Specification

## Intent

Define the local-first key/value storage that SENN Core exposes to
add-ons through the postMessage bridge. Storage is per-add-on, scoped to
the local device, and gated by manifest permissions. This page is
normative.

The spec extends [addon-runtime-spec.md](addon-runtime-spec.md) and
implements the local-first principles in
[local-first-storage.md](local-first-storage.md).

## Normative checklist

- The host MUST refuse `storage.get` / `storage.list` calls from an
  add-on whose manifest does not declare `storage.local.read`.
- The host MUST refuse `storage.put` / `storage.delete` /
  `storage.clear` calls from an add-on whose manifest does not declare
  `storage.local.write`.
- Each add-on's data MUST live in a namespace keyed by the add-on's
  manifest `id`. No add-on may read or write another add-on's namespace.
- Keys MUST be strings of length ≤ 256 code units.
- Values MUST be JSON-serialisable. Implementations MAY clone via
  `structuredClone`; they MUST NOT pass live references between add-ons
  and Core.
- A single value MUST NOT exceed 1 MiB. Implementations MAY enforce a
  smaller per-add-on quota and MUST return a typed quota error when
  exceeded.
- The host MUST NOT log keys or values.
- `storage.clear` MUST only affect the calling add-on's namespace.

## Bridge protocol additions

`AddonBridgeMessage` from [addon-runtime-spec.md](addon-runtime-spec.md)
gains a `storage` op. To keep the wire shape small, the storage op
carries a sub-op as `storage`:

```ts
type AddonStorageRequest =
  | { kind: "senn.addon.v1"; op: "storage"; rid: string; storage: "get";    key: string }
  | { kind: "senn.addon.v1"; op: "storage"; rid: string; storage: "put";    key: string; value: unknown }
  | { kind: "senn.addon.v1"; op: "storage"; rid: string; storage: "delete"; key: string }
  | { kind: "senn.addon.v1"; op: "storage"; rid: string; storage: "list" }
  | { kind: "senn.addon.v1"; op: "storage"; rid: string; storage: "clear" };

type AddonStorageResponse =
  | { kind: "senn.addon.v1"; op: "storage.result"; rid: string; ok: true;  value: unknown }
  | { kind: "senn.addon.v1"; op: "storage.result"; rid: string; ok: false; error: string };
```

- `rid` is an opaque request id chosen by the add-on. The host MUST
  echo it verbatim in the response.
- `get` returns `value: <stored value>` or `value: null` if absent.
- `list` returns `value: string[]` of keys.
- `put` / `delete` / `clear` return `value: null` on success.
- Errors set `ok: false` with one of the strings:
  `"permission-denied"`, `"key-too-long"`, `"value-too-large"`,
  `"quota-exceeded"`, `"value-not-cloneable"`, `"closed"`,
  `"invalid-request"`.

## Backing store

- The Core implementation MUST use IndexedDB as the primary backing
  store. The database name SHOULD be `senn-addon-storage`. Each
  add-on's namespace lives in an object store keyed by add-on id, with
  primary key = `key` and value = `{ updatedAt, value }`.
- The Core implementation MAY fall back to OPFS for blobs > 1 MiB once
  a blob storage op is added (out of scope for this spec).
- The store MUST persist across page reloads. Implementations MUST NOT
  silently downgrade to in-memory storage in private-browsing modes
  without surfacing this to the host.

## Lifecycle

- Storage is available as soon as the AddonHost reaches `active`.
- `close()` on AddonHost MUST reject in-flight storage requests with
  `error: "closed"`.

## Positive example (informative)

```js
// inside an add-on
function rpc(req) {
  return new Promise((resolve, reject) => {
    const rid = crypto.randomUUID();
    const handler = (ev) => {
      if (ev.source !== parent) return;
      const msg = ev.data;
      if (!msg || msg.kind !== "senn.addon.v1" || msg.op !== "storage.result") return;
      if (msg.rid !== rid) return;
      window.removeEventListener("message", handler);
      msg.ok ? resolve(msg.value) : reject(new Error(msg.error));
    };
    window.addEventListener("message", handler);
    parent.postMessage({ kind: "senn.addon.v1", op: "storage", rid, ...req }, "*");
  });
}

await rpc({ storage: "put", key: "draft", value: { title: "untitled" } });
const draft = await rpc({ storage: "get", key: "draft" });
const keys  = await rpc({ storage: "list" });
```

## Negative examples

- An add-on whose manifest lists only `peer.send` calling
  `storage: "put"` — host MUST respond `{ ok: false, error: "permission-denied" }`.
- A `put` whose JSON-serialised value exceeds 1 MiB — host MUST
  respond `{ ok: false, error: "value-too-large" }`.
- A `clear` from add-on A clearing add-on B's namespace — IMPOSSIBLE by
  construction; the host always namespaces by the iframe's add-on id.

## Conformance

```sh
pnpm --filter @senn/storage test
pnpm --filter @senn/web e2e
```

The Playwright e2e exercises persistence: a vault-style add-on writes
a record, the page reloads, the add-on reads the record back.

## Cross-references

- [addon-runtime-spec.md](addon-runtime-spec.md) — base bridge protocol.
- [local-first-storage.md](local-first-storage.md) — top-level principles.
- [addon-spec.md](addon-spec.md) — `storage.local.*` permission strings.
