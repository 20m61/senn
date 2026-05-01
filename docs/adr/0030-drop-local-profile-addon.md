# ADR 0030: Drop `local-profile` add-on from the SENN roadmap

## Status

Proposed (2026-05-01)

## Context

The SENN official add-on roadmap has listed a `local-profile` add-on since the
project's earliest planning phase. It was intended to give a room participant a
persistent, shareable profile (display name, avatar, preferences). The idea was
never translated into a specification, an implementation, or a registry entry:
as of 2026-05-01, a full-repository search for `local-profile` returns exactly
three references — two in `docs/roadmap.md` and one stale example in
`docs/dev/release.md`. The add-on does not appear in `addons/official/index.json`
(which lists seven entries: echo, whiteboard, avatar-presence, local-vault,
voice-meter, voice-call, and the minimal template). No code directory for it
exists anywhere in `packages/`, `apps/`, or `addons/`.

The per-add-on storage API introduced by ADR-0005 (Local-first Persistence) and
enforced by ADR-0006 (Static Add-on Policy) already satisfies the implicit
single-add-on use case: every add-on may store its own keyed values under the
`storage.local.read` / `storage.local.write` permissions. The avatar-presence
add-on owns its presence state; voice-call owns its call state; each add-on owns
exactly the profile data it needs. This is the de facto replacement for the
`local-profile` concept, and it has been the operative answer since the v3
registry shipped (ADR-0020).

The one case the per-add-on model does not address is cross-add-on profile
coordination — for example, a shared display name that multiple add-ons in the
same room would read and write in concert. That is a distinct, larger problem.
It involves either a capability-routed bridge or an explicit shared schema, it
requires a security analysis of the cross-add-on data flow (ADR-0003 isolates
add-on sandboxes from each other), and it has no concrete user-facing requirement
at this time.

`docs/roadmap.md` marks `local-profile` as `📌` (deferred) in §Phase 3 and lists
it as `⬜` (unresolved) in §"Open design decisions". The deferral has persisted
across multiple project sessions without producing a concrete requirement. It costs
reader attention — every contributor who encounters the entry must reason through
the deferral, realise there is no implementation roadmap, and move on — without
paying anything back.

## Decision

SENN formally retires the `local-profile` add-on idea, with the following
normative consequences.

### 1. No official `local-profile` add-on will ship

The add-on ID `dev.senn.local-profile` and the capability tag `local-profile-v1`
(within the naming scheme established by ADR-0026) are RESERVED under the
official SENN trust root. No add-on bearing either identifier MUST be signed with
the official add-on signing key or listed in `addons/official/index.json`, now or
in any future release.

Community add-ons operating under a different reverse-DNS prefix (e.g.,
`com.example.local-profile`) MAY use the `local-profile` name and are NOT bound
by this reservation.

### 2. Per-add-on storage is the operative replacement

The `storage.local.read` and `storage.local.write` permission set, backed by
the ADR-0005 local-first persistence contract and the ADR-0006 per-add-on
isolation rule, is the replacement mechanism. It is not a new mechanism; it is
the de facto answer that has been in place since the v3 registry (ADR-0020)
shipped without a `local-profile` entry.

Add-on authors who need per-add-on profile storage MUST use `storage.local.*`
permissions declared in their `manifest.json`. No wrapper add-on, no additional
SDK surface, and no shared namespace are needed for this use case.

### 3. Cross-add-on profile coordination requires a fresh ADR

If a future use case for cross-add-on profile data appears — for example, a
shared display name readable by multiple add-ons in the same room — that use
case MUST be opened as a new ADR. The new ADR MUST include:

a. A concrete, user-facing requirement statement (not a placeholder).
b. A security analysis of the cross-add-on data flow, given that ADR-0003's
   sandbox isolation makes add-on-to-add-on communication non-trivial by design.
c. A reference to this ADR (ADR-0030) explaining why the retired `local-profile`
   name is NOT being reused and what new name or mechanism is being introduced.

The cross-add-on profile case MUST NOT be filed under the `local-profile` name
or the `dev.senn.local-profile` add-on ID, to avoid confusion with the retired
idea recorded by this ADR.

### 4. Roadmap and documentation cleanup

`docs/roadmap.md` SHOULD be updated in the same PR as this ADR to:

- Remove the `📌 local-profile` line in §Phase 3, replacing it with a one-line
  reference to this ADR.
- Remove the `⬜ local-profile add-on resolution` entry from §"Open design
  decisions", replacing it with a one-line reference to this ADR.

`docs/dev/release.md` SHOULD have the stale example
`pnpm validate:addon addons/official/local-profile/manifest.json`
(currently line 17) removed in the same PR, since no such manifest exists or
will exist under the official trust root.

These are documentation edits. They do not require a further ADR.

## Rationale

**Why retire rather than defer indefinitely.** The deferral has been open since
the project's earliest phase and has accumulated no concrete progress. A 📌
entry with no implementation roadmap is a maintenance debt that grows with the
contributor base: each new contributor must reason through the deferral to
conclude it is inactive. Formal retirement converts that recurring cost to a
one-time lookup. Retirement is reversible (see below); indefinite deferral is
not a better form of optionality — it merely disguises the cost.

**Why the per-add-on storage model is sufficient for the implicit use case.**
The original `local-profile` idea was never specified beyond "a persistent user
profile". The only concrete implementation of that idea in SENN's actual add-on
set is avatar-presence, which stores its own state under `storage.local.*`. No
add-on in the official registry requires a cross-add-on profile surface. The
ADR-0005 / ADR-0006 combination already satisfies "add-on X stores its own user
data" without any new mechanism.

**Why the cross-add-on case is out of scope here.** ADR-0003 (Add-on Sandbox
Model) isolates add-on iframes from each other by design. Bridging that isolation
for profile data sharing is architecturally non-trivial and carries security
implications (what can add-on A learn about add-on B's data? who authorizes the
bridge?). Deciding that case without a concrete requirement would lock the design
space prematurely. The correct gate for that decision is a future ADR with a real
use case — not this retirement ADR.

**Why reserve the ID and capability tag.** Without an explicit reservation,
a third-party maintainer could submit an add-on named `dev.senn.local-profile`
to the official registry, or a community PR could reinstate the idea under the
same identifier without realizing this ADR recorded a retirement. The namespace
reservation under the official trust root prevents that confusion at the registry
level. It does not prevent community use under a non-official prefix.

**Reversibility.** This ADR is fully reversible. A future ADR that supplies a
concrete requirement for a cross-add-on profile surface can supersede this ADR,
lift the §1 retirement, and introduce the new design. The cost of reversibility
is: writing that future ADR, which is the correct overhead for reopening a
design question. The retirement does not delete any code (there is no code to
delete), does not remove any registry entry (there is no entry to remove), and
does not break any existing add-on (no add-on depends on `local-profile`).

## Consequences

### Positive

- The roadmap loses one unresolvable `📌` / `⬜` entry. Contributors reading
  §Phase 3 and §"Open design decisions" see a clear record rather than an
  ambiguous deferral.
- The add-on ID `dev.senn.local-profile` and capability tag `local-profile-v1`
  are reserved against inadvertent reuse under the official trust root. A
  future registry PR that attempts to register either identifier will have a
  clear ADR to point to.
- Cross-add-on profile coordination, if it ever becomes necessary, is routed
  through a future ADR with a concrete requirement and security analysis — the
  correct gate for a non-trivial addition to the sandbox model.

### Negative

- Loss of optionality: if a use case for `local-profile` as originally imagined
  appears, the project must open a new ADR (the cost is authoring that ADR and
  receiving maintainer review). This is the intended behavior; it is not a large
  cost in practice, because the new ADR must supply a concrete requirement that
  did not exist when this retirement was filed.

### Neutral / follow-up

- `docs/roadmap.md` SHOULD be edited in the same PR to retire the two references
  (§Phase 3 line 62, §"Open design decisions" line 234). These are non-normative
  documentation changes that do not require a further ADR.
- `docs/dev/release.md` SHOULD have the stale example at line 17
  (`pnpm validate:addon addons/official/local-profile/manifest.json`) removed
  in the same PR. The path it references does not exist and will never exist
  under the official trust root.
- `addons/official/index.json` is unchanged. `local-profile` was never an entry
  in it; no registry edit is required.
- ADR-0017 (registry schema v2) and ADR-0020 (registry schema v3) are unaffected.
  Neither registered `local-profile`; this ADR documents why it was not registered
  and closes the question.

## Related

- ADR-0003: [Add-on Sandbox Model](0003-addon-sandbox-model.md) — per-add-on
  iframe isolation that makes cross-add-on profile data sharing architecturally
  non-trivial; the security complexity this ADR avoids by not specifying a
  cross-add-on surface.
- ADR-0005: [Local-first Persistence](0005-local-first-persistence.md) — the
  `storage.local.*` KV contract that is the de facto replacement for the implicit
  single-add-on profile use case.
- ADR-0006: [Static Add-on Policy](0006-static-addon-policy.md) — per-add-on
  isolation rule that scopes `storage.local.*` to each add-on independently.
- ADR-0017: [Registry schema v2](0017-registry-schema-v2.md) — the first registry
  generation that did not register `local-profile`; this ADR closes the gap that
  was left open by that omission.
- ADR-0020: [Registry schema v3](0020-registry-schema-v3.md) — current registry
  generation; `local-profile` was not registered then either; this ADR records
  that as a deliberate decision rather than an oversight.
- ADR-0026: [Capability tag naming](0026-capability-tag-naming.md) — the
  `<feature>-v<major>` namespace under which `local-profile-v1` is RESERVED by
  this ADR.
- Roadmap: [docs/roadmap.md](../roadmap.md) §Phase 3 + §"Open design decisions"
  — the two entries this ADR retires.
- Spec: [docs/dev/release.md](../dev/release.md) line 17 — the stale example
  this ADR flags for removal.
