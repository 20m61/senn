# Official SENN add-on registry

`index.json` is the trust root for the **official** SENN add-on
publisher. It pins the public key(s) the project uses to sign every
add-on it ships, plus the list of add-ons covered by that key.

This is only the *publisher's* index. Hosts using SENN are free to
ignore it, ship their own, or merge it with others.

## Schema

Two versions are valid. v1 is supported indefinitely; v2 (per
[ADR-0017](../../docs/adr/0017-registry-schema-v2.md)) layers
optional discovery + lifecycle metadata on top.

### v1 (still valid)

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

### v2 (current shipping shape)

```ts
interface OfficialRegistryV2 {
  readonly v: 2;
  readonly publisher: { readonly name: string; readonly homepage?: string };
  readonly trustedKeys: readonly string[];
  readonly addons: readonly OfficialRegistryAddonV2[];
}

interface OfficialRegistryAddonV2 {
  // unchanged from v1
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly path: string;
  readonly capabilities: readonly string[];

  // optional, all additive
  readonly categories?: readonly RegistryCategory[];   // closed enum, see ADR-0017
  readonly tags?: readonly string[];                   // free-form, kebab-case, ≤ 8 × 32
  readonly deprecated?: AddonDeprecationV1;
}

interface AddonDeprecationV1 {
  readonly since: string;             // ISO-8601
  readonly reason: string;            // ≤ 280 chars
  readonly supersededBy?: string;     // ideally an addon id in the same registry
}

type RegistryCategory =
  | "communication" | "creative" | "productivity" | "presence" | "files"
  | "games" | "education" | "accessibility" | "developer-tools" | "other";
```

`pnpm verify:official` accepts both v1 and v2 inputs and validates the
v2 optional fields when they are present.

### Publisher meta-index (optional, ADR-0017 §3)

A separate, **unsigned**, **non-trust-bearing** document points at one
or more publisher index URLs so a host can pre-seed the gallery with
multiple publishers without hard-coding URLs in code. The official
worked example is [`meta.json`](meta.json).

```ts
interface PublisherMetaIndexV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-meta";  // discriminator
  readonly publishers: readonly PublisherEntryV1[];
}

interface PublisherEntryV1 {
  readonly url: string;        // absolute http(s) URL of a publisher index.json
  readonly name?: string;      // human label, ≤ 80 chars
  readonly featured?: boolean; // hint for the gallery to surface this entry first
}
```

The meta-index never adds trust — every publisher index it references
still owns its own `trustedKeys`, and the gallery still re-verifies
every signed manifest as it does today. `pnpm verify:official` runs
the meta validator automatically when `meta.json` is present.

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
official key, custody rules, and the rotation runbook are in
[`docs/governance.md`](../../docs/governance.md) (rotation policy:
[ADR-0010](../../docs/adr/0010-key-rotation.md)).
