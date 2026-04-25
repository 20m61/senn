# ADR 0019: Public npm publish pipeline

## Status

Accepted.

## Context

[ADR-0018](0018-addon-sdk-types.md) fixed the *shape* of
`@senn/addon-sdk` so that, on publish day, both monorepo consumers and
external add-on authors get the right files at the right paths. It
explicitly left the publish *pipeline* to a follow-up:

> §6 — Public npm publish stays out of scope. `private: true` stays for
> now. Publishing requires a public-readable npm scope, a version
> policy aligned with the SDK's semver story, and decisions on whether
> the runtime file ships as a binary asset or whether we sign it.

Today every workspace package is `private: true` at version `0.0.0`
(see `packages/*/package.json`). Three concrete gaps block external
authors:

1. **No installable artefact.** The cookbook and
   [writing-an-addon](../dev/writing-an-addon.md) tutorials assume
   readers can do `pnpm add -D @senn/addon-sdk`, but the package is
   not on npm. The only workaround today is `pnpm pack` from a local
   clone, which is fine for evaluation but not a supported authoring
   path.
2. **No version policy.** Every package is pinned at `0.0.0`. A
   downstream pinning `@senn/addon-sdk@0.0.0` cannot tell a renamed
   field from a deleted one — the version conveys no information.
   Without a stated policy we cannot promise SemVer compatibility.
3. **No release flow.** There is no documented sequence for "the SDK
   gained a new field, ship it." Tagging strategy, CI gating, and
   provenance are unspecified, so any first release is a one-off
   improvisation.

This ADR also has to make one Trust-Layer decision that ADR-0018
deferred: **whether the classic-script runtime gets its own signature
on publish**. The runtime is the file every add-on iframe loads
(`<script src="senn-addon-sdk.js">`) and the surface for the
postMessage bridge documented in [`addon-runtime-spec.md`](../addon-runtime-spec.md).
ADR-0008 covers manifest signing; the runtime sits one layer below.

## Decision

### 1. Publishable scope

Only **`@senn/addon-sdk`** is published in the first wave. Every other
workspace package stays `private: true`.

| Package | Publish in this ADR? | Reason |
|---------|---------------------|--------|
| `@senn/addon-sdk` | **Yes** | Add-on authors need it; ADR-0018 already pins the shape |
| `@senn/manifest` | No (stays private) | Sign / verify primitives — useful to publishers, but the API is in flux and ADR-0010 key rotation is unfinished |
| `@senn/protocol` | No | Internal type registry; consumed only via `@senn/addon-sdk` |
| `@senn/core`, `@senn/addon-runtime`, `@senn/storage`, `@senn/ui` | No | Host-application internals; no external authoring use case yet |
| `@senn/signaling-*` adapters | No | Adapters are consumed via SENN host applications, not direct npm install. Re-evaluate when ADR-0007 §"third-party adapters" lands |

Adding a package to this list later is an **additive** ADR, not a
breaking change to this one. Each new publishable package MUST land
under the same scope, version policy, and CI flow defined here.

### 2. Scope and registry

- Scope: **`@senn`** on the public npmjs.com registry.
- Access level: **`public`** (`npm publish --access public` is required;
  scoped packages default to private).
- Owner: the SENN Project npm organisation. The exact membership and
  recovery flow is operational (not technical) and lives in
  `docs/release.md`, not in this ADR.
- 2FA: every publisher account MUST enable npm 2FA at the auth-and-
  publish level. CI uses an automation token scoped to publish only
  under `@senn/`, configured with `npm publish --provenance`.

### 3. Version policy

- The package version follows [SemVer 2.0.0](https://semver.org/).
- The first published version is **`0.1.0`**, not `1.0.0`. The leading
  `0.` advertises that the API is still settling — minor bumps may
  carry breaking changes — which matches the current API maturity
  (see ADR-0018 "Out of scope: Rewriting the runtime in TypeScript",
  pending registry-side work in ADR-0017 §3).
- Within `0.x`:
  - PATCH (`0.1.0 → 0.1.1`): bug fixes, type docstring edits, ambient
    declaration tightenings that do **not** narrow an existing call
    site's allowed input types.
  - MINOR (`0.1.0 → 0.2.0`): additive surface (new fields on
    `SennAddonGlobal`, new event names in `SennAddonEventMap`), AND
    breaking changes that the maintainers judge worth the churn before
    `1.0.0`.
  - MAJOR (`0.x → 1.0.0`): graduation. Reserved until the runtime
    API has shipped at least one downstream-author release and the
    Trust-Layer registry (ADR-0017 v3) has stabilised.
- **The runtime classic-script and the type surface ship as one
  version.** They are pinned together by ADR-0018's package shape, so
  versioning them independently would re-introduce the drift that
  ADR-0018 set out to prevent.
- Pre-release tags (`0.2.0-rc.1`) are allowed for staged rollouts; a
  pre-release MUST publish under the npm dist-tag `next`, not `latest`.

The version field MUST be bumped in the same commit that lands a
shipped change, not at release time. A regression guard
(see §6) fails CI if the published version on npm matches a tag for
which the local `package.json` carries unreleased changes.

### 4. Runtime classic-script signing

**Decision: do not ship a separate signature for the published runtime
in the first wave; rely on npm provenance.**

Rationale:

- npm provenance (`npm publish --provenance`) attests the package
  contents to the GitHub Actions workflow run that built them, with a
  Sigstore-backed transparency log entry. That is the integrity claim
  external authors need: "this tarball came from
  `github.com/20m61/senn` at commit `<sha>` via the documented
  workflow." It does **not** require an SDK-specific signing key.
- The runtime is ALSO copied verbatim into every static add-on
  directory at build time
  (`apps/web/public/addons/<id>/senn-addon-sdk.js`). At that point it
  is covered by the add-on's own ADR-0008 manifest signature, because
  `manifest.json` enumerates the files served alongside it. The host
  verifies the manifest, the manifest fixes the file set; signing the
  runtime *file* a second time adds operational cost (key custody,
  rotation, revocation) for redundant integrity.
- Adding a runtime-specific signature is reversible: a future ADR may
  introduce a `runtime/senn-addon-sdk.sig.json` artefact published
  alongside the `.js` if a use case appears. We deliberately keep that
  door open by not consuming the path today.

Out of scope of this ADR but recorded so it is not forgotten: the
classic-script bytes that ship in the npm tarball MUST be the same
bytes that ship in `apps/web/public/addons/<id>/senn-addon-sdk.js` for
each official add-on at the same git ref. A regression guard
(see §6) enforces byte equality so `pnpm publish` cannot drift from
`pnpm build:addon-sdk`.

### 5. Release flow

The release is git-tag-driven, runs from `main`, and is gated by the
existing conformance workflow.

```
develop ──► PR ──► main
                    │
                    │  maintainer: bump packages/addon-sdk/package.json version,
                    │              add CHANGELOG entry, merge
                    │
                    ▼
              git tag addon-sdk-v0.2.0  (signed annotated tag)
                    │
                    ▼
        .github/workflows/publish-addon-sdk.yml
              │
              ├─ checks out the tagged ref
              ├─ pnpm install --frozen-lockfile
              ├─ pnpm typecheck   (builds dist/)
              ├─ pnpm verify:addon-sdk            (ADR-0018 contract)
              ├─ pnpm test                        (workspace vitest)
              ├─ pnpm lint
              ├─ verify package.json version === tag suffix
              ├─ verify dist/ matches the tag (no source drift)
              └─ pnpm publish --provenance --access public
```

Tag format: `addon-sdk-v<semver>`. The `addon-sdk-` prefix scopes the
tag namespace so future publishable packages (per §1's evolution
clause) can use `<package>-v<semver>` without collision. Plain
`v<semver>` tags are reserved for the host-application release train
(`apps/web`).

The workflow MUST:

- Run only on tag push matching `addon-sdk-v*`.
- Use `permissions: id-token: write, contents: read` so npm provenance
  can mint a Sigstore certificate.
- Fail closed if the tag does not exactly match
  `packages/addon-sdk/package.json#version`. (No "auto-correct"
  behaviour; mismatches are bugs.)
- Use the same Node 22 / pnpm 9.12.0 versions as `conformance.yml`, so
  the publish workflow does not introduce a new build matrix.

Hotfixes: a `0.2.1` patch follows the same path. There is no separate
"hotfix" branch — `develop → main` PR, version bump, tag.

### 6. Regression guards

Two new guards extend the existing `pnpm verify:addon-sdk`
(ADR-0018 contract). Both run in the `static` job of `conformance.yml`
on every push and PR, not only at release time:

a) **Version-bump guard.** If `packages/addon-sdk/dist/index.d.ts` or
the surface enumerated in ADR-0018 §4 changes between `develop` and
the merge base of `main`, the local `package.json#version` MUST differ
from the version currently on the npm `latest` dist-tag. The guard
fails with a message naming which file changed and what bump it
implies (PATCH/MINOR). If the package is not yet published, this guard
is a no-op.

b) **Runtime-byte-equality guard.** The bytes of
`packages/addon-sdk/runtime/senn-addon-sdk.js` MUST equal the bytes
shipped to every static add-on directory under
`apps/web/public/addons/*/senn-addon-sdk.js`. The existing
`pnpm build:addon-sdk` step in `conformance.yml` already enforces this
indirectly (it copies and then `git status --porcelain` fails on
drift); §6.b makes the byte-equality requirement *explicit* in
`pnpm verify:addon-sdk` so a future maintainer cannot remove the build
step without removing the contract too.

Both guards live in `scripts/verify-addon-sdk.ts` so the CI command
remains one invocation.

### 7. Deferred items

- **Other packages going public.** Each subsequent package that wants
  to publish files an additive ADR pointing at this one. The expected
  next candidate is `@senn/manifest` once ADR-0010 key rotation is
  implemented and the API is stable.
- **Runtime-specific signatures.** Re-evaluate if a host operator
  appears who serves `senn-addon-sdk.js` from a CDN out of band of any
  manifest. They would need to verify the runtime independently of any
  add-on; today no such operator exists.
- **Mirroring.** Vendor-neutrality (ADR-0007) suggests we MAY mirror
  releases to a non-npm registry (jsr, github packages) later. Out of
  scope for this ADR; the Decision §5 flow does not preclude it.
- **Removing `0.0.0` from non-published packages.** The remaining
  workspace packages keep `version: 0.0.0` and `private: true`. They
  are not consumed off-monorepo, so the version field has no meaning.
  When one publishes, that package's bump-to-`0.1.0` is part of the
  per-package ADR, not this one.

## Rationale

- **Why publish only the SDK first:** the SDK is the only package an
  external author *must* install to type-check their add-on. Every
  other package is consumed indirectly. Limiting the first publish
  wave reduces the surface of "we promised SemVer here" to one
  package, which is the surface ADR-0018 already pinned.
- **Why `0.1.0` not `1.0.0`:** the leading `0` is a SemVer-sanctioned
  signal that breaking changes are still allowed at MINOR bumps. We
  expect to land at least one (e.g., when ADR-0017 v3 introduces a
  new gallery interaction surface that the SDK reflects). Promising
  `1.x` stability today would force us to either ship a churny
  `2.0.0` shortly after or hold the SDK back.
- **Why npm provenance, not a SENN-Project signing key:** provenance
  attests *the build*, which is the property external authors care
  about. A signing key attests *the publisher*, which we already
  attest via the npm scope. Adding a key duplicates the trust claim
  while creating a new operational risk (key loss, rotation, etc.).
  ADR-0008 manifest signatures keep the sign / verify story for the
  add-on artefacts themselves, which is where vendor-neutrality
  matters.
- **Why one tag per package, prefixed:** the monorepo will eventually
  publish more than one package (per §7). A flat `v<semver>` tag space
  would make the tag log unreadable. The prefix is short, greppable,
  and scopes blast radius.
- **Why guards in `verify:addon-sdk` rather than the publish workflow
  alone:** running them only at publish time means a broken state can
  land on `develop` and only surface at release. Running them in
  `conformance.yml` keeps `develop` always-publishable.

## Consequences

### Positive

- Add-on authors run `pnpm add -D @senn/addon-sdk` and get typed
  `window.senn` without cloning the monorepo.
- The cookbook and writing-an-addon tutorials get a real install path
  to document — the `pnpm pack` workaround moves to a fallback note.
- Provenance gives downstreams a verifiable "this came from us" claim
  without operational key custody on our side.
- The release flow is documented and gated, so the first release is
  not a one-off ceremony.

### Negative / accepted costs

- A new GitHub Actions workflow and an npm automation token to manage.
  Mitigated by reusing the conformance Node / pnpm matrix and pinning
  the token's scope to `@senn/*`.
- Every release requires a manual version bump + tag. Deliberate: a
  human must sign off on the SemVer classification of each change.
- Two more regression guards in `verify:addon-sdk`. Both are short and
  the script already exists.
- `0.x` versioning means downstreams pinning `~0.1` are signing up for
  potential breaking changes at `0.2`. Documented in `docs/release.md`
  alongside the publish flow.

### Out of scope

- The SENN host application's release train (`apps/web` versioning,
  hosted deployments). The plain-`v<semver>` tag namespace is reserved
  for that, but the flow is a separate ADR.
- Backporting fixes to old majors. There are none yet; revisit at
  `1.0.0`.
- A "stable runtime, unstable types" split. ADR-0018 §"Two-part export
  surface" already binds them to one package; the version policy
  inherits that binding.
- Public publishing of `@senn/manifest`, `@senn/protocol`, or any
  other package — see §7.

## Implementation pointers

- `packages/addon-sdk/package.json`: drop `private: true`, set
  `version: "0.1.0"`, add `"publishConfig": { "access": "public",
  "provenance": true }`, add a `"repository.directory":
  "packages/addon-sdk"` field for npm deep-link UI.
- `.github/workflows/publish-addon-sdk.yml` (new): the flow described
  in §5. Trigger on `push.tags: ['addon-sdk-v*']`.
- `scripts/verify-addon-sdk.ts`: extend with the §6 (a) version-bump
  guard and (b) runtime-byte-equality guard.
- `docs/release.md` (new or extended): the operational runbook —
  who has publish rights, the bump-and-tag dance, rollback
  (`npm deprecate`).
- `docs/dev/writing-an-addon.md`: add a "Install" subsection pointing
  at `pnpm add -D @senn/addon-sdk` once the first version is live; the
  current tutorial leaves install implicit.
- `docs/adr/README.md`: add the index row for ADR-0019.
