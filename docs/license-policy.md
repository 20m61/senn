# SENN License Policy

## Project License

SENN Core is licensed under the Apache License 2.0.

## Scope

This policy applies to dependencies that ship in SENN distribution
artefacts: the `@sennjs/*` npm packages, signed official add-ons under
`addons/official/`, and the deployable web app/gallery bundles. It is
enforced via `pnpm check:licenses`, which walks the production
dependency tree (`pnpm list -r --prod --json --depth Infinity`). Pure
devDependencies (build tools, test runners, Vite plugins) are out of
scope because they do not flow into shipped artefacts; their licenses
are recorded in the repo through `pnpm install` but not gated.

## Allowed Dependency Licenses

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- ISC
- 0BSD
- CC0-1.0
- Unlicense

The Unlicense is a public-domain dedication; functionally it is
equivalent to CC0-1.0 (the project's own dedication of choice for
that semantic) and 0BSD. Added 2026-04-30 as a prerequisite for
adopting `nostr-tools` (Unlicense) per
[ADR-0027 §6](adr/0027-nip44-implementation-source.md). Future
public-domain-dedicated dependencies (e.g., new Unlicense or CC0-1.0
crates) MAY be added without further policy review; other novel
dedication forms still go through "Review Required" below.

## Review Required

- MPL-2.0
- LGPL
- EPL
- CDDL
- Unicode licenses
- Creative Commons licenses
- Dual licenses
- Custom licenses

## Disallowed

- GPL
- AGPL
- SSPL
- BUSL
- No license
- Unknown license

## Overrides

Exceptions live in `LICENSE_OVERRIDES.json` at the repo root. Each
entry MUST pin `name`, exact `version`, declared `license`, `tier`
(`allowed` or `review-required`), `rationale`, `approvedBy`
(maintainer handle), and `approvedAt` (ISO-8601 date). `expiresAt`
(ISO-8601 date) SHOULD be set within 12 months of `approvedAt`; a
present-and-past `expiresAt` deactivates the override and the package
is re-evaluated against the allow-list.

Disallowed licenses (GPL/AGPL/SSPL/BUSL/no-license/unknown) MUST NOT
be overridden under any circumstances; an override carrying one of
these is rejected at load time. Adding any other override requires
maintainer review on the PR that introduces it.

The schema is enforced by `scripts/check-licenses.ts` at every
`pnpm conformance` run; unknown fields cause an immediate failure.

## Clean-room Principle

SENN is an independent implementation.

The project may study:

- Public standards
- Public documentation
- Public behavior
- Academic papers
- High-level architecture ideas

The project must not copy:

- Source code from incompatible projects
- UI assets
- Branding
- Text
- Proprietary materials
- AGPL/GPL code

## AI Development Policy

AI-generated code must follow this license policy.
Do not copy code from external repositories.
Prefer browser standard APIs over dependencies.
Before adding dependencies, check license, maintenance, bundle size, and security.
