# ADR 0007: Vendor-neutral signaling and relay

## Status

Accepted

## Context

WebRTC requires an out-of-band exchange of SDP/ICE before a peer connection can
be established. Direct P2P also benefits from an optional TURN relay when both
peers sit behind restrictive NATs.

Both pieces are easy to provide as a hosted service, and easy to lock the
project into a single vendor for. The SENN charter explicitly rejects vendor
lock-in (see [docs/charter.md](../charter.md)), and SENN must remain operable
on commodity infrastructure — including shared rental hosting that does not
support long-lived processes.

## Decision

1. SENN Core depends on **abstract interfaces**, not on any specific signaling
   service or TURN provider:

   - `SignalingTransport` (defined in `@senn/protocol`) is the only contract
     Core sees for the SDP/ICE exchange.
   - TURN servers are passed in as an `RTCConfiguration.iceServers` array
     supplied by the host application; Core does not embed any defaults.

2. SENN ships **multiple reference adapters** in tree, none of which is
   required:

   - URL/QR fragment adapter — zero infrastructure, suitable for one-shot
     invites and offline demos.
   - HTTP short-poll adapter — works against any endpoint that accepts a small
     JSON `PUT` and serves it back for a short TTL. Implementable on PHP,
     Node, Python, serverless, or by a single cron + flat file. No vendor
     specifics in Core.
   - WebSocket adapter — for self-hosted or PaaS-style commodity runtimes.

3. Optional adapters built on **existing open networks** (Nostr, Matrix) MAY
   be shipped, but only after their own ADRs are accepted, and they MUST NOT
   become a hard dependency of Core.

4. SENN Project itself does **not** operate a default signaling service or a
   default TURN service. The reference deployment guide describes how to run
   each tier on commodity infrastructure.

## Rationale

- SENN's privacy claims rest on the absence of a central data custodian.
  A vendor-required signaling service would re-introduce one.
- A protocol-shaped contract makes the system survivable: if any single
  adapter, network, or operator disappears, peers can switch by changing
  configuration.
- Shipping reference adapters, but not requiring any, lets us keep Core small
  and lets operators choose the cheapest tier appropriate to their use case.
- Existing open networks (Nostr, Matrix) provide federation properties that
  SENN does not want to recreate; treating them as adapters lets us benefit
  without taking a hard dependency.

## Consequences

- Core gains an abstraction boundary it must not leak through. Any feature
  that "needs the signaling layer to do X" is a smell — Core works through
  the interface or not at all.
- The `SignalingTransport` interface becomes a normative part of the protocol
  and lives in `@senn/protocol`. Changes to it require a spec / ADR update.
- The deployment story is more documentation work but a much smaller runtime
  story: SENN does not have to ship or operate a hosted service.
- Users have to make an informed choice of adapter at deployment time.
  Documentation must guide that choice without privileging a vendor.
