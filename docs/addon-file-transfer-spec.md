# Add-on File Transfer Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Intent

Define how a SENN add-on may read user-selected files and trigger
user-approved file saves from inside its sandboxed iframe. This page
is normative.

The runtime baseline lives in
[addon-runtime-spec.md](addon-runtime-spec.md); the permission strings
in [addon-spec.md](addon-spec.md). Cross-peer file transfer over the
data channel is OUT OF SCOPE for this version (it requires binary
chunking + flow control on `core.text` or a separate channel; future
ADR).

## Normative checklist

- An add-on declaring `file.read.user_selected` MAY use a standard
  `<input type="file">` element, `change` events, and `FileReader` /
  `Blob.arrayBuffer()` to read the bytes of a file the user explicitly
  selected via the OS picker.
- An add-on declaring `file.write.user_approved` MAY construct a
  `Blob`, obtain an Object URL via `URL.createObjectURL`, and trigger a
  download by programmatically clicking an `<a download>` element. The
  user's prior click that reached the add-on UI counts as the approval;
  no implicit auto-save before that gesture.
- An add-on MUST NOT read files that the user did not select. In
  particular, it MUST NOT use `showDirectoryPicker`,
  `webkitdirectory`, the File System Access API for non-user-selected
  paths, or any other API that bypasses the picker UX.
- An add-on MUST NOT silently auto-download. Each download MUST be
  caused by a user gesture inside the add-on UI.
- An add-on MUST NOT post file bytes to any network endpoint. The CSP
  default `connect-src 'none'` already prevents this; the rule is
  restated here for clarity.
- An add-on that wants to send a file across peers MUST go through the
  Core add-on bridge (forthcoming binary `peer.send` extension). Until
  that ships, cross-peer file transfer is not supported in this spec.
- Persisting a file's bytes for later use MUST go through
  `storage.local.write` and respect the existing 1 MiB per-value
  limit. Larger blobs are deferred to a future OPFS-backed extension.

## Permission summary

| Permission | What it allows | Enforcement |
|------------|---------------|-------------|
| `file.read.user_selected` | `<input type=file>` + FileReader on the chosen File. | Audit + sandbox CSP (`connect-src 'none'`) prevents exfiltration. |
| `file.write.user_approved` | `URL.createObjectURL(blob)` + `<a download>.click()` triggered by a user gesture. | Audit + sandbox; iframe sandbox without `allow-downloads` would block this — see notes below. |

### iframe sandbox flag note

Browsers gate downloads in sandboxed iframes behind the
`allow-downloads` flag. The SENN AddonHost adds `allow-downloads` to
the iframe sandbox **only when the manifest declares
`file.write.user_approved`** — making the sandbox surface track the
declared permission set. Otherwise the iframe stays at
`sandbox="allow-scripts"` and the browser blocks any download attempt
regardless of how the add-on tries to trigger it.

`allow-same-origin` is NEVER added by SENN. Add-ons always run on an
opaque origin so that, even with `allow-downloads`, a misbehaving
add-on cannot read the host's cookies, localStorage, or IndexedDB.

## Bridge protocol additions

None in this version. File pick / file save happen entirely inside the
add-on's sandboxed iframe using standard browser APIs. Only persistence
goes through the existing `storage` op.

The placeholder for a future `file` op is reserved:

```ts
// FUTURE — not implemented yet:
// type AddonFileOp = "request-pick" | "request-save";
```

## Wire example (informative)

```html
<input id="picker" type="file" />
<button id="add">add</button>
<ul id="list"></ul>
```

```js
const KIND = "senn.addon.v1";
const picker = document.getElementById("picker");
const list = document.getElementById("list");

document.getElementById("add").addEventListener("click", async () => {
  const file = picker.files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  // base64 the bytes for storage (< 1 MiB after JSON expansion).
  const b64 = btoa(String.fromCharCode(...bytes));
  await rpc({
    storage: "put",
    key: `vault/${file.name}`,
    value: { name: file.name, type: file.type, size: bytes.byteLength, b64 },
  });
});

async function download(key) {
  const rec = await rpc({ storage: "get", key });
  const bin = atob(rec.b64);
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([buf], { type: rec.type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = rec.name;
  a.click();
  URL.revokeObjectURL(url);
}
```

## Negative examples

- Calling `showDirectoryPicker()` to enumerate the user's documents —
  **rejected** by audit; bypasses the user-selected scope.
- Reading `picker.files[0]` without the user having interacted with
  the input — **rejected**; in modern browsers the input is empty
  until the user selects a file, so this is moot, but the audit rule
  forbids any technique that fakes a selection.
- Auto-download on add-on load — **rejected**: every download MUST
  follow a user gesture inside the add-on UI.

## Conformance

```sh
pnpm --filter @senn/web e2e
```

The local-vault add-on is the reference implementation. Its e2e:

- attaches a file via `setInputFiles` (Playwright's stand-in for a real
  picker click; the add-on's `change` event fires identically),
- saves it through the storage bridge,
- lists it,
- triggers a download via the add-on UI and asserts a Playwright
  `download` event arrives with the correct suggested filename.

## Cross-references

- [addon-runtime-spec.md](addon-runtime-spec.md)
- [addon-storage-spec.md](addon-storage-spec.md)
- [addon-spec.md](addon-spec.md)
- [security-model.md](security-model.md)
