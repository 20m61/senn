# ADR 0005: Local-first Persistence

## Status

Accepted

## Decision

Persistence in SENN is local-first and user-controlled.

- Default behavior: no persistence of dynamic communication data.
- Optional persistence is provided through `packages/storage`, exposing per-add-on namespaces over IndexedDB and OPFS.
- P2P sync is opt-in and explicit; SENN never silently uploads stored data to any server.

## Rationale

- Aligns with the project charter: servers do not store dynamic communication data.
- Keeps the security model simple — there is no shared backend store to compromise.
- Lets users own their data on their device.

## Consequences

- Cross-device continuity is not provided out-of-the-box; if needed it must be implemented as an add-on with explicit user consent.
- Data lost from a device may be unrecoverable unless the user has an explicit backup.
- Storage isolation between add-ons is enforced by Core, not by the browser alone.
