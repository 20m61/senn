# ADR 0023: Vendor-neutral provenance for `@senn/addon-sdk` releases

## Status

Proposed (2026-04-27). Re-opens the integrity-surface question that
ADR-0022 §"npm provenance" deliberately closed by removing
`publishConfig.provenance`. ADR-0022 stays authoritative for the
publish *flow*; this ADR adds an OPTIONAL, vendor-neutral provenance
artefact that downstream consumers can verify without trusting any CI
runner.

> **Scope rename note (2026-04-30):** the package was renamed from
> `@senn/addon-sdk` to `@sennjs/addon-sdk` per
> [ADR-0019 §2 amendment](0019-publish-pipeline.md) (both
> `package.json#name` and the npm-published name flipped). Wherever
> this ADR cites `@senn/addon-sdk@<semver>` in consumer commands
> (`npm pack`, registry URL), substitute `@sennjs/addon-sdk@<semver>`.
> The integrity story (sigstore-attached `.sig`/`.cert` artefacts on
> the GitHub Release) is unchanged.

## Context

ADR-0022 moved the npm publish flow off GitHub Actions and onto a
local maintainer machine (`scripts/publish-addon-sdk.sh`). That move
forced one trade: the `npm publish --provenance` flag requires an
OIDC-capable CI runner (Sigstore mints the certificate against a
GitHub Actions / GitLab CI / etc. workload identity), and removing
the workflow removed the only way to mint an npm provenance
attestation.

ADR-0022 §"npm provenance" justified the trade by listing the two
substitute integrity surfaces SENN already ships:

1. The maintainer-signed annotated git tag (`addon-sdk-v<semver>`).
2. ADR-0008 manifest signatures, which cover the runtime byte-equally
   inside every official add-on directory at runtime.

Both are real surfaces, but neither attests the **npm tarball
itself**. A downstream that pulls `@sennjs/addon-sdk@0.1.0` from npm
into a non-SENN context (e.g., a third-party authoring tool that
ships SENN add-ons but is not itself a SENN host) cannot verify "this
tarball was built from the canonical repo at the named tag" without
re-running the publish script and comparing hashes.

That gap is small for the current `@senn/addon-sdk` consumer profile
(SENN add-on authors, who already trust the SENN host's manifest
verifier). But it grows as the ecosystem grows — security-conscious
downstream packages, distributors, and SBOM consumers will ask for an
attestation surface, and "trust the maintainer's git tag" is harder
to consume programmatically than a Sigstore log entry.

The principle from ADR-0007 (vendor-neutral signaling and relay) and
ADR-0021 / ADR-0022 (vendor-neutral CI / publish) directly applies:
**provenance MUST NOT depend on a single CI vendor's identity
service.** Sigstore-via-Actions binds provenance to GitHub; we want
an option that does not.

## Decision

Add an OPTIONAL maintainer-signed blob alongside each
`@senn/addon-sdk` npm release. The publish script
(`scripts/publish-addon-sdk.sh`) MAY produce it; downstreams MAY
verify it; neither side is required to use it. If the maintainer
chooses to sign, the artefact is published to the GitHub Releases
page for the corresponding tag and referenced from the npm
package's `homepage` README install section, not from npm itself.

Specifically:

### 1. Artefact format

For each released tag `addon-sdk-v<semver>`, the maintainer MAY
publish three files to the GitHub Release for that tag:

- `senn-addon-sdk-<semver>.tgz` — the exact bytes that
  `pnpm pack` produced and `pnpm publish` uploaded. Identical to the
  npm tarball at the same version (re-uploaded so verifiers do not
  have to depend on npm's tarball-hosting URL pattern).
- `senn-addon-sdk-<semver>.tgz.sig` — a detached signature over the
  tarball bytes, produced by **`cosign sign-blob`** (Sigstore CLI;
  vendor-neutral — works locally with a maintainer keypair, no OIDC
  workload identity required) **OR** a minisign / `gpg --detach-sign`
  signature, at the maintainer's discretion.
- `senn-addon-sdk-<semver>.tgz.cert` — the public verification
  artefact (cosign certificate, minisign public key reference, or
  ASCII-armoured GPG public key). The fingerprint MUST be published
  in the SENN governance docs (`docs/governance.md`) ahead of the
  first signed release.

The choice of signing tool is left open by this ADR because all three
(cosign keypair mode, minisign, GPG) satisfy the vendor-neutrality
principle: they run on a maintainer machine, sign over arbitrary
bytes, and can be verified without contacting any vendor service.

### 2. Publication surface

Provenance artefacts are published to the **GitHub Release** for
the tag, not to npm. Two reasons:

- The npm registry's provenance fields are tightly coupled to the
  Sigstore-via-OIDC flow (`npm publish --provenance` rejects
  externally-supplied attestations). Trying to ride those fields
  without an OIDC-capable CI runner would either fail or require
  workarounds that re-introduce the vendor dependency this ADR
  removes.
- GitHub Releases is a static-file-hosting surface tied to the
  annotated tag; verifiers need the tag anyway (per ADR-0022 §3) and
  the Release page is the natural place to discover companion files.

If GitHub Releases later becomes unavailable for the project, the
artefacts MAY mirror to any static host — the verification path does
not depend on GitHub serving them.

### 3. Verification path

A downstream that wants to verify a published `@senn/addon-sdk`
tarball follows this path:

1. `npm pack @sennjs/addon-sdk@<semver>` (or download from
   https://registry.npmjs.org/@sennjs/addon-sdk/-/addon-sdk-<semver>.tgz).
2. Compute the local SHA-256 of the tarball bytes.
3. Download the matching `senn-addon-sdk-<semver>.tgz` from the
   GitHub Release for `addon-sdk-v<semver>`, compute its SHA-256, and
   confirm equality with step 2.
4. Download the `.sig` and `.cert` companions.
5. Run the verifier matching the chosen signing tool:
   - `cosign verify-blob --certificate <cert> --signature <sig> <tgz>`
   - `minisign -V -p <pubkey> -m <tgz>`
   - `gpg --verify <sig> <tgz>` (after importing the public key).
6. Cross-check the certificate / public key fingerprint against
   `docs/governance.md` to confirm the signing identity.

A failing verification SHOULD be treated as a publication accident
(maintainer failed to sign, signed the wrong file, or the npm tarball
diverged from the GitHub Release artefact) — not yet as a positive
indicator of compromise, until the artefact has been required for
several releases and downstream tooling has stabilised.

### 4. Script integration

`scripts/publish-addon-sdk.sh` MAY be extended to invoke the chosen
signing tool after `pnpm publish` succeeds, with the produced
`.sig` / `.cert` files staged for upload to the GitHub Release. This
ADR does NOT require that integration in the first wave: the
maintainer MAY sign and upload manually. If the integration lands,
it MUST be opt-in via an env flag (e.g., `SENN_SIGN_RELEASE=cosign`)
so the publish script's default behaviour stays vendor-neutral *and*
zero-dependency.

If the maintainer does not enable signing, downstreams continue to
rely on the two integrity surfaces ADR-0022 already lists (annotated
tag, ADR-0008 manifest signatures). No regression.

### 5. Expanding to other published packages

When ADR-0019 §1's "additive ADR per published package" path lands a
new publishable package, the per-package ADR MUST decide whether the
provenance artefact applies. The decision SHOULD default to "yes"
once the signing toolchain has shipped at least one release, so that
the trust surface is uniform across all `@senn` packages.

### 6. Out of scope

- Mandatory signing on every release. This ADR keeps signing
  optional; promotion to MUST is a future ADR amendment, gated on
  downstream demand.
- A SENN-Project signing keystore on shared infrastructure. The
  maintainer's local key is the trust root; key rotation follows the
  ADR-0010 pattern (announce the new key in `docs/governance.md`,
  cross-sign the old key for one release window, retire).
- Re-signing past releases. Each release stands on the integrity
  surface in force at its time; ADR-0008 manifest signing already
  covers the runtime in application use.
- npm registry-level provenance. As noted in §2, the npm provenance
  fields are not a viable surface for vendor-neutral attestations.

## Rationale

- **Why cosign / minisign / GPG and not pick one:** all three meet
  the vendor-neutrality test (no OIDC runner, no vendor service,
  verification works offline against a published key). Picking one
  would force a maintainer-tooling choice that has nothing to do with
  the spec; the choice can shift between releases without affecting
  the verification protocol (file shapes, publication surface,
  fingerprint cross-check).
- **Why GitHub Releases for publication:** it is the static-file
  surface most tightly coupled to the annotated tag downstreams
  already need to reach. It is not a *trust* dependency — verification
  works against any mirror — but it is the ergonomic default for
  discovery. If we move off GitHub Releases later, the verification
  protocol does not change.
- **Why optional, not mandatory:** the trust surfaces ADR-0022 listed
  are real and sufficient for the current consumer profile. Forcing
  signing on the first SDK release would block the publish on a
  toolchain decision the maintainer has not yet made; making it
  optional lets the publish ship on ADR-0022's terms while leaving
  ADR-0023 ready to activate.
- **Why fingerprint in governance.md and not in the ADR itself:** the
  fingerprint is operational data that rotates per ADR-0010. Encoding
  it in an ADR would require an ADR amendment per rotation, which is
  the wrong cadence.

## Consequences

### Positive

- Downstream consumers MAY verify `@senn/addon-sdk` tarballs against
  a maintainer signature without trusting npm's provenance system or
  any single CI vendor.
- The integrity surface stays vendor-neutral: maintainers may switch
  signing tools (cosign ↔ minisign ↔ GPG) without changing the
  verification protocol's shape.
- Forks that prefer a different release-hosting surface (Codeberg,
  Forgejo, Gitea Releases, plain object-storage mirror) inherit the
  same protocol with no spec change.

### Negative / accepted costs

- One more file pair (`.sig` + `.cert`) to upload per signed release.
  Mitigated by §4's opt-in script integration, once it lands.
- Verifiers must perform a two-step lookup (npm tarball ↔ GitHub
  Release tarball) to confirm equality before checking the signature.
  Acceptable: the SHA-256 comparison is one-line and the alternative
  (npm-side provenance) is structurally vendor-bound.
- Key custody on the maintainer machine. ADR-0009 already governs
  manifest-signing keys; the same custody discipline applies here.

### Out of scope

- npm-side attestation reform. If npm later supports
  externally-supplied provenance (not OIDC-bound), this ADR MAY be
  amended to publish `.sig`/`.cert` to npm too — until then, GitHub
  Releases (or the chosen mirror) is the publication surface.
- Sigstore transparency-log entries via cosign keyless mode. Keyless
  mode requires OIDC and re-introduces the vendor dependency; only
  cosign keypair mode satisfies the constraint.
- Reproducible-builds attestations beyond byte-for-byte equality of
  the npm tarball and the GitHub Release tarball. Reproducibility of
  the **runtime classic-script** is already enforced by
  `pnpm verify:addon-sdk` (ADR-0019 §6.b); per-tarball reproducibility
  across machines is a separate property and is not in scope here.

## Implementation pointers

- `docs/governance.md` (extend): a new "Release signing identities"
  subsection enumerating the maintainer fingerprint(s), key rotation
  procedure (ADR-0010 pattern), and the chosen signing tool for each
  release window.
- `scripts/publish-addon-sdk.sh` (optional extension): invoke the
  signing tool gated on `SENN_SIGN_RELEASE` env (`cosign` |
  `minisign` | `gpg`), produce `<tarball>.sig` and `<tarball>.cert`,
  print the upload checklist for the GitHub Release.
- `docs/dev/release.md` (extend): a new "Release-signing checklist"
  subsection between the `pnpm release:addon-sdk` runbook and the
  pre-release subsection. Lists the three companion files, the
  GitHub Release upload step, and the verification command.
- `docs/dev/writing-an-addon.md` (extend, when first signed release
  ships): an "Optional: verify the SDK tarball" subsection showing
  the cosign / minisign / gpg verify commands.
- `docs/adr/README.md`: index row added for ADR-0023.

## Implementation status

§4's opt-in scaffold ships in the publish script and the release
docs (no ADR amendment needed — the ADR explicitly framed this as
a "MAY land in a follow-up"):

- `scripts/publish-addon-sdk.sh` reads `SENN_SIGN_RELEASE`,
  `SENN_SIGN_KEY`, and (for minisign) `SENN_SIGN_PUBKEY`. When unset
  the publish flow is byte-identical to ADR-0022. When set it stages
  `senn-addon-sdk-<v>.tgz`, `.sig`, `.cert` under `dist/release/`
  for manual upload to the GitHub Release.
- `docs/dev/release.md` documents the env contract under "Vendor-
  neutral provenance (ADR-0023, opt-in)".
- `docs/governance.md` ships a "Release signing identities" table
  with one placeholder row pending the maintainer's first signed
  release; activation requires committing the chosen tool and
  fingerprint into that table in the same commit that runs the
  first signed release.

The ADR stays Proposed until the maintainer ships a signed release
and demonstrates the verify path against the table — at that point
a follow-up commit transitions Status to Accepted (per the SENN
governance policy that Status changes are maintainer-only).

## Related

- ADR-0007: vendor-neutral signaling and relay — same principle
  applied to a different layer.
- ADR-0008: manifest signing — establishes the SENN signing /
  verifying primitives the maintainer toolchain reuses.
- ADR-0009: keystore minimum — applies to the release-signing key as
  well as the manifest-signing key.
- ADR-0010: key rotation — the rotation procedure the
  release-signing key follows.
- ADR-0019: public npm publish pipeline — §4 explained why we do
  not sign the runtime classic-script separately; this ADR
  complements that by signing the **tarball** instead.
- ADR-0022: local-first publish pipeline — removed npm OIDC
  provenance; this ADR re-introduces a provenance surface that does
  not depend on any CI vendor.
