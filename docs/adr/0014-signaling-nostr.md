# ADR 0014: `@senn/signaling-nostr` — federated signaling over Nostr relays

## Status

Accepted

## Context

[ADR-0007](0007-vendor-neutral-signaling-and-relay.md) committed SENN
to multiple `SignalingTransport` adapters and explicitly mentioned
Nostr as a future opt-in transport, gated by its own ADR. Tier 0
(URL fragment) and Tier 1 (HTTP poll) cover the local + commodity
cases. This ADR adds the missing federation case: connect to a set
of operator-independent Nostr relays so an offer in one network
neighbourhood can reach a joiner in another without anyone running
a SENN-specific endpoint.

Constraints:

- The adapter MUST satisfy `SignalingTransport`. Core sees no
  difference from URL fragment or HTTP poll.
- The Nostr identity MUST NOT be a SENN-project key. The SENN
  charter rules out any project-operated trust point on the
  signaling path. Each session generates a throwaway keypair.
- Signaling messages are short-lived; persisting them across days
  buys nothing and leaks correlation data. We need a Nostr event
  kind that relays are encouraged to drop quickly.
- The package stays opt-in: a deployment that does not need Nostr
  must not pay a dependency cost for it.

## Decision

1. **Event kind 25556 (ephemeral range).** Nostr's ephemeral kind
   range is `20000–29999`; relays MUST NOT persist events in this
   range (NIP-01). 25556 is unclaimed by current NIPs and falls
   inside that range. This lets a SENN session reuse public Nostr
   relays without leaving a trail.

2. **Room routing via a single `t` tag.** Each event carries
   exactly one tag `["t", "senn:<roomId>"]`. Subscribers REQ on
   `kinds=[25556]` + `#t=["senn:<roomId>"]`. This avoids defining a
   new tag namespace and keeps the filter cheap on existing relay
   software.

3. **Ephemeral keypair per `HttpPollSignaling`-equivalent session.**
   The adapter generates a fresh secp256k1 keypair on construction
   (or accepts one from the host). Authenticity inside the SENN
   protocol is provided by `PeerId` in `SignalingMessage` plus the
   forthcoming addon-manifest signing chain — Nostr's own pubkey is
   advisory only.

4. **Content is the JSON-encoded `SignalingMessage` (v1 plaintext).**
   The relay already sees who connects to it and what tag the event
   carries; encrypting the SDP only hides byte-level fields the
   relay would learn from ICE flow anyway. v2 may add NIP-44 over a
   room-derived symmetric key.

5. **Relays are configured by the host, not by Core.** The adapter
   takes `relays: string[]`. SENN does not embed a default relay
   list — same logic as ADR-0013 for TURN.

6. **At-least-once delivery, dedup at the receiver.** The adapter
   tracks delivered Nostr event ids per room and skips duplicates
   that arrive on different relays. The wire is pure NIP-01 frames
   (`["EVENT", …]`, `["REQ", subId, …]`, `["CLOSE", subId]`) — no
   relay-specific extensions.

7. **No NIP-42 (relay AUTH) requirement.** Anonymous publish/read
   suffices; relays demanding AUTH are not in scope for v1.
   Operators that want auth wire it through their relay choice.

## Rationale

- Reusing the existing Nostr ecosystem buys federation with zero
  new infrastructure: any relay an operator already trusts is a
  candidate. A wave of sympathetic relay operators emerges
  trivially.
- Ephemeral kind 25556 gives us "the bus is the relay" semantics
  without making relays accidentally store SDP forever.
- Tag-only routing keeps the filter simple and lets relays handle
  it through existing index code; no NIP needs writing.
- A throwaway keypair removes the temptation to anchor SENN identity
  to a Nostr identity, which would re-introduce the project-vendor
  problem ADR-0007 just removed.
- Plaintext content for v1 matches the candor of the existing HTTP
  poll adapter: the relay sees the same connection metadata either
  way. Encryption is a follow-up ADR; locking in the wire now would
  block the simplest opt-in.

## Consequences

- A new `@senn/signaling-nostr` workspace package ships, with a
  single dependency on a Nostr signing library (`nostr-tools`). The
  package is opt-in; no other workspace package imports from it.
- `docs/signaling-nostr-spec.md` codifies the wire shape: kind,
  tag, content schema, dedup, and reconnect behaviour.
- Operators who want to require AUTH or to run their own NIP-29
  group will fork this adapter; the contract is the
  `SignalingTransport` interface, so swapping is trivial.
- A future v2 adds NIP-44 encryption keyed off a room-derived shared
  secret; the v1 plaintext frames remain decodable for that v2
  receiver during a transition window.
- Compatibility: the adapter speaks plain NIP-01. Any compliant
  Nostr relay should accept it without configuration.
