# ADR 0029: Secondary maintainer and key custody

## Status

Proposed (2026-05-01)

## Context

SENN is currently a single-maintainer pre-alpha project. The bootstrap
maintainer (`20m61`) is the sole holder of three distinct secrets whose
combined loss or unavailability would block every future signed release:

1. **Official add-on signing key** — an Ed25519 keypair used to sign every
   add-on in `addons/official/`. Custody: `~/.config/senn/senn-official.key.json`
   on the bootstrap maintainer's workstation, per `docs/governance.md` §"Holders"
   and ADR-0009.

2. **npm publish identity** for `@sennjs/addon-sdk` — a granular access token
   (bypass-2FA) scoped to the `@sennjs` organization. Current token expiry:
   2026-07-26. Rotation procedure: `docs/dev/release.md` §"Token rotation",
   adopted by ADR-0022.

3. **Minisign release-signing key** — the private key (nominally
   `~/.minisign/sennjs-addon-sdk.key`) whose corresponding public key ships in
   `docs/release-keys/sennjs-addon-sdk.pub`. Generated when the first signed
   `addon-sdk` release ships per ADR-0023 and ADR-0025.

The key-rotation procedure in ADR-0010 (planned + emergency rotation) presupposes
that the bootstrap maintainer is alive and reachable. It explicitly does not cover
the scenario in which the maintainer is permanently unavailable. This gap was
acknowledged in `docs/security-model.md` §"Single-maintainer key custody" (lines
287–303) as an accepted operational risk for pre-alpha, and deferred to a future
ADR. The `docs/roadmap.md` §"Maintainer-gated" line (item "Secondary maintainer /
key escrow") records the gap as not yet ADR-tracked and recommends an offline
backup in the interim.

`docs/governance.md` §"Adding a registry maintainer" and §"Removing a registry
maintainer" already specify the mechanical procedure for managing a second
maintainer's add-on signing key. What is missing is the **policy** decision about:

- whether to adopt third-party key escrow or threshold signing at this stage;
- what offline-backup obligations apply to all three secrets (not just the
  add-on signing key);
- when to begin actively recruiting a second maintainer;
- what recovery steps are available — and what is irrecoverably lost — if the
  bootstrap maintainer is permanently unreachable.

ADR-0007 (vendor-neutral signaling) establishes a project-wide principle that SENN
MUST NOT take a normative dependency on a specific external service or vendor.
The same principle applies to key custody: deferring project continuity to a named
third-party escrow service trades one single point of failure for a different one
with weaker custody guarantees from SENN's perspective.

## Decision

SENN defers third-party key escrow and M-of-N threshold signing to a future
revision. Until that revision ships or a second qualified maintainer joins,
the following normative requirements apply.

### 1. No third-party escrow service for v1

SENN MUST NOT adopt a hosted key escrow service (for example, a cloud secret
manager, a hosted Vault instance, or a Shamir-secret-sharing service) as a
normatively required step in the custody chain for any of the three secrets
named in §Context.

**Rationale.** A hosted escrow service introduces a new trust root outside the
project's control. Its continued availability, privacy posture, and audit stance
are each a single point of failure that is harder for the project to observe than
the loss of a local workstation. ADR-0007's vendor-neutrality principle — applied
here to custody rather than to signaling — argues for keeping the trust root at
the maintainer's own workstation until a second human is available to share
custody. A hardware token in a personal safe deposit box (see §Alternatives) is a
valid informal complement to this requirement; this ADR does not normatively
require it.

Similarly, M-of-N threshold signing schemes (such as TUF multi-party signing or
Sigstore's cosign keyless flow) are deferred. They do not address the npm publish
identity or trademark/legal ownership, and their operational overhead is not
proportional to a pre-alpha project with a single contributor.

### 2. Mandatory offline backup

The bootstrap maintainer MUST maintain an offline encrypted backup of all three
secrets. Each backup MUST satisfy all of the following:

a. **Scope.** The backup MUST cover: (i) the official add-on signing keypair
   (`senn-official.key.json` or equivalent), (ii) a copy of the npm publish
   token or the procedure and credentials needed to regenerate it after the
   current token expires, and (iii) the minisign private key once it is
   generated per ADR-0023.

b. **Encryption.** The backup MUST be encrypted at rest. Acceptable formats
   include but are not limited to: `age`-encrypted files, a `gocryptfs`
   volume, or a password-manager attachment with a strong master credential.
   Unencrypted copies on any network-accessible storage are forbidden.

c. **Storage constraints.** The backup MUST NOT reside on:
   - Any cloud storage service (including provider-managed device backups),
   - Any CI/CD system secret store or pipeline environment variable,
   - Any third-party service, hosted wallet, or SaaS password vault not under
     the maintainer's exclusive control.
   The backup MUST reside on physical media or a locally-controlled encrypted
   volume that is offline when not in use.

d. **Verification cadence.** The maintainer SHOULD verify that the backup is
   restorable at least once per calendar year, and MUST re-verify after any
   key rotation triggered by ADR-0010.

### 3. Secondary-maintainer recruitment

The bootstrap maintainer SHOULD make recruiting a second qualified maintainer an
active priority once the project ships its first non-pre-alpha package release (the
gate event is: any package in the monorepo is tagged at a v1.0.x or higher semver).

"Qualified" for the purpose of this ADR means: capable of executing the
`docs/dev/release.md` publish pipeline independently, willing to generate and
hold their own add-on signing keypair per `docs/governance.md` §"Adding a registry
maintainer", and in a position to receive a separate npm granular access token
scoped to `@sennjs`.

This ADR does not set an absolute recruitment deadline. The gate event above is
the earliest point at which the absence of a second maintainer becomes a release
risk rather than merely an operational risk.

Once a second maintainer joins, a follow-up ADR MUST be opened (or this ADR MUST
be revised) to address shared custody of the npm publish identity and the
minisign release-signing key, which are NOT covered by the existing
`docs/governance.md` §"Adding a registry maintainer" mechanical procedure (that
procedure addresses only the add-on signing keypair).

### 4. Bus-factor-zero recovery procedure (placeholder)

If the bootstrap maintainer is permanently unreachable, no automated recovery
path exists at the current project stage. The following describes the available
options and their limits:

a. **Repository and trademark.** GitHub repository admin rights and any SENN
   trademark registrations are under the bootstrap maintainer's personal account.
   Recovery requires a GitHub support escalation (`https://support.github.com`)
   and, if applicable, a trademark transfer proceeding. Both have non-trivial
   timelines and are not guaranteed to succeed. The project consciously accepts
   that this scenario results in at minimum a significant continuity gap.

b. **npm package recovery.** The `@sennjs/addon-sdk` package can be transferred
   to a new maintainer's npm account via the npm package-recovery process at
   `https://www.npmjs.com/package-recovery`. This process requires demonstrating
   either GitHub repository control (see above) or sufficient ownership evidence.
   If repository admin rights are recoverable, npm transfer is likely achievable
   subsequently.

c. **Official add-on signing key.** Without the bootstrap maintainer's private
   key, new official add-ons cannot be signed under the existing trust root.
   A community fork that establishes a new trust root (new keypair, new
   `addons/official/index.json`) is the only practical path. The offline backup
   required by §2 is the primary mitigation; if the backup is also lost, the
   signing root cannot be recovered.

d. **Minisign release-signing key.** Existing release signatures over past
   `@sennjs/addon-sdk` archives remain verifiable indefinitely (the public key
   ships in `docs/release-keys/sennjs-addon-sdk.pub`). Future releases would
   require either a new keypair (with a documented key-rotation announcement per
   ADR-0023) or a community fork. Again, the offline backup from §2 is the
   primary mitigation.

The project consciously accepts that bus-factor-zero recovery is necessarily lossy
at the current stage. This acceptance is the direct consequence of deferring escrow
per §1, and it is recorded here so the decision is explicit rather than implicit.

### 5. Transition criteria for revising this ADR

This ADR SHOULD be revised or superseded when any of the following occurs:

a. Any package in the monorepo is tagged at v1.0.0 or higher and no second
   maintainer has joined (the escrow deferral ceases to be proportionate to
   the project's maturity).
b. A second qualified maintainer joins and the custody of the npm publish
   identity and minisign key must be addressed for that person.
c. An incident (loss of backup, maintainer incapacity event, npm token
   compromise, or supply-chain audit) exposes the gap in a way that renders
   the deferred posture untenable.

The revision MUST open a new ADR (not amend this one in place), cite this ADR by
ID in the superseding ADR's §Related, and transition this ADR's Status to
"Superseded by ADR-XXXX".

## Rationale

**Why defer escrow rather than adopt it now.** The operational overhead of any
escrow scheme (enrollment, verification, key ceremony, auditing) is not
proportional to a pre-alpha project with a single contributor. ADR-0007's
vendor-neutrality argument applies symmetrically: a hosted escrow service is a
vendor dependency on the custody path, and one that the project cannot audit or
control. The mandatory offline backup in §2 captures the essence of escrow
(resilience against single-point loss) without introducing a new trust root.

**Why the offline backup is MUST-grade rather than SHOULD.** The three secrets
cover the signing root, the publish channel, and the release-integrity chain.
Loss of any one of them stalls the release pipeline (ADR-0022). The pre-alpha
deferral of escrow is only defensible if the offline backup requirement is not
also deferred; treating the backup as optional would leave the project in a state
where the accepted risk is also the unmitigated risk.

**Why no deadline on secondary-maintainer recruitment.** Imposing a calendar
deadline on recruiting a second qualified maintainer couples the project's
governance cadence to wall-clock time rather than to the project's actual release
maturity. The v1.0 gate in §3 is observable (a git tag) and proportional (v1.0
signals that the project's custody posture should match its public commitments).
A date threshold without the gate would either expire silently before v1.0 or
create phantom urgency in a pre-alpha that has not yet reached that milestone.

**Reversibility.** This ADR is fully reversible. The §1 deferral is lifted by a
superseding ADR that adopts escrow or threshold signing; no infrastructure
changes are required before that ADR is written. The §2 offline-backup obligation
is reversible in the sense that the backup can be destroyed once escrow is in
place; the backup itself creates no irreversible commitment. The only
irreversibility is the bus-factor-zero risk named in §4, which this ADR records
explicitly rather than mitigates — reversing it requires a second maintainer,
which is exactly what §3 addresses.

## Consequences

### Positive

- Custody remains under a single, known trust root (the bootstrap maintainer's
  workstation) with no third-party dependencies. Consistent with ADR-0007's
  vendor-neutrality posture.
- The offline backup requirement (§2) closes the gap noted in
  `docs/security-model.md` §"Single-maintainer key custody" and
  `docs/roadmap.md` §"Maintainer-gated" without introducing new infrastructure.
- The bus-factor-zero recovery options in §4 are explicit; the project's
  governance posture is on record. Future contributors and downstream integrators
  can assess the risk with full information.
- The transition criteria in §5 give a maintainer or community contributor a
  concrete checklist for when to open the follow-up ADR; no subjective judgment
  required.

### Negative

- The project halts on the bootstrap maintainer's permanent incapacity until a
  recovery proceeding (GitHub support, npm package-recovery, community fork)
  completes. Recovery is inherently lossy: at minimum, the official add-on trust
  root requires community re-establishment if the offline backup is also
  unavailable.
- The offline backup obligation (§2) places a recurring operational burden on a
  single person. Failure to maintain the backup is not auto-detected by any
  project gate; it surfaces only when recovery is needed.
- The npm publish identity (token) is not covered by any key-rotation framework
  analogous to ADR-0010. If the token is compromised and the account is also
  compromised, the response is entirely manual and outside the scope of any
  existing SENN runbook.

### Neutral / follow-up

- `docs/governance.md` §"Holders" table SHOULD be annotated, in a documentation
  PR separate from this ADR, to explicitly reference this ADR's §2 offline-backup
  obligation. The annotation is editorial and does not require a new ADR.
- `docs/security-model.md` §"Single-maintainer key custody" SHOULD be updated in
  the same documentation PR to cite this ADR and remove the "not yet ADR-tracked"
  note. The risk description does not change; only the pointer to the ADR is added.
- `docs/roadmap.md` §"Maintainer-gated" entry for "Secondary maintainer / key
  escrow" SHOULD be updated to reference this ADR once it is accepted.
- A future ADR that introduces shared npm publish custody (for a second maintainer)
  MUST specify how two maintainers coordinate token rotation, since the current
  granular-access-token model (one token per publishing workstation) does not
  cleanly extend to shared ownership without a per-person token policy.
- The minisign key (ADR-0023, ADR-0025) does not yet exist at the time this ADR
  is written (2026-05-01). Once it is generated, the bootstrap maintainer MUST
  update the offline backup to include it per §2(a).

## Related

- ADR-0007: [Vendor-neutral signaling and relay](0007-vendor-neutral-signaling-and-relay.md) — the vendor-neutrality principle applied here to key custody: SENN MUST NOT take a normative dependency on a specific hosted escrow service.
- ADR-0008: [Manifest signing](0008-manifest-signing.md) — establishes the Ed25519 signing root whose custody this ADR governs.
- ADR-0009: [Keystore minimum](0009-keystore-minimum.md) — signing keys MUST NOT be committed; the workstation keystore is the operational consequence this ADR's §2 backup obligation addresses.
- ADR-0010: [Key rotation](0010-key-rotation.md) — planned and emergency rotation assumes the maintainer is reachable; this ADR addresses the scenario where the maintainer is permanently unavailable.
- ADR-0022: [Local-first publish pipeline](0022-local-first-publish-pipeline.md) — the npm publish identity (token) is in the same custody bucket as the signing keys; its loss blocks the publish pipeline this ADR places an offline-backup obligation on.
- ADR-0023: [Vendor-neutral provenance for `@senn/addon-sdk` releases](0023-vendor-neutral-provenance.md) — introduces the minisign release-signing key that joins the custody bucket in §2(a)(iii) of this ADR once generated.
- ADR-0025: [Default signing tool for ADR-0023 vendor-neutral provenance](0025-release-signing-tool-default.md) — specifies minisign as the release-signing tool; the private key this selects is within scope of this ADR's §2 backup obligation.
- Governance: [docs/governance.md](../governance.md) §"Holders" — the authoritative record of current custody; §"Adding a registry maintainer" defines the mechanical procedure this ADR's §3 policy builds on.
- Security: [docs/security-model.md](../security-model.md) §"Single-maintainer key custody" — frames the operational risk this ADR records an explicit posture on.
- Roadmap: [docs/roadmap.md](../roadmap.md) §"Maintainer-gated" — lists this gap as "Not yet ADR-tracked" prior to this ADR.
