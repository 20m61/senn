# SENN Security Model

## Security Philosophy

SENN is secure primarily because it avoids collecting and centralizing dynamic user data.

Security is provided through:

- No server-side storage of dynamic communication data
- Core-managed data flow
- Sandboxed add-ons
- Permission-based APIs
- Local storage boundaries
- User-controlled persistence
- Static add-on distribution
- Optional signature verification

## Trust Boundaries

### Trusted

- SENN Core
- Verified Core distribution
- Browser security model

### Partially Trusted

- Official add-ons
- Verified add-ons
- Peers explicitly joined by invitation

### Untrusted

- Community add-ons
- Peer-provided payloads
- Imported files
- External static add-on sources

## Threats

- Malicious add-ons
- Add-on data exfiltration
- UI spoofing
- Oversized messages
- Malformed payloads
- File transfer abuse
- Capability spoofing
- Dependency vulnerabilities
- Supply-chain compromise

## Controls

### Sandbox

- Add-ons run in sandboxed iframe.
- Add-ons do not share Core JS context.
- Add-ons do not access raw network APIs.

### CSP

- `connect-src 'none'` by default.
- External dynamic communication is blocked.

### Permissions

- Add-ons declare permissions in manifest.
- Users approve sensitive permissions.
- Core enforces permission checks.

### Storage Isolation

- Per-add-on namespace.
- No cross-add-on access.
- No direct access to Core storage.

### Message Validation

- Envelope validation.
- Schema validation.
- Size limits.
- Rate limits.
- Capability checks.

### Distribution Security

- Verified add-ons are signed.
- Hashes are checked.
- Versions are tracked.
- Rollbacks are supported.

## Security Claims

SENN may claim:

- Dynamic communication data is not stored on SENN application servers.
- Add-ons communicate through permission-controlled Core APIs.
- Add-ons are sandboxed.
- Users control local persistence.

SENN must not claim:

- Perfect anonymity.
- Perfect security.
- All third-party add-ons are safe.
- Direct P2P always succeeds.
- Data shared with peers can always be deleted remotely.
