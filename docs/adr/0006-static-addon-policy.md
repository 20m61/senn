# ADR 0006: Static Add-on Policy

## Status

Accepted

## Decision

SENN add-ons are static files.
They may provide UI, rendering, and local logic, but may not directly perform dynamic network communication.

## Rationale

This keeps add-ons easy to distribute, inspect, cache, and sandbox.

## Consequences

- Add-ons can be hosted on any static CDN or self-hosted directory.
- The default CSP (`connect-src 'none'`) is enforceable by Core.
- "Network add-ons" are explicitly out of scope until a future ADR re-opens the question.
