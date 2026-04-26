# ADR 0020: Registry schema v3 — version histories, submissions, and reviews

## Status

Implemented (2026-04-26). Schema accepted in this ADR; implementation
landed across commits `38db86d` (validators), `7a1229e` (registry
bump to v3), `f1ef3b4` (gallery v3 surface), and `ab5084b` (audit
backfill + submissions validators + Pages deploy). Validators ship in
`scripts/lib/registry-schema.ts` (covered by `pnpm test:registry-schema`);
the addon-gallery renders v3 fields (`audit` badge, `history` details,
meta-index `endorsedBy` chips); the official registry uses v3
(`addons/official/index.json` v=3, with a self-attestation `audit` block
on `dev.senn.whiteboard` as the worked example). The submissions surface
(§2) is validator-only — the gallery does not render it yet because no
publisher ships `submissions/index.json` today.

## Context

[ADR-0017](0017-registry-schema-v2.md) §4 deferred three concrete
features the gallery and ecosystem will eventually need:

1. **Per-version histories.** v2 lists exactly one current version per
   addon. A user holding a stale deep-link (e.g., from a blog post)
   sees no record of `whiteboard@0.1.0` once the publisher ships
   `0.2.0` — the entry has been silently rewritten in place.
   ADR-0017's add-on `deprecated.supersededBy` field handles
   rename-style supersession but says nothing about the actual
   *history* of an id.
2. **Submission flow.** ADR-0016 §7 documents the contribution path as
   "open a PR against the publisher's repo." That works for
   sole-maintainer publishers but not for federated registries where
   multiple authors may contribute to one publisher's index. There is
   no machine-readable "this addon is awaiting review" state, no
   structured submission record, and no convention for where a
   submission's bytes live before they merge.
3. **Reviews.** ADR-0017 explicitly rejected ratings/reputation for
   trust reasons (a meta-publisher with implicit authority over all
   listed publishers is incompatible with vendor-neutrality). But
   publishers themselves often *do* perform vetting before listing an
   addon, and that vetting is currently invisible to gallery users.

Three constraints carry over from the existing trust model:

- **Per-publisher trust stays per-publisher.** ADR-0007 (vendor
  neutrality) and ADR-0008 (manifest signing) mean every artefact a
  gallery treats as authoritative MUST chain back to the publisher's
  `trustedKeys`. A new aggregate that bypasses that chain is
  rejected on principle (ADR-0017 "Alternatives: Meta-registry that
  also pins keys").
- **Schema additivity.** ADR-0017 §2 ("schema evolution rule") says
  every reader MUST accept v1 and v2; v3 inherits that obligation.
  No v2 deployment is invalidated, no current consumer breaks.
- **Smallest viable surface.** ADR-0017 §"Alternatives: Bumping
  straight to v3 with submission/review baked in" called the
  bake-everything-in approach speculative. v3 here adds only what is
  needed to *unblock* the three deferred features, not what would be
  ideal in some future ecosystem.

## Decision

v3 adds three additive surfaces. Each is independent: a v3 publisher
MAY ship one without the others.

### 1. Per-version histories (additive on `OfficialRegistryAddonV2`)

```ts
interface OfficialRegistryV3 {
  readonly v: 3;
  readonly publisher: { readonly name: string; readonly homepage?: string };
  readonly trustedKeys: readonly string[];
  readonly addons: readonly OfficialRegistryAddonV3[];
}

interface OfficialRegistryAddonV3 {
  // unchanged from v2
  readonly id: string;
  readonly name: string;
  readonly version: string;     // current version (the head)
  readonly description: string;
  readonly path: string;        // current version's manifest path
  readonly capabilities: readonly string[];
  readonly categories?: readonly RegistryCategory[];
  readonly tags?: readonly string[];
  readonly deprecated?: AddonDeprecationV1;

  // new in v3, all optional
  readonly history?: readonly AddonVersionEntryV1[];
}

interface AddonVersionEntryV1 {
  readonly version: string;          // SemVer 2.0.0
  readonly path: string;             // manifest.json path for THIS version
  readonly signedAt: string;         // ISO-8601, copied from manifest.sig.json
  readonly publicKey: string;        // base64url Ed25519 — MUST be in publisher.trustedKeys
  readonly changelog?: string;       // optional, ≤ 2 KiB plain text or markdown
  readonly yanked?: AddonYankV1;     // see below
}

interface AddonYankV1 {
  readonly at: string;               // ISO-8601 instant the version was yanked
  readonly reason: string;           // ≤ 280 chars, human-readable
}
```

Rules:

- The `version` in each `history[]` entry MUST be SemVer 2.0.0 and
  MUST be unique within the array.
- `history[]` is **append-only by convention**. A publisher rewriting
  an old entry's `path` or `publicKey` invalidates the integrity
  claim a user already trusted; tools MUST treat such a rewrite as a
  schema violation (the cross-check fails) and SHOULD log a
  loud warning rather than silently use the new value.
- `history[]` does NOT include the head version (the one named by the
  outer `version`/`path` pair). A consumer reconstructs the full
  ordered list as `[...history, head]` (or by SemVer-sorting if order
  matters).
- A `yanked` version is still listed and still resolvable; it is
  flagged so the gallery can render a "yanked" badge and so a host
  can refuse to install it under a stricter mode. Yanking is NOT
  signature revocation — the manifest's signature is unchanged, only
  the listing carries a yank advisory.
- Each `history[].path` MUST resolve to a manifest signed by a key
  that is OR was in `publisher.trustedKeys` at the time of signing.
  Old keys removed from `trustedKeys` per ADR-0010 key rotation are
  permitted because the `signedAt` timestamp lets a host decide
  whether to honour the historical key. The gallery surfaces the key
  fingerprint either way.

### 2. Submission flow (separate schema, NOT part of the registry)

Submissions are NOT trust-bearing. They are structured proposals that
a publisher's tooling ingests; once accepted, a submission becomes a
`history[]` entry in the publisher's registry (or, for a never-listed
id, the head version of a new entry).

A submission lives in a separate document at a publisher-owned URL
(convention: `submissions/index.json` alongside the publisher's
`index.json`):

```ts
interface PublisherSubmissionsV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-submissions";   // discriminator
  readonly submissions: readonly SubmissionV1[];
}

interface SubmissionV1 {
  readonly id: string;                  // submission id, unique within this list
  readonly addonId: string;             // proposed reverse-DNS id (matches manifest.id)
  readonly version: string;             // SemVer 2.0.0 — proposed head version
  readonly manifestUrl: string;         // absolute URL of the submission's manifest.json
  readonly signatureUrl: string;        // absolute URL of submission's manifest.sig.json
  readonly publicKey: string;           // base64url, the submitter's signing key
  readonly submittedAt: string;         // ISO-8601 instant
  readonly contact: string;             // email or URL — non-empty
  readonly status: SubmissionStatusV1;  // see below
  readonly statusUpdatedAt: string;     // ISO-8601 instant
  readonly statusReason?: string;       // ≤ 280 chars, required when status ≠ "pending"
  readonly notes?: string;              // ≤ 2 KiB plain text, public reviewer notes
}

type SubmissionStatusV1 =
  | "pending"
  | "needs-changes"
  | "accepted"
  | "rejected"
  | "withdrawn";
```

Rules:

- The submissions document is **unsigned at the document level**, like
  the meta-index in ADR-0017 §3. Trust comes from the submission's
  *own* `manifest.sig.json` (signed by the submitter's `publicKey`),
  not from the listing.
- The submitter's `publicKey` is **NOT** automatically added to the
  publisher's `trustedKeys`. Acceptance requires the publisher to
  either: countersign the manifest with a publisher key, OR
  explicitly extend `trustedKeys` to include the submitter's key.
  Both choices are out of scope of this ADR; either is compatible
  with the schema.
- Status transitions are publisher-driven and append-only on the
  history axis: the gallery MAY render the latest status of each
  submission id but MAY also render a public history if the
  publisher exposes one (out of scope — the schema does not require
  audit trails).
- A `status: "accepted"` submission SHOULD result, in a subsequent
  publisher's `index.json` update, in either a new addon entry or a
  new `history[]` entry on an existing addon. The schema does not
  *enforce* this — the publisher is free to delay or batch — but a
  long-lived "accepted" submission whose addon never lists is a
  signal to gallery users that something is wrong, and tools MAY
  warn.
- The submissions document's `manifestUrl` and `signatureUrl` SHOULD
  live on a path that survives merge. Convention:
  `submissions/<addonId>/<version>/{manifest.json,manifest.sig.json}`,
  alongside the listing.

The gallery treats submissions as **read-only metadata for opt-in
display**. A host application MUST NOT load a submission's addon as
if it were a registry entry; submissions are not in the trust chain
until they are promoted.

### 3. Reviews (publisher-attestable only)

Two narrow surfaces, both scoped strictly to *publisher attestations*.
User-generated reviews and ratings remain out of scope for the same
reason ADR-0017 rejected open-vocabulary categories: they devolve
into noise and they create an aggregate-trust shape that ADR-0007
forbids.

#### 3a. `audit` field on a registry entry (additive on v3)

```ts
interface OfficialRegistryAddonV3 {
  // ... fields from §1 above ...
  readonly audit?: AddonAuditV1;
}

interface AddonAuditV1 {
  readonly auditor: string;      // human label, e.g. "SENN Project security review"
  readonly auditedAt: string;    // ISO-8601 instant
  readonly auditedVersion: string; // SemVer; MUST match an entry in `history[]` or current `version`
  readonly findings: AddonAuditFindings;
  readonly url?: string;         // optional link to the full audit document
}

interface AddonAuditFindings {
  readonly summary: string;                            // ≤ 280 chars
  readonly severityCounts?: {
    readonly critical?: number;
    readonly high?: number;
    readonly medium?: number;
    readonly low?: number;
    readonly nit?: number;
  };
}
```

Rules:

- The `audit` field is a **publisher attestation about a version**.
  The audit MAY have been performed by a third party (e.g., the SENN
  Project security team auditing a community publisher's addon) but
  the publisher MUST publish the field, because the publisher's
  `trustedKeys`-signed `manifest.sig.json` is the integrity boundary
  the gallery already trusts.
- A `severityCounts` of `{ critical: 0, high: 0 }` does NOT mean the
  addon is safe — only that the auditor found nothing of those
  severities at the audited version. The gallery surfaces the audit
  badge with the auditor name and date; users can drill into `url`
  for the full report.
- Re-auditing a later version means a new `audit` value with a new
  `auditedAt` and a new `auditedVersion`. There is no audit history
  in the schema; if a publisher wants to expose past audits, that
  goes in `history[].changelog` or in the audit `url`.

#### 3b. Endorsement meta-index entry (extends ADR-0017 §3)

```ts
interface PublisherEntryV2 {
  readonly url: string;
  readonly name?: string;
  readonly featured?: boolean;
  readonly endorsedBy?: readonly string[];   // human labels of endorsing parties
  readonly endorsementUrl?: string;          // optional link to the endorsement
}
```

Rules:

- `endorsedBy[]` and `endorsementUrl` are **decorative**: they let a
  meta-index author (e.g. the SENN Project) signal "we trust this
  publisher enough to list them" without creating an aggregate-trust
  edge in the schema. The gallery may render an endorsement badge.
- Like the rest of the meta-index, this is unsigned and non-trust-
  bearing. A user clicking through still sees the publisher's own
  `trustedKeys` and per-manifest signatures.
- An endorsement is NOT a review. It is closer to a curator's "we
  bothered to put this in our list" signal. ADR-0017's
  vendor-neutrality stance survives because the gallery still aggregates
  trust per-publisher, not per-endorsement.

### 4. Schema evolution rule (continuation of ADR-0017 §2)

Validators MUST accept `v: 1`, `v: 2`, and `v: 3`:

- Reading v1/v2 → all v3-only fields are `undefined`/empty.
- Reading v3 → all v3 fields are optional. A v3 emitter MAY ship a
  document indistinguishable from v2 if it has nothing new to say.

A `v: 2` document referencing v3-only fields (`history`, `audit`)
MUST be rejected as invalid v2 — the schema is closed at the version
boundary. Producers wanting these fields bump to `v: 3`.

The cross-check in `scripts/verify-official-addons.ts` extends to
include the new optional fields when present. Specifically:

- Every `history[].path` MUST be reachable and the manifest at that
  path MUST verify under one of `publisher.trustedKeys` OR a key whose
  rotation is documented per ADR-0010.
- Every `audit.auditedVersion` MUST appear in `history[]` or equal
  the addon's current `version`.
- A `submissions/index.json` (when present) MUST validate against the
  `PublisherSubmissionsV1` schema; status transitions are not
  validated (publisher discretion).

### 5. What v3 still does NOT decide

- **Ratings, stars, free-form user reviews.** Out of scope.
  Subjective surfaces stay outside the trust schema.
- **Cross-publisher trust delegation.** Each publisher remains the
  authority over its own `trustedKeys`. Endorsements (§3b) are
  decorative, not transitive.
- **Federated submission routing.** A submission lives under one
  publisher's `submissions/index.json`. There is no inter-publisher
  forwarding — if a submission belongs elsewhere, the publisher
  rejects with `statusReason` pointing the submitter at the right
  place.
- **Yanked-version revocation semantics.** A yank is an advisory; it
  does NOT invalidate the signature on the manifest of that version.
  Hosts that want hard revocation use `verify` mode `required` plus a
  trusted-keys edit per ADR-0010.

## Rationale

- **Why one ADR for three features?** They share the schema-evolution
  contract (additive over v2), the trust contract (per-publisher),
  and the same cross-check surface in
  `scripts/verify-official-addons.ts`. Splitting into three ADRs would
  triple the schema-version boundary discussion without changing any
  decision.
- **Why `history[]` instead of separate version files?** Inline keeps
  the gallery's existing one-fetch-per-publisher model. A consumer
  that does not care about history pays nothing — a v2 reader
  ignores the field. A consumer that does care does not need a
  second registry endpoint.
- **Why submissions live in a separate document, not in `index.json`?**
  Submissions are *churning* state (pending → needs-changes → … );
  the publisher's `index.json` is a slow-moving signed-manifest list.
  Mixing them would force the registry's mirror cache (the
  `apps/web/public/registry/official/index.json` baked into the host
  app) to refresh with every submission churn, which is the opposite
  of the goal.
- **Why audit and not "review"?** "Review" implies subjectivity. A
  publisher attesting "we audited this version" is the *narrowest*
  truth the publisher can say while remaining inside the per-publisher
  trust model. ADR-0017 already chose closed enums over free-form
  vocabularies for the same reason.
- **Why `endorsedBy[]` is just labels, not URLs to signed
  endorsements?** Signing an endorsement creates an aggregate-trust
  edge — the very thing ADR-0017 §"Alternatives" rejected for
  meta-indexes. A label is a hint for humans, not a trust input.

## Consequences

### Positive

- **Stable deep-links.** A blog post linking to `whiteboard@0.1.0`
  remains resolvable through the publisher's history after the head
  moves to `0.2.0`.
- **Visible vetting.** Publishers who actually audit their addons
  can show it. Publishers who do not, do not — the field stays
  optional.
- **Federated submissions without GitHub-only flows.** A publisher
  can run a static `submissions/index.json` from any host, including
  Nostr-relayed or IPFS-pinned URLs (per ADR-0007's vendor-neutrality
  stance), without depending on a particular forge.
- **No migration is forced.** A v2 publisher stays v2; the official
  registry can move to v3 in a follow-up at its own pace, just like
  it moved to v2.

### Negative / accepted costs

- **One more schema version to validate.** Mitigated by the additivity
  rule: every v3 field is optional, every v1/v2 reader keeps working.
- **`submissions/index.json` as a second public artefact.** Costs
  one new fetch path per publisher that opts in. The default gallery
  does not fetch submissions unless the user opens a "submissions"
  pane — out of scope for this ADR but the schema permits it.
- **Audit noise.** A publisher could ship `audit` for every entry
  with `auditor: "self"` and a 1-line `summary`. The schema cannot
  prevent this; the gallery's UI mitigates by showing the auditor
  label prominently so users can discount weak attestations.
- **Endorsement inflation.** A meta-index author could endorse every
  publisher. The label-only design means the only cost is visual
  noise; the trust chain is unaffected.

### Out of scope

- A "submissions" UI in `apps/addon-gallery`. The current gallery
  loads only `index.json`; submissions are a separate pane that a
  follow-up adds when at least one publisher actually ships
  `submissions/index.json`.
- Verifiable third-party audit attestations (signed by an auditor
  rather than the publisher). A future ADR may introduce them by
  pairing an audit document with its own signature; the v3 `audit`
  field is the publisher's own claim, full stop.

## Alternatives considered

- **Per-version separate registry files** (`addons/<id>/versions.json`
  per addon). Rejected: doubles the publisher's commit/sign workflow
  and the gallery's fetch fan-out, with no benefit over an inline
  array.
- **Ratings + reviews as first-class.** Rejected for the same reason
  ADR-0017 rejected open-vocabulary categories: the trust model
  forbids aggregate authority, and a reviews schema that is *not*
  trust-bearing is just opinions in JSON, which the web already
  has.
- **Submissions as PRs against the publisher's repo, with no schema.**
  This is the status quo (ADR-0016 §7). Rejected because it ties
  publishers to a specific forge (GitHub) and excludes
  static-file-only publishers (Nostr-pinned, IPFS-pinned) from a
  structured submission flow. The schema preserves vendor neutrality.
- **Bumping straight to v4 with reputation built in.** Rejected:
  reputation needs an aggregate-trust edge, which is the exact
  thing ADR-0007 forbids. Any future "reputation" ADR would have to
  resolve that tension first; v3 deliberately does not.

## References

- [ADR-0007](0007-vendor-neutral-signaling-and-relay.md) — vendor
  neutrality (the schema constraint that endorsements are decorative)
- [ADR-0008](0008-manifest-signing.md) — manifest signing (the trust
  boundary v3 inherits)
- [ADR-0010](0010-key-rotation.md) — key rotation (interaction with
  `history[]` published under retired keys)
- [ADR-0016](0016-addon-gallery.md) — gallery + install hand-off
  (consumes v3 history surfaces)
- [ADR-0017](0017-registry-schema-v2.md) — v2 schema, schema-evolution
  rule, meta-index design (extended in §3b)

## Implementation pointers

- `addons/official/README.md`: extend the schema reference table to
  list v3 fields with a `since` column.
- `scripts/verify-official-addons.ts`: extend the cross-check per §4.
- `apps/addon-gallery/src/main.ts`: a future PR adds a "history"
  drawer per card and an optional "submissions" pane gated on the
  presence of a `submissions/index.json` next to the publisher's
  `index.json`.
- `docs/adr/README.md`: add the index row for ADR-0020.
