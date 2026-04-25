# Add-on Manifest Signing Specification

## Intent

Define the wire format and verification rules for detached Ed25519
signatures on SENN add-on manifests. This page is normative.

The decision and rationale live in
[ADR-0008](adr/0008-manifest-signing.md).

## Normative checklist

- A signed add-on MUST ship a `manifest.sig.json` file adjacent to its
  `manifest.json`, served from the same origin.
- The signed bytes MUST be the byte-for-byte content of `manifest.json`
  as served — including leading/trailing whitespace and key order. No
  canonicalisation.
- The signature algorithm MUST be Ed25519 (RFC 8032), identified by the
  string `"Ed25519"` in the `alg` field.
- The public key MUST be exactly 32 bytes, base64url-encoded without
  padding.
- The signature MUST be exactly 64 bytes, base64url-encoded without
  padding.
- Verifiers MUST reject any `manifest.sig.json` whose `alg` is not
  `"Ed25519"`.
- Verifiers MUST reject signatures over a manifest that has been
  modified after signing.
- Verifiers MUST reject signatures whose public key is not in the
  host application's `trustedKeys` set.
- Hosts MUST NOT embed a default trust root.

## `manifest.sig.json` schema

```ts
interface ManifestSignatureV1 {
  readonly v: 1;
  readonly alg: "Ed25519";
  readonly publicKey: string;   // base64url, 32 bytes raw
  readonly signature: string;   // base64url, 64 bytes raw
  readonly signedAt: string;    // ISO-8601, advisory only
}
```

Decoders MUST reject:

- `v` ≠ `1`.
- `alg` ≠ `"Ed25519"`.
- `publicKey` decoding to a length other than 32 bytes.
- `signature` decoding to a length other than 64 bytes.
- `signedAt` not parseable as an ISO-8601 instant.
- Any extra top-level field.

## Verification modes (host application side)

```ts
type VerifyMode = "none" | "optional" | "required";

interface AddonHostVerifyOptions {
  readonly mode: VerifyMode;
  readonly trustedKeys?: ReadonlySet<string>; // base64url public keys
}
```

| Mode | Sig fetched? | Sig present + valid + trusted | Sig present + invalid | Sig absent |
|------|--------------|-------------------------------|-----------------------|------------|
| `none` | no | accept | accept | accept |
| `optional` | yes | accept | reject | accept |
| `required` | yes | accept | reject | reject |

In `optional` and `required`, if the sig is present but its
`publicKey` is not in `trustedKeys`, verification MUST fail.

## Wire flow

1. AddonHost fetches `manifest.json`. Stores the **raw response bytes**.
2. If verify mode is `optional` or `required`, fetches
   `manifest.sig.json`. A 404 is "absent"; any other non-2xx is a
   hard failure.
3. Validates `manifest.sig.json` against the schema above.
4. If `trustedKeys` is provided (it MUST be in `optional` / `required`),
   checks that `publicKey ∈ trustedKeys`.
5. Runs Web Crypto `crypto.subtle.verify` with the manifest bytes.
6. Only after verification succeeds does the manifest body get parsed
   and validated against [addon-manifest.md](addon-manifest.md).

This ordering matters: the spec MUST refuse to deserialise a manifest
JSON until the bytes are known to be authentic, otherwise a malicious
add-on host could exploit a parser bug before signature validation.

## Positive example (informative)

`manifest.json`:

```json
{
  "id": "dev.senn.echo",
  "name": "Echo",
  "version": "0.1.0",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send","peer.receive","ui.panel"],
  "capabilities": ["echo-v1"]
}
```

`manifest.sig.json`:

```json
{
  "v": 1,
  "alg": "Ed25519",
  "publicKey": "k4cF8s3VeZqZJ6WHr-yfXY8a2QM9uH1S4kE7qX2bjVk",
  "signature": "Pq...64-bytes-base64url...A",
  "signedAt": "2026-04-25T15:33:00.000Z"
}
```

## Negative examples

- A signature whose `alg` is `"RS256"` — **rejected**: only Ed25519 is
  supported in this version.
- A `publicKey` of 33 bytes — **rejected**: Ed25519 keys are exactly 32 bytes.
- A `manifest.json` with one extra trailing newline added after signing
  — **rejected**: the signed bytes do not match the served bytes.
- A correct signature whose `publicKey` is not in the host's
  `trustedKeys` — **rejected** in `optional` / `required` modes.

## Tooling (CLI)

The repo ships two thin CLIs around `@senn/manifest`:

```sh
# First-time use: generate a keystore (kept out of git per ADR-0009)
pnpm sign:manifest <addon-dir> --generate-key keys/myaddon.key.json

# Subsequent signs reuse the keystore
pnpm sign:manifest <addon-dir> --key keys/myaddon.key.json

# Verify a signature (use --trusted-key when you want to enforce a publisher)
pnpm verify:manifest <addon-dir> --trusted-key <base64url-public-key>
```

Both commands operate on the byte content of `manifest.json` — editing
the manifest after signing invalidates the signature and the verifier
will reject it. Keystore files (`*.key.json`) are gitignored.

## Conformance

```sh
pnpm --filter @senn/manifest test
pnpm sign:manifest <addon-dir> --generate-key /tmp/dev.key.json
pnpm verify:manifest <addon-dir>
pnpm --filter @senn/web e2e
```

`@senn/manifest`'s vitest covers sign/verify round-trip, tampered
manifests, wrong key, malformed signature files, and base64url edge
cases. The Playwright e2e proves AddonHost's `verify: required` mode
rejects an unsigned add-on and accepts a freshly-signed one against a
test keypair generated at test time.

## Cross-references

- [ADR-0008](adr/0008-manifest-signing.md)
- [addon-manifest.md](addon-manifest.md)
- [addon-runtime-spec.md](addon-runtime-spec.md)
- [security-model.md](security-model.md)
