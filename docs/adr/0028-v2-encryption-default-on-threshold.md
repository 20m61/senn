# ADR 0028: Default-on threshold for `enableV2Encryption` in `@senn/signaling-nostr`

## Status

Proposed (2026-05-01)

## Context

[ADR-0024](0024-encrypted-nostr-signaling-nip44.md) (Implemented 2026-04-30)
introduced NIP-44 v2 content encryption for `@senn/signaling-nostr` as an
OPTIONAL wire variant. The adapter constructor accepts an `enableV2Encryption`
flag; when absent or `false`, the adapter emits v1 plaintext kind-25556 events
as specified by [ADR-0014](0014-signaling-nostr.md). When `true`, it encrypts
the `content` field with NIP-44 v2 keyed off a room-derived symmetric secret.
ADR-0024 §Out of scope is silent on when — or whether — the default flips to
`true`. That silence is intentional: the adoption signal did not yet exist.
This ADR closes the gap.

The privacy motivation is concrete. ADR-0014 §Decision item 4 recorded that
the relay already sees connection metadata; ADR-0024 §Context named the
specific leakage: SDP offers and ICE candidates contain local IP addresses and
port numbers of both peers. A relay operator (or a passive observer) who stores
plaintext kind-25556 events harvests this address metadata from every room that
does not explicitly pass `enableV2Encryption: true`. The `docs/security-model.md`
§"Threats vs. signaling / TURN operators" table lists "SDP/ICE candidate IP:port
hints (per WebRTC)" as visible to the signaling operator under v1. Flipping the
default to `true` removes that entry from the visibility table for any host
running an up-to-date build of `@senn/signaling-nostr`, without any operator
needing to read the security doc.

ADR-0024 §5 defines the interoperability contract that makes a default-on flip
technically safe in principle, but only in two directions:

- **v1 sender ↔ v2 receiver:** A v2 receiver that cannot decrypt (because the
  `content` is not a NIP-44 ciphertext) falls through to the v1 JSON-parse
  path (§5 step 5) and handles the frame correctly. The v2 receiver's handler
  fires with the correct payload.
- **v2 sender ↔ v1 receiver:** A v1 receiver (one that predates ADR-0024 and
  has no decryption path) attempts to JSON-parse the base64 ciphertext, fails,
  and discards the event silently (§5 step 6). No parse error surfaces to the
  handler. The v1-only peer simply cannot receive v2 frames.

The second direction is the load-bearing risk: a peer running a
`@senn/signaling-nostr` build that predates ADR-0024 — meaning it has no v2
receive path at all — will silently discard every frame from a default-on peer
and will be unable to complete a signaling exchange with that room. The frame
loss is silent in both directions; there is no negotiation, no error event, and
no automatic retry with a v1 frame. The practical symptom is "room does not
connect via Nostr signaling", which the host will not attribute to a version
mismatch without consulting the migration note.

The question the default-on decision must answer is therefore not technical
(the interop logic is already specified and implemented) but adoption-empirical:
**how confident are we that no in-the-wild SENN host is running a pre-ADR-0024
build of `@senn/signaling-nostr`?** This ADR defines the observable threshold
that answers that question to a degree sufficient for a maintainer to act on it.

`docs/roadmap.md` §"In flight" snapshot 2026-05-01 records the current state:
"Default remains v1 plaintext; opt-in via
`new NostrSignaling({ enableV2Encryption: true, ... })`" and lists this
threshold decision as a candidate ADR-0028.

## Decision

The `enableV2Encryption` option in `@senn/signaling-nostr` SHALL flip its
effective default from `false` to `true` once — and only once — all five
conditions below are simultaneously satisfied. Conditions (1) and (2) are
calendar-style preconditions that exist before the flip PR is opened;
conditions (3), (4), and (5) are properties of the flip PR itself and MUST be
present in that PR.

### Condition 1 — version floor on `@senn/signaling-nostr` (MUST, pre-PR)

The flip MUST ship in a release of `@senn/signaling-nostr` whose semantic
version is at least **two minor increments** past the version that first
shipped the ADR-0024 v2 receive path. At time of writing (2026-05-01),
`@senn/signaling-nostr` is at `0.0.0` (pre-alpha workspace-wide); its
ADR-0024 v2 path shipped at commit ff0c619 (PR #30) at that same version.
Once the package is individually elected for publication via an additive ADR
(per `docs/roadmap.md` §"Versioning"), the two-minor-increment rule is
measured from the first published version that contains the ADR-0024 v2 path.

Two minor increments are chosen over one to give a downstream host that has
not upgraded for one full release cycle a second opportunity to receive a
deprecation signal before the flip cycle arrives. One minor leaves too narrow a
window; an absolute date threshold is deliberately avoided because it measures
wall-clock time rather than actual upgrade activity and gives no signal if the
package does not cut releases regularly.

If `@senn/signaling-nostr` does not reach the two-minor floor within 12 months
of the ADR-0024 v2 path shipping in a published version, a follow-up ADR MAY
revise this threshold. That follow-up MUST cite this ADR and MUST NOT silently
change the effective default without meeting an alternative observable
condition.

### Condition 2 — public migration documentation (MUST, pre-PR)

Before the flip PR is opened, a migration note MUST exist in
`docs/dev/release.md` or in a new `docs/migrations/v2-default-on.md`. The
note MUST describe:

1. The symptom of the v1-only-receiver case: "a peer running
   `@senn/signaling-nostr` older than [floor version] will silently fail to
   complete a signaling handshake with a default-on peer; the Nostr adapter
   will not emit a parse error; the session will appear to time out on the
   WebRTC side."
2. The minimum version a host must be on to interoperate with a default-on
   sender: the floor version from condition (1).
3. The opt-out escape hatch: `new NostrSignaling({ enableV2Encryption: false
   })` reverts to v1 plaintext without requiring a package rebuild.

This condition is not a legal or technical obligation; it is an adoption-signal
precondition. A default-on flip that has no discoverable documentation for the
failure mode will be attributed to bugs rather than to a version mismatch,
wasting maintainer time on support requests that are inherently self-resolving
once the host upgrades.

### Condition 3 — rollback knob preserved (MUST, in flip PR)

The flip MUST be implemented as `enableV2Encryption` defaulting to `true` when
the option is `undefined`, NOT as a hardcoded `true`. An integrator that
encounters an unknown-version peer in production MUST be able to revert to v1
plaintext by constructing the adapter with `{ enableV2Encryption: false }`
without rebuilding the package. Removing the option or hard-coding `true`
forecloses the only operator-side workaround for an undiscovered v2 regression
and is forbidden by this condition.

The rationale is defensive: ADR-0027 §5 establishes a construction-time
known-answer test (KAT) that guards against an upstream `nostr-tools/nip44`
regression at instantiation time. That KAT covers the cipher's contract at the
SENN boundary. It does not cover a runtime bug that only appears under specific
plaintext shapes or relay event flows. Preserving `{ enableV2Encryption: false
}` as a working escape hatch keeps an operator-side kill-switch in place for
failure modes that the KAT does not detect.

### Condition 4 — conformance gate updated (MUST, in flip PR)

`pnpm verify:nostr-self-test` MUST gain a new named check: a
default-constructed `NostrSignaling` adapter (no options object) MUST report
that v2 is active before sending its first frame. This check MUST be a
distinct test from the existing v2 round-trip check that verifies the explicit
`{ enableV2Encryption: true }` path.

At time of writing (2026-05-01), `pnpm verify:nostr-self-test` covers v2
exclusively via the explicit opt-in flag, surfacing as 9 ok lines in the
conformance summary. After the default-on flip, the default-construction
contract changes and a regression that re-defaults to `false` (for example,
due to a TypeScript optional-parameter default being dropped in a refactor)
would not surface in `pnpm conformance` without this new check. ADR-0021
(Implemented) established the local-first conformance gate as the repository's
source of truth for "is this branch safe to open as a PR?"; silent drift
against that gate is exactly the class of failure ADR-0021 is meant to catch.

### Condition 5 — spec updated in the same PR (MUST, in flip PR)

`docs/signaling-nostr-spec.md` §"v2 content cipher (NIP-44, OPTIONAL)" MUST
be updated in the same PR that lands the default-on flip. Specifically:

- The section header MUST change from "v2 content cipher (NIP-44, OPTIONAL)"
  to "v2 content cipher (NIP-44, DEFAULT)".
- The opening normative sentence that reads "The adapter MAY implement the
  OPTIONAL v2 content cipher" MUST change to read "The adapter SHOULD enable
  the v2 content cipher by default; `enableV2Encryption` SHOULD remain enabled
  unless the integrator has an explicit v1-only interoperability requirement."
- The line in §"Adapter options" (or equivalent) that documents
  `enableV2Encryption` MUST note that the default is `true` as of the version
  at which this ADR's threshold was met, and MUST note the opt-out form.

Shipping a code default change without a concurrent spec update produces a
spec–code drift that SENN's spec-driven development loop (CLAUDE.md
§"Spec-Driven Development") treats as a blocker for merging.

## Rationale

**Why a version floor and not a date-based threshold.** Date thresholds
(for example, "after 2026-12-31") couple the flip to wall-clock time
without measuring actual upgrade behaviour. A version floor binds the flip to
the pace at which `@senn/signaling-nostr` actually cuts releases and downstream
hosts actually upgrade. It is the only threshold that is both observable (a
maintainer can inspect published version history) and proportional to real
adoption risk. ADR-0024 shipped its v2 path at commit ff0c619 (2026-04-30);
the reference point is the first published version containing that commit, not
the commit date.

**Why two minor increments and not one.** One minor increment leaves a single
release cycle as the upgrade window. Given that `@senn/signaling-nostr` is not
yet individually published (all packages are at `0.0.0` pre-alpha), a
one-increment window could expire very quickly once publication begins. Two
increments give a host that has not upgraded for one full release cycle a
second visible opportunity before the flip cycle arrives.

**Why preserve `{ enableV2Encryption: false }` as a working escape hatch.**
ADR-0024 §"Consequences — Negative" acknowledged that a passive observer who
records all ciphertext and later obtains the roomId can decrypt retroactively,
and that structural forward secrecy is explicitly out of scope. The v2 path
does not address every adversarial scenario. A newly discovered runtime bug in
the v2 path (not caught by the construction-time KAT established in ADR-0027
§5) would otherwise leave an operator with no recourse short of deploying an
older version of the package. The escape hatch costs nothing at runtime; its
only overhead is one boolean check at instantiation.

**Why a default-construction conformance check (condition 4) and not only an
explicit-opt-in check.** After the flip, the default contract changes. The
existing suite (9 ok lines as of 2026-05-01) verifies that v2 works when
explicitly enabled; it does not verify that v2 is active when no options are
passed. A refactor that accidentally drops the TypeScript default or introduces
a conditional guard on the option check would silently regress to v1 without
tripping any existing gate check. ADR-0021's local-first gate is the
repository's only safety net against that class of silent drift; condition 4
wires the new contract into it.

**Why the spec must be updated in the same PR (condition 5) and not as a
follow-up.** SENN's spec-driven development loop requires that observable
behavior changes are reflected in the normative spec in the same changeset that
ships the code change. A code-only flip that leaves the spec calling v2
"OPTIONAL" after v2 is the default is a drift between spec and code — precisely
the category SENN's SDD loop calls a review blocker (CLAUDE.md §"Spec-Driven
Development": "Code-only PRs that change observable behavior should be rejected
at review").

**Reversibility.** This ADR is reversible at low cost during the threshold
evaluation phase (no code change has shipped). After the flip PR lands,
reversal requires a new PR re-defaulting `enableV2Encryption` to `false` and
a concurrent spec revert — a one-hour change of medium review cost. No data is
permanently lost: v1 frames are still emitted when the option is explicitly
`false`, and the v2 receive path continues to accept v1 plaintext via the
ADR-0024 §5 fallback. The migration documentation from condition (2) doubles
as the revert guide.

## Consequences

### Positive

- Closes the SDP/ICE-IP leakage risk documented in
  `docs/security-model.md` §"Threats vs. signaling / TURN operators" by
  default, without requiring hosts to read the security doc or discover the
  `enableV2Encryption` option. The privacy claim "SDP/ICE candidate IP:port
  hints are visible to the signaling operator" moves from the "Visible" column
  to the "Not visible" column for any host on a current build.
- Aligns the implicit and explicit security postures: a host that reads "SENN
  encrypts signaling" in any marketing or doc summary will get encryption by
  default, not only if they found the right constructor option.
- New integrations need no discovery step; the secure default is automatic.
- The version-floor threshold (condition 1) creates a predictable, observable
  signal for maintainers and downstream hosts rather than an arbitrary calendar
  date.

### Negative

- A peer running a `@senn/signaling-nostr` build that predates ADR-0024 (no v2
  receive path) will silently fail to complete a signaling exchange with any
  default-on peer. The failure is silent per ADR-0024 §5 step 6 and will
  present as a room-level connection timeout. Condition (2) — the migration
  note — is the only mitigation contributors will see; operators who do not read
  it will spend debugging time before discovering the version mismatch.
- The version-floor threshold (condition 1) couples the flip to publication
  cadence. If `@senn/signaling-nostr` does not cut two published minor
  versions for an extended period, the threshold is never met by the clock.
  The 12-month fallback clause in condition (1) permits a follow-up ADR to
  revise the threshold in that scenario; it does not auto-trigger the flip.
- The conformance gate extension (condition 4) adds one new named check to
  `pnpm verify:nostr-self-test`, marginally increasing gate runtime.

### Neutral / follow-up

- The actual flip PR is not part of this ADR. This ADR sets the conditions;
  the maintainer who authors the flip PR cites this ADR by ID and demonstrates
  in the PR description that all five conditions are met. No automated gate
  enforces condition (1) or (2); they are observable preconditions, not
  enforced invariants.
- If all five conditions are met but a contemporaneous incident makes a
  default-on flip unsafe (for example, a newly filed CVE against
  `nostr-tools/nip44` or a discovered interop failure with a third-party NIP-44
  implementation), the maintainer MAY defer the flip. Such a deferral SHOULD
  result in a follow-up commit that updates this ADR's §Status block with a
  one-line deferral note and a reason. It MUST NOT be a silent delay.
- Once the flip lands, ADR-0014 §Decision item 4 (the original rationale for
  plaintext default) SHOULD receive a short annotation cross-referencing this
  ADR. ADR-0014 is Accepted and MUST NOT be edited in place; the annotation
  takes the form of a new ADR that amends ADR-0014 §Decision item 4, or a
  note in a follow-up if the scope is small enough to bundle with the flip PR.
- `docs/signaling-nostr-spec.md`'s §"Adapter options" section SHOULD document
  the historical version boundary at which the default changed, so a reader
  consulting the spec years later can trace the timeline without git archaeology.

## Related

- ADR-0007: [Vendor-neutral signaling and relay](0007-vendor-neutral-signaling-and-relay.md) — vendor-neutrality constraint inherited by the v2 cipher; this ADR makes no change to relay or transport selection.
- ADR-0014: [Nostr signaling adapter](0014-signaling-nostr.md) — defined v1 plaintext as the operative default this ADR proposes to change; §Decision item 4 is the rationale this ADR supersedes on the default question.
- ADR-0024: [Encrypted Nostr signaling content via NIP-44](0024-encrypted-nostr-signaling-nip44.md) — defines the v2 cipher, the ADR-0024 §5 mixed-version interop this ADR depends on, and the `enableV2Encryption` flag whose default this ADR addresses. ADR-0024 §"Out of scope" is silent on the threshold; this ADR fills that gap.
- ADR-0027: [NIP-44 v2 implementation source](0027-nip44-implementation-source.md) — confirmed `nostr-tools/nip44` as the implementation route that the default-on flip activates; §5 construction-time KAT is the runtime guard this ADR relies on for the rollback-knob rationale.
- ADR-0021: [Local-first conformance gate](0021-local-first-conformance.md) — the gate that condition (4) extends; cited in the rationale for why a default-construction check is necessary.
- Spec: [docs/signaling-nostr-spec.md](../signaling-nostr-spec.md) §"v2 content cipher (NIP-44, OPTIONAL)" — the normative section that condition (5) requires the flip PR to update.
- Security: [docs/security-model.md](../security-model.md) §"Threats vs. signaling / TURN operators" — frames the SDP/ICE-IP leakage risk this ADR closes by default.
- Roadmap: [docs/roadmap.md](../roadmap.md) §"In flight (deferred items)" — lists this as a candidate ADR-0028 per the 2026-05-01 snapshot.
