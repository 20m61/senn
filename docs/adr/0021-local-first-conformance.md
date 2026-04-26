# ADR 0021: Local-first conformance gate (no dependency on GitHub Actions)

## Status

Proposed (2026-04-26)

## Context

SENN ships exclusively as static files served from any compliant static host.
Every deployment tier described in `docs/deployment.md` — from a shared rental
host running Apache to an object-storage bucket — is self-sufficient once the
static artefacts are in place. No build server, no long-lived process, and no
specific CI vendor is required at runtime.

Charter principle 4 states "Add-ons are static files," and `docs/deployment.md`
explicitly lists no vendor-bound defaults. ADR-0007 (vendor-neutral signaling
and relay) generalises this stance to the entire project: SENN MUST NOT
hardcode a dependency on any single infrastructure vendor, including a hosted CI
vendor. Treating GitHub Actions as the authoritative conformance gate is
therefore structurally inconsistent with ADR-0007 — it makes correctness itself
vendor-dependent. A fork operated by a community that cannot enable Actions
(billing lock, exhausted minutes, org-level restrictions, or a network that
cannot reach the GitHub API) loses its ability to certify the project is green.

The commit `7c3538c revert(ci): drop deploy-gallery.yml — Actions are
unavailable` on `develop` is a concrete instance of this failure mode: a live
Actions outage caused functional capability to be silently removed rather than
deferred, because no local-first fallback existed to demonstrate the project
remained shippable. That revert should never have been necessary.

ADR-0006 (static add-on policy) reinforces the constraint from another angle:
an add-on is valid the moment its manifest and signatures pass the local
validator, regardless of whether a remote CI service confirmed the result. The
same logic extends to the whole repository: the monorepo is conformant when
`pnpm conformance` is green, not when a remote workflow badge is green.

## Decision

SENN's conformance contract is enforced locally by `pnpm conformance` plus a
pre-push git hook; GitHub Actions workflows are an OPTIONAL mirror, not the
authority.

Specifically:

1. **`scripts/conformance.sh`** is the single source of truth for the
   conformance sequence. `pnpm conformance` is the one command that executes
   it. The sequence is: typecheck → lint → `validate:all-manifests` →
   `check:addon-forbidden` → `verify:official` → `test:registry-schema` →
   `validate:registry` → `verify:addon-sdk` → `build:addon-sdk` (no working-
   tree diff under watched paths) → `build:web-registry` (no working-tree
   diff) → workspace unit and integration tests. A run that exits zero is the
   ship contract.

2. **`.githooks/pre-push`** runs `pnpm conformance` before any push. It also
   unconditionally refuses a push targeting `main`, enforcing the branch policy
   documented in `CONTRIBUTING.md`.

3. **`prepare` npm script** (`git config core.hooksPath .githooks`) wires the
   hook on `pnpm install`. Zero new runtime dependencies are introduced; Husky
   and similar hook managers are explicitly not used.

4. **Bypass mechanism**: `git push --no-verify` or `SENN_SKIP_PREPUSH=1 git
   push` bypass the hook for exceptional cases. Both forms surface in `git log`
   via the normal commit-metadata trail. Using either form does not suppress the
   `main`-push guard — that check is also enforced server-side by branch
   protection.

5. **`.github/workflows/conformance.yml` and `publish-addon-sdk.yml`** are
   retained and MUST be kept aligned with `scripts/conformance.sh`, but they
   are annotated as optional mirrors. A fork without Actions MUST be treated as
   fully capable of producing a conformant release.

6. **Playwright e2e tests** are explicitly NOT part of `pnpm conformance`.
   Their per-browser cost (~25 minutes each) makes them unsuitable for the
   pre-push path. They remain an on-demand check, as documented in
   `docs/dev/conformance.md`.

## Rationale

The key constraint is that "the conformance contract" and "the CI pipeline"
MUST NOT be synonymous. A developer on a plane, a fork on a host that blocks
the Actions API, or a community using a self-hosted forge other than GitHub
SHOULD all be able to run the full gate and get an authoritative answer.
Keeping the gate in a shell script invoked by `pnpm` achieves this with no
additional tooling.

Choosing `git config core.hooksPath` over Husky or similar avoids introducing a
dev-dependency that itself requires a network fetch on first install. The only
dependency is a POSIX shell, which every contributor environment already has.

The `main`-push guard in the hook is a belt-and-suspenders measure alongside
branch protection: it catches accidental direct pushes even when branch
protection is misconfigured or when a developer uses a PAT that bypasses it.

## Consequences

### Positive

- Every fork, including forks where Actions is unavailable, can run the full
  conformance gate locally and verify the project is green before a release.
- The identical command (`pnpm conformance`) runs in the developer's editor,
  in the pre-push hook, and in the CI mirror — no skew between environments.
- The project's vendor-neutral posture (ADR-0007, `docs/charter.md` principle
  10) is upheld at the tooling layer, not just at the runtime layer.
- A contributor can prove a branch is green offline. No network access is
  required to run `pnpm conformance` on a checked-out tree.
- The hook is wired automatically by `pnpm install`, which every contributor
  already runs. No separate onboarding step is needed.

### Negative

- Contributors who push from a freshly cloned checkout on fast iteration loops
  pay one full gate run per push (~3–4 minutes). The bypass exists but is
  logged. Teams accustomed to fast `git push` may find this friction.
- New contributors MUST run `pnpm install` for the hook to be active. A
  contributor who skips install and pushes directly will not have the hook wired
  until they do so.
- Keeping `scripts/conformance.sh` and `.github/workflows/conformance.yml` in
  sync is an ongoing maintenance obligation. Drift between the two produces the
  very "environment skew" this ADR aims to eliminate.

### Neutral / follow-up

- A future ADR MAY introduce Playwright e2e coverage in the pre-push hook,
  scoped to changesets that touch `apps/web` or `packages/core`, once the
  per-browser cost is reduced (e.g., by a headless-only fast path on a single
  browser). That decision is explicitly deferred by this ADR.
- The `--no-verify` bypass and `SENN_SKIP_PREPUSH=1` are intentional escape
  hatches; a future ADR MAY introduce a lightweight confirmation prompt rather
  than a silent bypass, if abuse of the escape hatch becomes a pattern.
- The `prepare` script also applies to CI environments that run `pnpm install`.
  The hook must be idempotent when `git config core.hooksPath` is already set
  (no-op on re-run).

**Reversibility:** This decision is easily reversible. Removing
`scripts/conformance.sh`, the `prepare` and `conformance` entries from the root
`package.json`, and `.githooks/pre-push` restores the pre-ADR state. The
`.github/workflows/` files remain functional throughout, so a fork that prefers
CI-as-authority can revert this ADR and continue using Actions without any
workflow changes. Cost of reversal: low.

## Related

- Charter: `docs/charter.md` §Principles, principle 10 (vendor neutrality in
  the business and tooling layer)
- ADR-0007: vendor-neutral signaling and relay — the principle that SENN MUST
  NOT hardcode a dependency on a specific infrastructure vendor, extended here
  to the conformance tooling layer
- ADR-0006: static add-on policy — reinforces that correctness is locally
  verifiable, independent of remote services
- Spec: `docs/deployment.md` §"What SENN does not ship" — SENN ships to any
  static host without a build server; conformance tooling follows the same
  constraint
- Spec: `docs/dev/conformance.md` — the local gate page that this ADR's
  implementation populates; §"CI (optional, not authoritative)" is the
  normative statement derived from this ADR

## Open questions for the maintainer

1. **Pre-push latency policy.** The ~3–4 minute gate-per-push may be
   acceptable for topic-branch work but burdensome during rapid iteration (e.g.,
   documentation-only commits). Should the hook skip typecheck and test for
   pushes where only `docs/**` files changed, at the cost of a more complex hook
   script? Or is a flat bypass (`SENN_SKIP_PREPUSH=1`) sufficient policy?

2. **CI alignment enforcement.** This ADR requires `scripts/conformance.sh` and
   `.github/workflows/conformance.yml` to be kept in sync but does not specify a
   machine-enforceable check for that alignment. Should a drift check (e.g., a
   step that diffs the workflow's step list against the shell script's sequence)
   be added to `pnpm conformance` itself, or is a code-review obligation
   sufficient?

3. **Topic-branch lifecycle.** This ADR gates `git push`. Should `pnpm
   conformance` also be invoked automatically on `git commit` (via a pre-commit
   hook) for maintainers who work in short-lived branches? That would surface
   failures earlier but adds cost per commit. Or is pre-push the right
   granularity for this project's workflow?
