# Official SENN add-on registry

`index.json` is the trust root for the **official** SENN add-on
publisher. It pins the public key(s) the project uses to sign every
add-on it ships, plus the list of add-ons covered by that key.

This is only the *publisher's* index. Hosts using SENN are free to
ignore it, ship their own, or merge it with others.

## Schema

Three versions are valid. v1 is supported indefinitely; v2 (per
[ADR-0017](../../docs/adr/0017-registry-schema-v2.md)) layers
optional discovery + lifecycle metadata; v3 (per
[ADR-0020](../../docs/adr/0020-registry-schema-v3.md)) adds optional
per-version histories, audit attestations, and pairs with separate
submissions / endorsement surfaces.

| Field | Since | Type | Notes |
|---|---|---|---|
| `id` / `name` / `version` / `description` / `path` / `capabilities` | v1 | required | unchanged across versions |
| `categories` | v2 | closed enum | see RegistryCategory below |
| `tags` | v2 | string[] | kebab-case, ≤ 8 × 32 chars |
| `deprecated` | v2 | object | see AddonDeprecationV1 |
| `history` | v3 | array | append-only by convention; see AddonVersionEntryV1 |
| `audit` | v3 | object | publisher attestation; see AddonAuditV1 |

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

`pnpm verify:official` accepts v1, v2, and v3 inputs and validates the
optional fields when they are present.

### v3 (additive, ADR-0020)

```ts
interface OfficialRegistryV3 {
  readonly v: 3;
  readonly publisher: { readonly name: string; readonly homepage?: string };
  readonly trustedKeys: readonly string[];
  readonly addons: readonly OfficialRegistryAddonV3[];
}

interface OfficialRegistryAddonV3 {
  // ...all v2 fields, unchanged...
  readonly history?: readonly AddonVersionEntryV1[];
  readonly audit?: AddonAuditV1;
}

interface AddonVersionEntryV1 {
  readonly version: string;          // SemVer 2.0.0; unique within history[]
  readonly path: string;             // manifest.json path for this prior version
  readonly signedAt: string;         // ISO-8601, copied from manifest.sig.json
  readonly publicKey: string;        // base64url Ed25519 (43 chars)
  readonly changelog?: string;       // ≤ 2 KiB UTF-8
  readonly yanked?: AddonYankV1;
}

interface AddonYankV1 {
  readonly at: string;               // ISO-8601
  readonly reason: string;           // ≤ 280 chars
}

interface AddonAuditV1 {
  readonly auditor: string;          // 1..80 chars
  readonly auditedAt: string;        // ISO-8601
  readonly auditedVersion: string;   // MUST match head version or an entry in history[]
  readonly findings: AddonAuditFindingsV1;
  readonly url?: string;             // optional link to full report
}

interface AddonAuditFindingsV1 {
  readonly summary: string;                            // 1..280 chars
  readonly severityCounts?: {
    readonly critical?: number; readonly high?: number;
    readonly medium?: number;   readonly low?: number;
    readonly nit?: number;
  };
}
```

Rules:

- `history[]` MUST NOT include the head version (the one named by the
  outer `version`/`path`); the head sits at the outer fields.
- `audit.auditedVersion` MUST match the head version or one of the
  entries in `history[]`.
- v2 documents that include v3-only fields (`history`, `audit`) are
  rejected; producers wanting these fields bump `v` to `3`.

### Submissions index (optional, ADR-0020 §2)

A separate document, alongside `index.json`, lists structured
submissions awaiting publisher review. Like the meta-index, it is
**unsigned** at the document level — trust comes from each
submission's own `manifest.sig.json`.

```ts
interface PublisherSubmissionsV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-submissions";
  readonly submissions: readonly SubmissionV1[];
}

interface SubmissionV1 {
  readonly id: string;
  readonly addonId: string;          // proposed reverse-DNS id
  readonly version: string;          // SemVer 2.0.0
  readonly manifestUrl: string;      // absolute URL
  readonly signatureUrl: string;     // absolute URL
  readonly publicKey: string;        // base64url Ed25519, submitter's signing key
  readonly submittedAt: string;      // ISO-8601
  readonly contact: string;          // 1..200 chars
  readonly status: "pending" | "needs-changes" | "accepted" | "rejected" | "withdrawn";
  readonly statusUpdatedAt: string;  // ISO-8601
  readonly statusReason?: string;    // ≤ 280 chars; required when status != "pending"
  readonly notes?: string;           // ≤ 2 KiB UTF-8
}
```

Validate with `pnpm validate:registry submissions/index.json`.

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
  // ADR-0020 §3b — additive, decorative-only:
  readonly endorsedBy?: readonly string[];  // 1..8 labels, each ≤ 80 chars
  readonly endorsementUrl?: string;
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
