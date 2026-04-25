# ADR 0003: Add-on Sandbox Model

## Status

Accepted

## Decision

Add-ons run in sandboxed iframes and communicate with Core through postMessage.
Add-ons do not receive raw WebRTC, DataChannel, or storage handles.

## Rationale

This allows third-party add-ons while maintaining Core-controlled data flow and security boundaries.

## Consequences

- Core acts as the single chokepoint for permission checks, validation, and rate limiting.
- Add-ons cannot exfiltrate data via WebSocket / fetch because the default CSP sets `connect-src 'none'`.
- A postMessage-based bridge needs explicit versioning to remain stable across Core releases.
