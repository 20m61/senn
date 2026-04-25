# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SENN Core, an official add-on, or
the SENN distribution toolchain, please report it privately.

- Do not open a public GitHub issue.
- Email the maintainers (address to be published before the first public release).
- Provide reproduction steps, impact assessment, and your contact information.

We aim to acknowledge reports within 7 days and to provide a remediation plan
within 30 days of acknowledgement, depending on severity.

## Scope

In scope:

- SENN Core runtime (`packages/core`, `packages/protocol`, `packages/addon-runtime`)
- Official add-ons under `addons/official/`
- Manifest validation and signing toolchain (`scripts/`)

Out of scope:

- Third-party / community add-ons not signed by the SENN Verified Registry.
- Browser-level vulnerabilities.
- Attacks requiring physical access to a peer's device.

## Security Model

See [docs/security-model.md](docs/security-model.md).
SENN's primary defense is to avoid centralizing dynamic communication data in
the first place; transport is direct P2P, and persistence is local-first and
explicitly user-controlled.
