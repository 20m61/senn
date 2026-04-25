# ADR 0002: License Strategy

## Status

Accepted

## Decision

SENN Core will use Apache License 2.0.
Dependencies are limited to permissive licenses unless reviewed.
GPL, AGPL, SSPL, BUSL, unknown-license packages are disallowed.

## Rationale

SENN aims to support commercial use, third-party add-ons, enterprise adoption, and clean independent implementation.

## Consequences

- Forks and embeddings are explicitly allowed.
- The "SENN" name and "SENN Verified" mark are protected separately via [TRADEMARK.md](../../TRADEMARK.md).
- Dependency reviews follow [docs/license-policy.md](../license-policy.md).
