# ADR 0025: Default signing tool for ADR-0023 vendor-neutral provenance

## Status

Accepted (2026-04-29). This ADR complements ADR-0023 — it does not supersede
it. ADR-0023 stays authoritative for the provenance surface, artefact format,
publication path, and verification protocol. This ADR concretises the one
choice ADR-0023 deliberately left open: which signing tool the maintainer uses
by default for the first signed `@senn/addon-sdk` release.

This ADR transitions to **Implemented** when the maintainer ships the first
signed release **and** fills in the `docs/governance.md` "Release signing
identities" table row — the same activation gate ADR-0023 sets for its own
Accepted → Implemented move.

## Context

ADR-0022 removed `publishConfig.provenance` from the `@senn/addon-sdk` publish
pipeline because npm's provenance flag requires an OIDC-capable CI runner
(GitHub Actions, GitLab CI, etc.), which would re-introduce the vendor
dependency that ADR-0021 and ADR-0022 eliminated. ADR-0023 filled that gap by
adding an OPTIONAL detached maintainer-signed artefact pair (`.sig` + `.cert`)
published to the GitHub Release, with `scripts/publish-addon-sdk.sh` already
wired to invoke whichever tool the maintainer selects via `SENN_SIGN_RELEASE`.

ADR-0023 §1 enumerated three candidate tools — cosign keypair mode, minisign,
and GPG — and explicitly left the choice open, stating that all three satisfy
the ADR-0007 vendor-neutrality principle: they run on a maintainer machine,
sign over arbitrary bytes, and can be verified without contacting any vendor
service. That openness was correct for the architectural decision. It is,
however, an operational blocker: because no release has yet been signed and the
maintainer has not committed to a tool, the `SENN_SIGN_RELEASE` path has never
been exercised. Every release falls through to the unsigned path, and the
`docs/governance.md` "Release signing identities" table (ADR-0023 §Implementation
pointers) holds only a placeholder row.

The choice between the three tools is not architectural; it is operational. The
vendor-neutrality bar (ADR-0007) and the single-blob attestation unit
(ADR-0023 §6) are already settled. What remains is choosing the tool that best
serves the maintainer's custody needs and the downstream verifier's ergonomics,
while preserving the ability to switch tools between release windows without any
spec change.

## Decision

**minisign** is the project default for the first signed `@senn/addon-sdk`
release. The maintainer MAY override this default with cosign keypair mode or
GPG (see §Overrides below); the override is recorded in the
`docs/governance.md` "Release signing identities" table for that release window,
not by amending this ADR.

Specifically:

1. **Default tool:** minisign. When `SENN_SIGN_RELEASE` is set by a maintainer
   who has not specified a preference, the documented default is `minisign`.
   `scripts/publish-addon-sdk.sh` already accepts all three values; no script
   change is required by this ADR.

2. **Governance table entry:** the `docs/governance.md` "Release signing
   identities" table's first row MUST list `minisign` in the Tool column and
   the maintainer's `*.pub` file content as the Identity / fingerprint column.
   This row is added in the same commit that runs the first signed release,
   per ADR-0023 §Implementation pointers.

3. **`SENN_SIGN_RELEASE` env contract:** the three-value contract
   (`cosign | minisign | gpg`) in `docs/dev/release.md` §"Vendor-neutral
   provenance (ADR-0023, opt-in)" is unchanged. This ADR decides only the
   default; it does not restrict the allowed values.

4. **No script change required:** `scripts/publish-addon-sdk.sh` already
   handles all three tools. This ADR introduces no code change.

5. **Per-release-window override:** the maintainer MAY switch from minisign to
   cosign or GPG for any release window, without amending this ADR. The active
   tool for each release window is recorded exclusively in the
   `docs/governance.md` table. Rotation of the signing key or tool follows the
   ADR-0010 pattern applied to the release-signing identity: announce the new
   tool and identity in the table before the first release that uses it, then
   close the previous row's "Active until" field.

6. **Verifier documentation:** `docs/dev/writing-an-addon.md` MUST gain an
   "Optional: verify the SDK tarball" subsection (foreshadowed by ADR-0023
   §Implementation pointers) showing the minisign verify command first, with
   cosign and GPG as alternatives. This documentation MUST land in the same
   commit as the first signed release, not with this ADR.

### Overrides: when to choose a different tool

The following are the documented conditions under which the maintainer SHOULD
override the minisign default:

- **Use cosign instead** when the downstream audience already runs Sigstore
  tooling and will plug the artefact into a Sigstore policy controller or
  cosign-based verification pipeline. The ADR-0023 `.cert` slot accepts a
  cosign certificate transparently; no protocol change is needed. Note that
  only cosign keypair mode (not keyless mode) satisfies the vendor-neutrality
  constraint: keyless mode requires OIDC and re-introduces a CI vendor
  dependency.

- **Use GPG instead** when the maintainer's existing trust graph
  (debian-archive-keyring, OpenPGP web-of-trust, key-signing parties) is the
  more reachable verification path for the downstream community. The ADR-0023
  `.cert` slot accepts an ASCII-armoured public key block. Be aware that GPG
  requires the verifier to `--import` the public key into a keyring before
  `--verify` works; this leaks state into verifier machines that the other two
  tools avoid.

## Rationale

### Verifier ergonomics

A downstream consumer needs to install one tool and run one command to
verify a tarball. Among the three candidates:

- **minisign** ships as a single static binary (~250 KB on all major
  platforms). Installation is `apt install minisign`, `brew install minisign`,
  or a direct binary download. The verification command is
  `minisign -V -p <pub> -m <tarball>` — one flag for the public key file, one
  flag for the file to verify. No state is written to disk; the public key
  file is supplied inline.
- **cosign** is a 50+ MB Go binary. In keypair mode the command is
  `cosign verify-blob --certificate <cert> --signature <sig> <tarball>`, which
  works but carries Sigstore certificate semantics (the `--certificate` flag
  expects a PEM certificate, and cosign's keypair mode wraps the public key in
  that envelope) that are unused here. Cosign optimises for container images
  and Sigstore transparency-log entries; single-tarball attestation is a
  secondary use case.
- **GPG** requires `gpg --import <pubkey>` before `gpg --verify <sig> <tgz>`
  works. The import writes into the verifier's keyring, which leaks state across
  unrelated operations and makes the verification command a two-step procedure.
  GPG optimises for long-lived correspondent identities and a web-of-trust
  model that provides no additional value for a single-blob attestation.

### Threat model fit

ADR-0023 §6 explicitly names "single-blob attestation" as the unit of work:
verifying that the tarball a downstream received from npm is byte-equal to the
tarball the maintainer signed. minisign is purpose-built for exactly that unit.
cosign and GPG are designed for richer threat models (container supply-chain
policy and web-of-trust identity graphs, respectively) and carry operational
overhead that does not reduce risk in the ADR-0023 scenario.

### Key custody alignment

ADR-0009's keystore minimum applies to the release-signing key. minisign stores
the signing material in a single `~/.minisign/minisign.key` file, passphrase-
protected with scrypt. This is the simplest possible custody surface consistent
with ADR-0009: one file, one passphrase, no daemon. cosign keypair mode is
comparable (`cosign.key` + `cosign.pub`); GPG ties the key to a long-lived
identity entry in a keyring, adding state management that is unnecessary for a
single-maintainer signing workflow.

### Reversibility

ADR-0023 §6 already states the maintainer MAY switch tools per release window
without changing the verification protocol shape. Choosing minisign as the
project default is therefore a low-cost, low-risk decision: if a future
maintainer or release window calls for cosign or GPG, the ADR-0010 rotation
pattern applies unchanged, and this ADR is not amended — the
`docs/governance.md` table records the transition. The decision is operationally
reversible at the cost of one governance-table commit and any downstream verifier
re-tooling (which is bounded by the small number of consumers who opt into
provenance verification at all).

## Consequences

### Positive

- The `docs/governance.md` "Release signing identities" table gains a concrete
  first row in the same commit as the first signed release, unblocking
  ADR-0023's own Proposed → Accepted transition.
- Downstream verifiers face the smallest possible installation footprint: one
  static binary, one command, no keyring state.
- The `SENN_SIGN_RELEASE=minisign` path in `scripts/publish-addon-sdk.sh` is
  exercised on the first signed release, proving the opt-in scaffold from
  ADR-0023's implementation status.
- Future maintainers have a documented rationale and documented override
  conditions, rather than an undifferentiated three-way choice.

### Negative

- Downstream verifiers who already have cosign or GPG installed but not
  minisign must install one additional binary. Mitigated by: minisign's
  install is a single package-manager invocation on all major platforms; the
  provenance check is OPTIONAL per ADR-0023; and the alternative verification
  commands (cosign, GPG) are documented in `docs/dev/writing-an-addon.md`
  once the first signed release ships.
- If the maintainer later switches to cosign or GPG, existing verifier scripts
  built against the minisign command shape will require updating. Mitigated by:
  the `docs/governance.md` table announces the change before the first release
  that uses the new tool, and ADR-0023's verification protocol shape (three
  companion files, SHA-256 equality check) is tool-independent.

### Neutral / follow-up

- The `docs/dev/writing-an-addon.md` "Optional: verify the SDK tarball"
  subsection (minisign first, cosign and GPG as alternatives) is a separate
  deliverable, gated on the first signed release, not on this ADR.
- Whether to use `minisign -V -P <pub-text>` (inline public-key flag) instead
  of `-p <pub-file>` is an implementation detail deferred to the maintainer's
  operational preference at publish time.
- This ADR does not change the optional nature of signing. ADR-0023 §6's
  "signing is OPTIONAL" clause stands; promotion to MUST is a future ADR.
- The cosign / minisign / GPG trio is not re-evaluated against fresh tooling by
  this ADR. ADR-0007 and ADR-0023 already pinned the vendor-neutrality bar;
  this ADR picks a default within that bar.
- Mandatory signing on every release remains out of scope. ADR-0023 §6
  explicitly defers that to a future amendment gated on downstream demand.

## Related

- ADR-0007: vendor-neutral signaling and relay — establishes the vendor-
  neutrality principle this ADR applies to the signing-tool selection.
- ADR-0008: manifest signing — a separate signing surface (add-on manifests,
  not the SDK tarball). Do not conflate; different keys, different verification
  paths.
- ADR-0009: keystore minimum — applies to the release-signing key. minisign's
  single-file, passphrase-protected custody is consistent with the ADR-0009
  discipline.
- ADR-0010: key rotation — the rotation procedure for the release-signing
  identity. Applies identically regardless of whether the active tool is
  minisign, cosign, or GPG.
- ADR-0022: local-first publish pipeline — removed npm OIDC provenance and
  established `scripts/publish-addon-sdk.sh` as the publish source of truth.
  ADR-0023 and this ADR layer on top without changing the publish flow.
- ADR-0023: vendor-neutral provenance for `@senn/addon-sdk` releases — the
  surface this ADR concretises. The artefact format (`.sig` + `.cert`),
  publication surface (GitHub Release), and verification protocol are defined
  there; this ADR decides only the default tool.
- `docs/governance.md` §"Release signing identities (ADR-0023)" — the table
  this ADR populates with a first row on the first signed release.
- `docs/dev/release.md` §"Vendor-neutral provenance (ADR-0023, opt-in)" — the
  `SENN_SIGN_RELEASE=cosign | minisign | gpg` env contract, which this ADR
  leaves unchanged.
