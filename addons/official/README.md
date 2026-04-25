# Official SENN add-on registry

`index.json` is the trust root for the **official** SENN add-on
publisher. It pins the public key(s) the project uses to sign every
add-on it ships, plus the list of add-ons covered by that key.

This is only the *publisher's* index. Hosts using SENN are free to
ignore it, ship their own, or merge it with others.

## Schema (v1)

```ts
interface OfficialRegistryV1 {
  readonly v: 1;
  readonly publisher: { readonly name: string; readonly homepage?: string };
  readonly trustedKeys: readonly string[]; // base64url Ed25519 public keys
  readonly addons: readonly OfficialRegistryAddonV1[];
}

interface OfficialRegistryAddonV1 {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly path: string;        // repo-relative dir holding manifest.json + manifest.sig.json
  readonly capabilities: readonly string[];
}
```

## Conformance

```sh
pnpm verify:official
```

Walks `addons` and verifies each `manifest.sig.json` against the bytes
of `manifest.json` and the registry's `trustedKeys`. CI runs the same
command on every push.

## Re-signing

If a manifest changes, regenerate its signature:

```sh
pnpm sign:manifest <path> --key keys/senn-official.key.json
pnpm verify:official
```

The keystore (`*.key.json`) is gitignored per
[ADR-0009](../../docs/adr/0009-keystore-minimum.md). Holders of the
official key are listed in
[`docs/governance.md`](../../docs/governance.md) when that file lands;
for now, the bootstrap publisher is the repo owner.
