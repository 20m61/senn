# ADR 0013: Tier 2 TURN — vendor-neutral relay strategy

## Status

Accepted

## Context

[ADR-0007](0007-vendor-neutral-signaling-and-relay.md) committed SENN
to multiple **signaling tiers** (Tier 0: URL/QR fragment, Tier 1:
HTTP poll, Tier 2-S: WebSocket), with no project-operated default.
That ADR also said TURN servers are passed as
`RTCConfiguration.iceServers` and SENN Core embeds no defaults.

What it did not specify: when does a deployment need TURN, who runs
it, what credentials look like, and how a host application supplies
TURN config to PeerSession without coupling Core to a vendor. As
local-vault and the chunked binary path both rely on `core.bin` over
RTCDataChannel, deployments behind symmetric NATs will start hitting
this wall.

Tier numbering used in this repo (clarification):

| Tier | Purpose | Examples already shipped |
|------|---------|--------------------------|
| Tier 0 | Out-of-band signaling | URL fragment, QR code |
| Tier 1 | Online signaling | HTTP poll, WebSocket |
| **Tier 2** | **Media/data relay (TURN)** | (none in tree; this ADR) |

This ADR does not add code. It pins the design contract so future
ADRs and PRs (a coturn quickstart, a TURN cred-vending adapter) all
fit together.

## Decision

1. **No project-default TURN service.** The SENN Project does not
   operate, recommend, or embed a TURN server. Hosts MUST supply
   their own `iceServers` if they want relay fallback.

2. **TURN config is data, not code.** PeerSession already accepts
   `RTCConfiguration` from the host. That stays the only seam. No
   `@senn/turn-*` package is added; there is nothing protocol-level
   to abstract. Different TURN providers differ in credential
   format, not in WebRTC behaviour.

3. **Credentials MUST be ephemeral.** Long-lived TURN credentials
   committed to a repo or shipped in client builds count as a
   compromise. Hosts MUST mint per-session (or per-room) credentials
   server-side using a TURN REST shared-secret scheme (RFC 5766
   §10.2 / `coturn use-auth-secret`) or equivalent and inject them
   into the client just before `new PeerSession({ rtcConfig })`.

4. **TURN does not see plaintext.** WebRTC's DTLS-SRTP and
   DataChannel encryption protects bytes end-to-end against the
   relay. The relay sees encrypted traffic and the public IPs of
   both peers. The threat model is therefore: a malicious or
   subpoenaed TURN operator can reveal connection metadata
   (when, between which IPs, how much) but not message content.
   This must be reflected in the Security Model page.

5. **TURN-required peers MUST tolerate falling back to STUN-only.**
   A peer that cannot reach the configured TURN server MUST keep
   trying STUN. The application surfaces a `connecting` ➜ `failed`
   state through PeerSession's existing event stream; the host
   chooses what to show. Core does not retry across `iceServers`
   lists itself — that's a host concern.

6. **No TURN auto-discovery.** SENN Core never fetches a TURN
   credential URL on its own. The host pulls credentials, vets the
   shape, and constructs `RTCConfiguration` before calling
   PeerSession. This keeps Core's network surface to exactly
   "what the WebRTC API does," matching the audit posture for
   add-ons (`connect-src 'none'`).

7. **Recommended deployment shape.** A reference operational guide
   ([docs/turn-deployment.md](../turn-deployment.md)) covers
   coturn-on-a-VPS as the simplest case, with per-session ephemeral
   creds vended by a small endpoint. Hosts that already operate
   their own infra (e.g. an existing meeting product) wire their
   creds endpoint into the same shape.

## Rationale

- The vendor-neutral move that ADR-0007 made for *signaling* applies
  unchanged to *relay*: the protocol is "WebRTC + ICE servers list",
  so abstracting it adds layers without buying anything.
- Per-session ephemeral creds are the single design choice that
  separates "TURN deployment that survives a leaked client build"
  from "TURN deployment that becomes a vendor of free bandwidth to
  the internet on first leak." The bar is low (a short HMAC).
- Refusing to embed a default TURN means an operator without
  symmetric-NAT users can ship SENN without paying for relay
  bandwidth, while operators who *do* need it pay only for what
  they use.
- Documenting the metadata-leak surface (rule 4) keeps SENN's
  charter claim honest: the project does not promise that *no one*
  can see *anything* — it promises that no central service holds
  user content.

## Consequences

- The host owns the TURN credential lifecycle. SENN does not give
  hosts a turnkey solution; it gives them the contract and a working
  example. Operationally heavier than "use our default" but
  consistent with everything else in this repo.
- The Security Model page needs a "Threats vs. TURN operators"
  section — a follow-up doc PR.
- Credential-vending endpoints are out of scope for `@senn/protocol`
  in this ADR. A future ADR may standardise a `/turn-cred`
  endpoint shape if multiple downstreams converge on one. For now,
  each operator picks.
- Compatibility: PeerSession's API is unchanged. Existing tests
  using `{ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }`
  remain the canonical "no relay" form.
