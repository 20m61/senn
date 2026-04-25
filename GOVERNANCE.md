# SENN Project Governance

## Purpose

SENN is an open project that exists to provide a browser-native, privacy-respecting
P2P communication runtime. Governance exists to keep the project aligned with
its [charter](docs/charter.md), to make decisions transparent, and to protect
the open ecosystem around SENN Core and SENN Add-ons.

## Roles

### Contributors

Anyone who submits issues, documentation, or code. No formal status required.

### Maintainers

Hold commit access to the SENN repositories. Responsible for:

- Reviewing and merging pull requests.
- Triaging issues.
- Enforcing the [Code of Conduct](CODE_OF_CONDUCT.md).
- Stewarding the [license policy](docs/license-policy.md).

Maintainers are added by consensus of existing maintainers, based on a sustained
record of high-quality contributions.

### Steering Committee

A small group of maintainers responsible for:

- Approving Architecture Decision Records (`docs/adr/`).
- Resolving disputes that maintainers cannot resolve by consensus.
- Approving changes to governance, the trademark policy, and the license policy.
- Custodianship of the SENN brand and the SENN Verified Registry.

The steering committee is bootstrapped by the founding maintainers and
documented here once formed.

## Decision Making

- **Lazy consensus** for routine PRs: if no maintainer objects within a reasonable window, the change is accepted.
- **Explicit consensus** for ADRs, governance changes, license policy changes, and changes that affect security guarantees: requires affirmative review from a majority of maintainers.
- **Steering committee vote** as the final escalation step.

## Specifications and ADRs

Material design changes are recorded as ADRs under `docs/adr/`. New ADRs follow
the existing template (`Status / Context / Decision / Consequences`).

## Trademarks

See [TRADEMARK.md](TRADEMARK.md) for the SENN trademark policy.

## Forking

The Apache-2.0 license guarantees the right to fork the code. The SENN name,
logo, and the "SENN Verified" designation are reserved for the project under
the trademark policy.
