# ADR 0017: Registry schema v2 — categorisation, deprecation, meta-registries

## Status

Implemented (2026-04-26). Schema v2 shipped as `addons/official/index.json`
(now bumped to v3 by ADR-0020), the publisher meta-index
`addons/official/meta.json`, the registry validators under `scripts/`,
and the categorisation / deprecation surface in `apps/addon-gallery/`.
ADR-0020 supersedes v2 fields with an additive v3 (history, submissions,
audits); the v2 contract remains the floor that v3 extends.

## Context

The current publisher registry shape (`v: 1`) is documented in
[`addons/official/README.md`](../../addons/official/README.md):

```ts
interface OfficialRegistryV1 {
  readonly v: 1;
  readonly publisher: { readonly name: string; readonly homepage?: string };
  readonly trustedKeys: readonly string[];
  readonly addons: readonly OfficialRegistryAddonV1[];
}

interface OfficialRegistryAddonV1 {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly path: string;
  readonly capabilities: readonly string[];
}
```

Three concrete gaps surfaced once
[ADR-0016](0016-addon-gallery.md) landed:

1. **No browsing structure.** With seven entries the gallery's free-text
   filter is fine; with seventy it is not. Users want to drill into
   "communication", "creative", "games" without typing a substring.
2. **No supersession story.** `whiteboard@0.1.0` may be replaced by
   `whiteboard@0.2.0`, or by an entirely different add-on id. Today the
   registry just lists current entries; old ones quietly fall off and
   anyone holding a deep link gets a confusing 404 or a sneakily
   rebuilt manifest. There is no machine-readable "this is deprecated,
   use that instead" signal.
3. **No multi-publisher seeding.** ADR-0016 §3 says the gallery accepts
   a list of registry URLs and §7 explicitly defers community
   meta-registries. But the gallery still needs a *default* seed, and
   today that seed is hard-coded as one URL. A SENN deployment that
   wants to ship with multiple publishers pre-trusted has nowhere
   structured to express that.

The
[Charter](../charter.md) Trust-Layer principle and
[ecosystem-business-model](../ecosystem-business-model.md) "Verified
Add-on Registry" both depend on third-party publishers participating
without forking SENN. That is awkward today because (a) the schema
has no extension points and (b) there is no published meta-shape for
"a list of publishers".

This ADR fixes both gaps as **additive**, schema-versioned changes —
no v1 deployment is invalidated.

## Decision

### 1. Registry v2 — additive fields

Define `OfficialRegistryV2` (the name is keyed off "official" only by
convention; the same shape is the canonical publisher index for any
publisher). Differences from v1 are all **optional** add-on fields:

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

  // new, all optional
  readonly categories?: readonly RegistryCategory[];
  readonly tags?: readonly string[];
  readonly deprecated?: AddonDeprecationV1;
}

interface AddonDeprecationV1 {
  readonly since: string;             // ISO-8601 instant
  readonly reason: string;            // human-readable, ≤ 280 chars
  readonly supersededBy?: string;     // another addon id, ideally same publisher
}

type RegistryCategory =
  | "communication"
  | "creative"
  | "productivity"
  | "presence"
  | "files"
  | "games"
  | "education"
  | "accessibility"
  | "developer-tools"
  | "other";
```

Rules:

- `categories` is a **closed enum** (the union above). Closed because a
  free-form list devolves into noise across publishers; the gallery
  needs a small, comparable surface for filter chips. The list is
  intentionally broad and "other" catches anything that does not fit.
  Adding a category is an ADR amendment — that's fine, the union grows
  rarely and additively.
- `tags` is **free-form, lowercased, kebab-case**, max 8 per addon, max
  32 chars each. Validated for shape only; semantics belong to the
  publisher.
- `deprecated.supersededBy` SHOULD point to another addon id in the
  same registry. Pointing across registries is allowed but cannot be
  validated locally; tools MAY warn.

### 2. Schema evolution rule

A registry MUST set `v` to either `1` or `2`. Validators MUST accept
both:

- Reading v1 → treat all new fields as `undefined` / empty.
- Reading v2 → treat all new fields as optional (already optional in
  the schema).

A v2 emitter MAY include addons that lack any of the new fields; that
is equivalent to a v1 emitter for those entries. **No registry is ever
forced to upgrade.** The official registry will move to v2 in the
implementation follow-up; downstream forks do not have to.

The `cross-check` in `scripts/verify-official-addons.ts` extends to
include the new optional fields (when present, they MUST be valid per
the rules above) but does NOT require them.

### 3. Meta-registry — an index of publisher indexes

For deployments that want to seed the gallery with multiple
publishers without hard-coding URLs, define a separate small schema:

```ts
interface PublisherMetaIndexV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-meta";  // discriminator
  readonly publishers: readonly PublisherEntryV1[];
}

interface PublisherEntryV1 {
  readonly url: string;        // absolute URL of the publisher's index.json
  readonly name?: string;      // human label; optional, fetched index also has one
  readonly featured?: boolean; // hint for the gallery to surface this entry first
}
```

The meta-index is an **unsigned**, **non-trust-bearing** document. It
is metadata pointing at trust roots; the trust still resides in each
publisher's `trustedKeys`. The gallery, after fetching a meta-index,
fetches every publisher index inside it and re-verifies every signed
manifest as it does today (ADR-0016 §2). The meta-index never adds
trust — it merely shortens the discovery path.

A SENN deployment MAY ship its own meta-index URL as the gallery's
default seed; it MAY ship none at all (in which case the gallery's
default remains "current origin's `/registry/official/index.json`" as
documented in ADR-0016).

### 4. What this ADR does NOT decide

- **Submission flow.** Out of scope; remains "open a PR against the
  publisher's repo" per ADR-0016 §7.
- **Reviews / ratings / reputation.** Out of scope.
- **Per-version histories.** v2 still lists *current* version per
  addon. Multi-version listings, changelog feeds, and supersession
  chains spanning multiple ids are deferred until a concrete need
  shows up.
- **Cross-publisher trust delegation.** Each publisher remains the
  authority over its own `trustedKeys`. There is no "trust X because
  Y trusts X" relationship in the schema. ADR-0010 (key rotation)
  governs in-publisher key churn.

## Consequences

- **Backward compatible.** A v1 reader can ignore v2 fields; a v2
  reader can produce v1-shaped output by omitting new fields. Hosts
  that rely on the registry mirror at `/registry/official/index.json`
  keep working unchanged.
- The official registry becomes the worked reference for v2 in the
  follow-up implementation, with `categories` set on each shipped
  add-on (e.g. `whiteboard → ["creative"]`, `voice-call → ["communication"]`,
  `local-vault → ["files"]`).
- The gallery gains: category filter chips, a "deprecated"/"superseded"
  badge that links to the replacement, and (optionally) a meta-index
  loader pre-seeding multiple publishers.
- `scripts/verify-official-addons.ts` extends to validate the new
  optional fields when present and to cross-check that
  `deprecated.supersededBy` (when set) refers to an id in the same
  registry.
- A new `addons/official/meta.json` (if shipped) becomes a second
  public artifact alongside `index.json`; absent, nothing changes.

## Alternatives considered

- **Open-vocabulary categories.** Rejected: leads to "communication"
  vs. "Communication" vs. "comms" vs. "messaging" splits across
  publishers. The closed enum costs an occasional ADR amendment and
  buys a clean filter UX.
- **Deprecation as a separate file (`addons/official/deprecations.json`).**
  Rejected: doubles the conformance surface (sign? not sign?) and
  forces clients to fetch a second resource. Inline in v2 is one
  additional optional field per affected entry.
- **Meta-registry that also pins keys** (signed at the meta layer).
  Rejected: would create a meta-publisher with implicit authority
  over all listed publishers — incompatible with ADR-0007's
  vendor-neutrality and confusing about *whose* trust root applies.
  The meta-index stays a pointer document; trust stays per-publisher.
- **Bumping straight to v3 with submission/review baked in.**
  Rejected: speculative work. v2 is the smallest schema move that
  fixes today's gaps; submission can land later as v3 without
  invalidating anything.

## References

- [ADR-0007](0007-vendor-neutral-signaling-and-relay.md) — vendor
  neutrality; meta-index design preserves it
- [ADR-0008](0008-manifest-signing.md) / [ADR-0009](0009-keystore-minimum.md) /
  [ADR-0010](0010-key-rotation.md) — signing and key rotation
- [ADR-0016](0016-addon-gallery.md) — gallery contract, multi-registry
  aggregation, install hand-off
- [`addons/official/README.md`](../../addons/official/README.md) — v1
  schema reference
- [`docs/roadmap.md`](../roadmap.md) — Phase 4 "registry prototype"
