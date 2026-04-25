# SENN Governance (extended)

This document expands on [GOVERNANCE.md](../GOVERNANCE.md) at the repository root.
It is intended to evolve as the project grows beyond its founding maintainers.

## Current Stage

SENN is pre-alpha. The founding maintainers serve as the de-facto steering
committee. Decisions are made by lazy consensus on issues and pull requests,
and recorded as ADRs (`docs/adr/`) when they are architecturally significant.

## Adding Maintainers

A contributor may be invited to become a maintainer when they have:

- Submitted a sustained stream of quality contributions.
- Reviewed others' contributions constructively.
- Demonstrated alignment with the [Charter](charter.md) and the [Security Model](security-model.md).

Invitations are proposed in a private maintainers channel and require unanimous
agreement of the existing maintainers.

## Removing Maintainers

A maintainer who has been inactive for 12 months, or who repeatedly violates
the [Code of Conduct](../CODE_OF_CONDUCT.md), may be removed by majority vote
of the remaining maintainers.

## Changes to Governance

Changes to this document, [GOVERNANCE.md](../GOVERNANCE.md), the
[License Policy](license-policy.md), or the [Trademark Policy](../TRADEMARK.md)
require:

1. A pull request that explains the motivation.
2. A two-week public review period.
3. Affirmative approval from a majority of maintainers.

## Forks

SENN is Apache-2.0 licensed and intentionally fork-friendly. Forks must observe
the [Trademark Policy](../TRADEMARK.md) when distributing under the SENN name.

## Official add-on registry

The "official" add-on publisher trust root lives in
[`addons/official/index.json`](../addons/official/index.json) and pins
the Ed25519 public key(s) used to sign every add-on the project
ships. Verifier rules are in
[addon-signing-spec.md](addon-signing-spec.md); rotation policy is in
[ADR-0010](adr/0010-key-rotation.md). This section is the operational
runbook.

### Holders

| Role | Holder | Custody |
|------|--------|---------|
| Bootstrap maintainer | repo owner (`20m61`) | local keystore on a single workstation |

When a second maintainer joins, append a row in the same commit that
adds their public key to `addons/official/index.json`. Signing
authority is per-public-key, not per-human; one human MAY hold more
than one key (e.g. a workstation key + a hardware-backed key).

### Where the key lives

- **Repo:** never. `*.key.json` is gitignored per ADR-0009. CI never
  has a copy.
- **Workstation:** `~/.config/senn/senn-official.key.json` (mode
  `0o600`). The repo's `keys/senn-official.key.json` path is for
  short-lived development only — production rotations should pull from
  the operator's own filesystem.
- **Backup:** holder's responsibility. Recommended: their existing
  password-manager / age-encrypted file. SENN does NOT ship a backup
  format; `*.key.json` is plain JSON, copy it as-is.

### Scheduled rotation runbook (3 commits)

Run when a holder leaves, on a calendar cadence (default: yearly), or
after a security audit asks for it. ADR-0010 motivates the
three-commit shape; each commit individually leaves
`pnpm verify:official` green.

**1. Generate the new key, add it to `trustedKeys`.**

```sh
pnpm sign:manifest examples/minimal-addon \
  --generate-key keys/senn-official-next.key.json
# prints the new public key — copy it.
```

Edit `addons/official/index.json` and append the new public key to
`trustedKeys` (do NOT remove the old one yet). Commit:

```
chore(registry): trust new official key <prefix>
```

After this commit, hosts trust BOTH keys. The new sig that
`--generate-key` produced for `examples/minimal-addon` is already
valid because its public key was just added.

**2. Re-sign every add-on with the new key.**

```sh
pnpm sign:all-official keys/senn-official-next.key.json
pnpm verify:official
```

Commit:

```
chore(registry): re-sign all add-ons with new official key
```

After this commit, every shipped sig is created by the new key. The
old key remains in `trustedKeys` so any cached deployment that
hasn't pulled yet still verifies.

**3. Remove the old key after the grace period (default 30 days).**

Edit `addons/official/index.json` and delete the old public key from
`trustedKeys`. Run `pnpm verify:official` to prove every shipped sig
is still valid under the shrunken key set. Commit:

```
chore(registry): drop superseded official key <prefix> (post-grace)
```

Move the previous keystore (`keys/senn-official.key.json`) out of the
working tree and shred it.

### Emergency rotation runbook (1 commit, no grace)

Use when the keystore is suspected lost, copied, or otherwise
compromised.

1. Generate the new keystore on a clean machine.
2. In one commit:
   - **Replace** the compromised key in `trustedKeys` (do not keep
     it for any window).
   - Run `pnpm sign:all-official keys/senn-official-emergency.key.json`.
   - Run `pnpm verify:official` (must pass).
   - Add `docs/advisories/SECURITY-ADVISORY-<YYYY-MM-DD>.md` describing
     the suspected scope and timing.
3. Commit message starts with `security(registry):` so it is easy to
   audit later.
4. Notify downstream hosts via the announcement channel(s) listed in
   the advisory.

After landing, the compromised keystore is destroyed locally. Any
cached deployment still using the old key will start failing
verification — that is the intended effect.

### Adding a registry maintainer

1. The new maintainer generates their own keystore on their own
   machine (the bootstrap holder does NOT see the private key).
2. They send the public key over a side channel.
3. Append the public key to `trustedKeys` in a PR; once merged, the
   new maintainer can sign add-ons that the existing verifier accepts.
4. Add a row to the holders table above in the same PR.

### Removing a registry maintainer

Treat as a scheduled rotation that targets exactly that maintainer's
key:

1. Append a fresh active key (if needed).
2. Re-sign all add-ons with a remaining trusted key.
3. Remove the departing maintainer's key from `trustedKeys`.

If departure is involuntary or trust is in question, follow the
emergency runbook instead.
