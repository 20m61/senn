# SENN Security Model

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

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
- Manifest signature verification with three host-selectable modes
  (`none` / `optional` / `required`; ADR-0008 §6)

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
- Compromised or subpoenaed signaling / TURN operators (metadata exposure)

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

The trust chain for add-ons that ship through a SENN registry:

- **Per-add-on manifest signing.** Every signed publisher ships a
  detached `manifest.sig.json` next to `manifest.json`
  ([ADR-0008](adr/0008-manifest-signing.md);
  [addon-signing-spec.md](addon-signing-spec.md)). Signatures are
  Ed25519 over the canonical manifest bytes. The host SHALL select
  one of three verify modes:
  - `none` — accept unsigned manifests; intended for local development.
  - `optional` — accept any manifest, but a missing or invalid
    signature surfaces a UI badge.
  - `required` — refuse to load any manifest without a valid
    signature against a registry-pinned key.
- **Registry-pinned trust root.** Registries enumerate the public
  keys (`trustedKeys`) used to sign add-ons under their namespace.
  Schema v3 (registry index format) covers version histories,
  audits, and the publisher submission envelope
  ([ADR-0017](adr/0017-registry-schema-v2.md);
  [ADR-0020](adr/0020-registry-schema-v3.md)).
- **Key rotation with overlap window.** A registry MAY publish more
  than one trusted key at a time. The rotation procedure announces
  the new key in the registry ahead of cutover, signs at least one
  release with both keys to give downstream verifiers a window to
  refresh their cache, then closes the old key
  ([ADR-0010](adr/0010-key-rotation.md)). Emergency rotation drops
  the old key immediately and SHOULD be paired with a published
  incident note.
- **Version monotonicity.** Manifest schema requires `version` to
  strictly increase over previously published versions for the same
  `id` ([addon-manifest.md §Validation rules](addon-manifest.md));
  registries reject downgrades and yanked-version installs.
- **Rollback via deprecate, not unpublish.** Hard removal of a
  published version is not in the trust model. Bad releases are
  flagged with a deprecation message via the registry; existing
  lockfiles continue to resolve, and new consumers see a warning.

## Threats vs. signaling / TURN operators

SENN moves the bytes peers send each other end-to-end (DTLS-SRTP for
media, DTLS over SCTP for data channels). It cannot move the
*existence* of those connections off-network: ICE needs a signaling
exchange, and symmetric NATs need a TURN relay to fall through. Both
are operated by someone, and that someone sees metadata.

This section is honest about what those operators can and cannot
learn. It is required reading before claiming the security
properties further down this page.

### Signaling tier (Tier 0 / Tier 1)

A signaling adapter carries SDP and ICE candidates between peers
before a session exists. Adapters are pluggable
([ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md)) and
include a URL-fragment / QR mode (no operator at all) and an HTTP
poll mode (any commodity host). A signaling operator that wants to
correlate sees:

| Visible | Not visible |
|---------|-------------|
| Room ids and peer ids that exchange offers/answers | Add-on payloads, persisted state, downstream RTC traffic |
| Approximate timing of session setup | Anything sent after `connected` |
| The IP that posted each signaling message | DTLS-protected bytes once the data channel is open |
| SDP/ICE candidate IP:port hints (per WebRTC) | The rest of the call |

The Tier 0 (URL fragment / QR) adapter has *no* operator — the
exchange happens out of band entirely. Use it when metadata
exposure to a server is the primary concern.

### TURN tier (Tier 2)

TURN relays opaque WebRTC packets when direct P2P fails. SENN does
not embed a default TURN service
([ADR-0013](adr/0013-tier-2-turn.md)); deployments choose to run
one (see [turn-deployment.md](turn-deployment.md)). A TURN operator
that wants to correlate sees:

| Visible | Not visible |
|---------|-------------|
| Both peers' public IP and port | DTLS-protected bytes (text, binary, audio, video) |
| Connection start, end, and duration | RTCDataChannel labels (`core.text`, `core.bin`) |
| Relayed byte counts per allocation | Add-on payloads, signed manifests, file transfer contents |
| The TURN username (i.e. the credential expiry timestamp) | The signaling exchange if Tier 0 / Tier 1 is on a different operator |

A subpoena to a TURN operator therefore yields connection metadata
but not message content. A TURN operator that is itself malicious
can, in principle, drop or delay packets, which surfaces as a
session `failed` state through PeerSession's existing event stream.
It cannot inject decrypted content because DTLS authenticates
both peers' keys to each other.

### Mitigations available to deployments

- Use Tier 0 (URL fragment / QR) for invites whenever the UX permits
  — it removes the signaling operator from the threat model entirely.
- Run signaling and TURN under separate operators; correlation
  requires colluding both, plus matching IPs across them.
- Rotate TURN credentials per-session
  ([ADR-0013](adr/0013-tier-2-turn.md) §3); a leaked credential
  expires before it is useful.
- Treat TURN access logs as sensitive: retain only as long as ops
  needs them, and ship them off the relay host.
- For high-sensitivity deployments, consider running the TURN relay
  under operator control rather than a third party. SENN does not
  prescribe this; the contract is the same either way.

## Security Claims

SENN may claim:

- Dynamic communication data is not stored on SENN application servers.
- Add-ons communicate through permission-controlled Core APIs.
- Add-ons are sandboxed.
- Users control local persistence.
- Peer-to-peer message content is end-to-end encrypted; signaling
  and TURN operators see metadata only (see "Threats vs. signaling /
  TURN operators" above).

SENN must not claim:

- Perfect anonymity.
- Perfect security.
- All third-party add-ons are safe.
- Direct P2P always succeeds.
- Data shared with peers can always be deleted remotely.
- Connection metadata (who connected to whom, when, from which IP)
  is hidden from a relay or signaling operator.

## Accepted operational risks

The following trade-offs are deliberate. They are documented here so a
reader who is evaluating SENN's security posture sees the full picture
— not just the controls that succeed, but the gaps that the project
has consciously accepted in exchange for some other property.

### No CI vendor on the canonical repo (ADR-0021 / ADR-0022)

The repository ships no `.github/workflows/` or any other CI vendor
configuration. The contract is `pnpm conformance` plus the
`.githooks/pre-push` hook, both running on the maintainer's
workstation.

- **What this buys.** No third-party CI runner has access to the
  repository's secrets (`NPM_TOKEN`, signing keys, etc.). The publish
  trust boundary is the maintainer's machine, full stop. A compromise
  of any CI vendor cannot reach SENN releases.
- **What this costs.** There is no second runner that catches
  environment-specific regressions (Node version drift, Linux-vs-macOS
  filesystem behaviour, network-dependent test flakes). If the
  maintainer's local env diverges from a typical contributor env, the
  divergence is detected only at PR review.
- **Mitigation.** Pin the toolchain (`.nvmrc`, `packageManager`
  fields). Run the full gate locally before every push (the pre-push
  hook makes this default). Rely on contributor PR diversity for
  cross-environment coverage.

### Playwright e2e is out of the conformance gate

`pnpm conformance` deliberately excludes Playwright e2e (~25 min per
browser). Reviewers run e2e on demand for UI-touching PRs (see
`CONTRIBUTING.md §End-to-end tests`).

- **What this buys.** The conformance gate stays under ~3 min, which
  keeps the pre-push hook usable. A 30+ min hook would push
  contributors toward `--no-verify`.
- **What this costs.** UI regressions can land on `develop` if a
  reviewer skips the manual e2e run on a PR that touches `apps/web/`
  or `apps/addon-gallery/`.
- **Mitigation.** `CONTRIBUTING.md` flags the responsibility. The
  unit/contract test suites in `apps/web/` and the `addon-gallery`
  cover the non-browser slice of the same code paths.

### v1 Nostr signaling is plaintext by default (ADR-0014 / ADR-0024)

`@senn/signaling-nostr` ships v1 frames as JSON plaintext on the relay.
ADR-0024's NIP-44 v2 cipher is OPTIONAL and opt-in via
`new NostrSignaling({ enableV2Encryption: true, ... })`. v2 default-on
is deferred (no decision ADR yet) because it would break mixed-version
rooms where peers run different `@senn/signaling-nostr` versions.

- **What this buys.** Backward compatibility with any future SENN host
  that has not yet shipped the v2 path; smaller mental model for the
  default integration.
- **What this costs.** A relay operator (or a passive observer of the
  relay) can read SDP and ICE candidate IPs in v1 mode. The signaling
  operator threat model in §"Threats vs. signaling / TURN operators"
  applies in full to v1.
- **Mitigation.** Hosts with metadata-sensitive deployments SHOULD
  flip `enableV2Encryption: true` at construction time. ADR-0024 §5
  guarantees that v2 senders interoperate with v1 receivers and vice
  versa within the same room (silent discard on the v1 side, v1
  fallback on the v2 side), so v2 can be enabled per-host without
  coordinating across all peers.

### Single-maintainer key custody (`docs/governance.md`)

The bootstrap maintainer is the sole holder of the official-add-on
signing key (ADR-0008) and of the npm publish identity. There is no
escrow.

- **What this buys.** No second-party trust to manage during pre-alpha.
  Decisions and signing happen at one workstation.
- **What this costs.** Loss of that workstation (or of access to the
  npm account / signing keystore) blocks every signed release until
  the keystore is restored or rotated.
- **Mitigation.** ADR-0010 documents the rotation procedure (planned
  + emergency). `docs/governance.md` Holders table is the authoritative
  record of current custody. The custody policy itself —
  including the deferral of third-party escrow, the mandatory offline
  encrypted backup of all three sensitive secrets (official add-on
  signing key, npm publish token, minisign release-signing key), and
  the secondary-maintainer recruitment gate at v1.0 — is governed by
  [ADR-0029](adr/0029-secondary-maintainer-and-key-custody.md).
