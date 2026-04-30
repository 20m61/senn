# ADR 0024: Encrypted Nostr signaling content via NIP-44

## Status

**Implemented** (2026-04-30). All Status-flip preconditions are met:

- Implementation in `@senn/signaling-nostr` shipped at commit ff0c619
  (PR #30): `packages/signaling-nostr/src/v2.ts` (HKDF derivation,
  sentinel handling, NIP-44 v2 round-trip, construction-time KAT) and
  the receive-path update in `packages/signaling-nostr/src/index.ts`
  implementing the §5 7-step ordered logic.
- `docs/signaling-nostr-spec.md` v2 section shipped at commit f0fee8a
  (PR #24).
- `pnpm verify:nostr-self-test` covers all four §8 MUST clauses
  (v2 round-trip, v1↔v2 fallback, v2↔v1 silent discard, sentinel
  detection). Reported as 9 ok lines in the conformance summary.

Originally Accepted 2026-04-29. The wire shape (NIP-44 v2 cipher,
room-key derivation, sentinel prefix, v1 fallback) was finalised at
that time and is unchanged.

## Context

[ADR-0014](0014-signaling-nostr.md) introduced the `@senn/signaling-nostr`
adapter, which encodes the `content` field of every kind-25556 event as the
plaintext JSON of a `SignalingMessage` (v1). ADR-0014 §Decision item 4
recorded the rationale: the relay already sees connection metadata and the
`t`-tag room identifier; encrypting SDP bytes hides nothing the relay could
not infer from the ICE flow. ADR-0014 §Consequences explicitly deferred a
v2 encrypted variant, naming NIP-44 over a room-derived symmetric key as
the candidate form, and committed to keeping v1 frames decodable during a
transition window.

The deferral is now complete. Two motivations close the gap:

1. **Signaling payload confidentiality.** SDP offers and ICE candidates
   contain the local IP addresses and port numbers of both peers. While a
   relay operator cannot break the end-to-end WebRTC connection, they can
   harvest address metadata from every plaintext event. Encrypting the
   `content` field eliminates that leakage without changing the relay
   subscription model.

2. **Mixed-version interoperability.** Before a v2 shape is locked, any
   receiver that upgrades ahead of a sender has no reliable way to detect
   the wire version. Locking the v2 wire now lets both sides handle
   `v1 sender ↔ v2 receiver` and `v2 sender ↔ v1 receiver` deterministically.

Constraints inherited from ADR-0007 and ADR-0014:

- The `SignalingTransport` interface from `@senn/protocol` is the only
  contract Core sees; the encryption layer is entirely inside the adapter.
- No SENN-project trust point may appear on the signaling path. The
  encryption key MUST be derivable from the invite material alone; there is
  no additional key-exchange step and no SENN-operated key service.
- The adapter remains opt-in. No other workspace package takes a hard
  dependency on this adapter or on the NIP-44 cipher.
- v2 MUST work against any compliant NIP-01 relay. No relay-specific
  extension (including NIP-42 AUTH) is required.

The threat model from ADR-0014 is unchanged: the invite link (which embeds
the `roomId` per `docs/room-and-invite-spec.md`) is the trust boundary. Any
peer in possession of a valid invite can join and decrypt; relay operators
and passive observers who do not hold the invite cannot. Forward secrecy and
per-identity authenticated key exchange are explicitly out of scope (see
§Out of scope below).

## Decision

Adopt NIP-44 v2 (ChaCha20 + HMAC-SHA256 in encrypt-then-MAC
composition, with HKDF-SHA256 key derivation, per the NIP-44
specification at https://github.com/nostr-protocol/nips/blob/master/44.md)
as the OPTIONAL v2 content cipher for kind-25556 events in the
`@senn/signaling-nostr` adapter, keyed off a room-derived symmetric secret,
with a 4-byte ASCII sentinel `nv44` prepended inside the plaintext to enable
version detection, and with a mandatory v1 fallback so that mixed-version
rooms degrade gracefully.

Specifically:

### 1. Cipher: NIP-44 v2

The v2 content cipher is NIP-44 v2 exactly as the NIP-44 specification
defines it: ChaCha20 (12-byte nonce, the standardised variant — not
XChaCha20) for the encrypted payload, with HMAC-SHA256 over the
ciphertext as the authentication tag in encrypt-then-MAC composition,
and HKDF-SHA256 applied to the conversation key for per-message
sub-key derivation. Implementations MUST NOT use the deprecated
NIP-44 v1 variant. The NIP-44 ciphertext envelope (`version || nonce
|| ciphertext || mac`, base64 standard-encoded) is placed directly in
the Nostr event's `content` field, replacing the v1 JSON string.

### 2. Room key derivation

The encryption key is derived deterministically from the `roomId` and no
other secret:

```
encryption_key =
  HKDF-SHA256(
    salt = UTF-8("senn-nip44-v1"),
    ikm  = UTF-8(roomId),          // 26-char Crockford base32 RoomId
    info = UTF-8("senn:nostr-signaling:v2"),
    L    = 32
  )
```

This key is used as the NIP-44 v2 conversation key (the `shared_x` slot in
the NIP-44 key-derivation step). No Diffie-Hellman step is performed; the
room key is symmetric and does not involve the ephemeral Nostr keypair.

**Threat model note.** Because the key derives solely from the `roomId`, any
peer that holds a valid invite — including an unauthorised joiner who obtained
the invite link — can decrypt all v2 content in that room. This is by design
and matches the ADR-0014 threat model: the invite link is the trust boundary.
Relay operators who do not hold the invite cannot decrypt, which is the
primary confidentiality property gained over v1.

### 3. Sentinel prefix

A sender MUST prepend the 4-byte ASCII string `nv44` (bytes `6e 76 34 34`)
to the JSON-encoded `SignalingMessage` before encrypting. The plaintext
passed to NIP-44 is therefore `"nv44" + JSON.stringify(signalingMessage)`.
This sentinel is internal to the plaintext and is not visible in the
ciphertext or the Nostr event envelope.

The sentinel enables receivers to distinguish a SENN-v2 envelope from a
hypothetical future format without adding a new Nostr tag or changing the
event kind. A receiver that decrypts successfully and finds the prefix `nv44`
MUST strip it before JSON-parsing the `SignalingMessage`. A receiver that
decrypts successfully but does not find the `nv44` prefix MUST treat the
content as a format error (not a v1 frame — v1 frames are never encrypted).

### 4. Send path (v2 opt-in)

A v2 sender MUST:

1. Derive `encryption_key` as specified in §2.
2. Construct the plaintext: `UTF-8("nv44") || UTF-8(JSON.stringify(signalingMessage))`.
3. Apply NIP-44 v2 encryption using `encryption_key` as the conversation key.
4. Place the resulting base64 ciphertext in the Nostr event's `content` field.
5. Leave `kind`, `tags`, and all other event fields unchanged from v1.

The adapter's constructor or a runtime flag MAY enable v2. When v2 is not
enabled, the adapter MUST default to v1 plaintext behaviour (ADR-0014).

### 5. Receive path (v2 + v1 fallback)

A receiver MUST follow this ordered logic on every inbound kind-25556 event
whose `t` tag matches the current room:

1. Parse the bare `<roomId>` out of the matched `t` tag (the 26-char
   Crockford base32 segment after the `senn:` prefix) and apply the §2
   derivation with `ikm = UTF-8(<roomId>)` — never `ikm =
   UTF-8("senn:<roomId>")`. Including the prefix in `ikm` produces a
   different key from a peer that follows §2 and breaks v2 decryption
   deterministically.
2. Attempt NIP-44 v2 decryption of `content` using `encryption_key`.
3. If decryption succeeds and the plaintext begins with `nv44`, strip the
   prefix and JSON-parse the remainder as a `SignalingMessage`. This is the
   v2 path.
4. If decryption succeeds but the plaintext does not begin with `nv44`,
   the receiver MUST treat the event as a format error and discard it
   (per §3). The receiver MUST NOT attempt the v1 fallback in this case;
   v1 frames are never NIP-44 ciphertext, so a successful NIP-44
   decryption without the sentinel implies a foreign or future format.
5. If decryption fails, attempt to JSON-parse `content` directly as a
   v1 `SignalingMessage`. This is the v1 fallback path.
6. If both paths fail (step 4 discard or step 5 parse failure), discard
   the event. The adapter MUST NOT surface a parse error to the
   `SignalingMessage` handler.
7. Both paths converge on the same `SignalingMessage` handler. The wire
   version is an adapter-internal concern; Core sees no difference.

_(Informative.)_ A receiver that cannot perform NIP-44 decryption
(e.g., an older build that predates this ADR) falls through to step 5
automatically, since the v2 ciphertext is not valid JSON and the v1
JSON parse will fail too. That receiver silently discards v2 frames,
which is the correct degraded behaviour.

### 6. Tag and kind stability

The Nostr event's `kind` remains 25556. The `t` tag format
`["t", "senn:<roomId>"]` is unchanged. Existing relay filters (§REQ on
`kinds=[25556]` + `#t=["senn:<roomId>"]`) continue to match v2 events
without relay-side awareness of NIP-44.

### 7. Ephemeral keypair discipline

The ephemeral secp256k1 keypair rotation defined in ADR-0014 §3 is
unchanged. NIP-44 encryption is content-only; the Nostr event `pubkey`
and `sig` fields remain the output of the ephemeral keypair and carry the
same advisory-authenticity meaning they did in v1. The room symmetric key
MUST be independent of the ephemeral keypair: implementations MUST NOT
mix the ephemeral secp256k1 secret (or any other identity material) into
the §2 HKDF derivation. Coupling the encryption identity to the
ephemeral signaling identity would erode the privacy properties
ADR-0014 §3 grants the keypair, and would defeat the cross-relay
unlinkability v2 inherits from per-event nonces.

### 8. Conformance surface extension

`pnpm verify:nostr-self-test` MUST be extended to cover:

- v2 round-trip: a v2 sender and v2 receiver in the same room exchange a
  `SignalingMessage` end-to-end through the in-process mock relay; the
  receiver's handler fires exactly once with the correct payload.
- Mixed-version graceful degradation (v1 sender ↔ v2 receiver):
  a v1 sender and v2 receiver in the same room; the v2 receiver
  correctly parses the v1 plaintext frame via the §5 fallback path.
- Mixed-version graceful degradation (v2 sender ↔ v1 receiver):
  a v2 sender and a v1-only receiver in the same room; the v1-only
  receiver discards the ciphertext silently (its v1 JSON parse fails;
  it has no decryption path) and never surfaces a parse error to the
  handler. This direction is the §Context motivation for locking the
  v2 wire deterministically and MUST be observed in the gate.
- Sentinel detection: a v2 receiver that receives a ciphertext whose
  plaintext lacks the `nv44` prefix discards the event without error.

The in-process NIP-01 mock relay used by `verify:nostr-self-test` requires
no NIP-44 awareness: encryption and decryption are end-to-end between the
adapter instances under test, not relay-side.

### Out of scope

The following are explicitly deferred and MUST NOT be implemented under
this ADR:

- **Forward secrecy.** Per-message DHKE with each joiner would require a
  key-exchange sub-protocol on the signaling channel before signaling
  itself can begin, and would break the invite-only-entry model. Deferred
  to a future ADR.
- **Authenticated key agreement against a Nostr identity.** Anchoring
  the encryption key to a long-lived Nostr identity would re-introduce a
  project trust point on the signaling path, which ADR-0014 and ADR-0007
  jointly prohibit.
- **NIP-44 v1 (deprecated).** Only NIP-44 v2 is targeted. Implementations
  MUST NOT fall back to NIP-44 v1.
- **Re-keying mid-session.** Implementations MUST NOT re-derive the
  room key during the lifetime of a single `roomId`. A new room
  requires a new invite and a new key derivation.
- **Relay-level NIP-44 extensions.** The adapter relies on standard
  NIP-01 frames; no relay-specific encrypted-DM or group-message extension
  is used.

## Rationale

- **Why NIP-44 v2.** NIP-44 v2 is the only standardised Nostr content
  cipher: it is well-specified, widely implemented in Nostr libraries, and
  uses conservative primitives (ChaCha20 + HMAC-SHA256 + HKDF-SHA256;
  ChaCha is preferred over XChaCha because the latter is not
  standardised, and HMAC-SHA256 over Poly1305 because polynomial MACs
  are easier to forge under nonce reuse). Using a
  SENN-custom cipher would raise the implementation burden without improving
  the security properties relevant to this threat model.
- **Why HKDF over the roomId rather than a separate key exchange.** The
  invite-link-as-trust-boundary model (ADR-0014) means the `roomId` is
  already the secret shared among authorised joiners. Deriving the key from
  it requires no additional UI, no additional network round-trip, and no
  additional trust point. The cost — any invite holder can decrypt — is
  exactly the cost of joining the room; it is not an additional cost.
- **Why a plaintext sentinel instead of a new tag.** A new Nostr event tag
  visible on the relay would expose the wire version to relay operators and
  passive observers. Burying the sentinel inside the ciphertext keeps the
  version negotiation end-to-end and relay-opaque.
- **Why v1 fallback is mandatory.** Locking out v1 peers would create an
  abrupt migration cliff during the transition window. The fallback is
  trivial to implement (try decrypt, fall back to parse), and its cost
  disappears once all peers in a deployment have upgraded.
- **Why the room key is independent of the ephemeral Nostr keypair.** Mixing
  the Nostr keypair into the encryption key would tightly couple the
  signaling identity to the encryption identity, creating a new correlation
  surface. The ephemeral keypair's privacy properties are already defined by
  ADR-0014; this ADR must not erode them.

## Consequences

### Positive

- Relay operators can no longer read SDP offers and ICE candidates (which
  include peer IP addresses and ports) from plaintext event content. The
  confidentiality benefit applies even against an operator who stores
  ephemeral-range events in violation of NIP-01.
- The wire version is self-describing inside the ciphertext; no new tag,
  no version field in the outer Nostr event, and no relay configuration
  change is required.
- The room key derivation is deterministic and invite-only: an authorised
  joiner reconstructs the key from the invite link without any additional
  negotiation step.
- v1 senders and v2 receivers interoperate during the transition window via
  the mandatory v1 fallback. No room breaks; no user action is required for
  a mixed deployment.
- NIP-44 v2 is already available in the major Nostr signing libraries
  (`nostr-tools` v2+); the incremental implementation cost for the adapter
  is low.
- Works against any NIP-01-compliant relay: no relay upgrade, no
  relay-specific extension, no vendor dependency.

### Negative

- **Symmetric key scope.** Any peer with the invite link — including one
  who obtained it through forwarding or leakage — can decrypt all v2
  content in the room. This is the designed threat model (invite = trust
  boundary) and not a regression from v1, but it must be stated explicitly.
- **No forward secrecy.** A passive observer who records all ciphertext and
  later obtains the roomId (e.g., through a leaked invite) can decrypt the
  session retroactively. Mitigated only by the short TTL of kind-25556
  ephemeral events; structural forward secrecy requires a future ADR.
- **Reversibility cost.** Rolling back from v2 to v1 is straightforward in
  code (disable the v2 flag; the fallback path still handles v1 frames), but
  any content that was only ever sent as v2 ciphertext is opaque to peers
  that rolled back. For signaling messages (ephemeral, session-scoped) this
  is acceptable: a peer that rolls back simply renegotiates from a fresh
  invite.
- **NIP-44 dependency surface.** The adapter takes a harder dependency on
  the NIP-44 v2 cipher spec. If NIP-44 v2 is later found to have a
  cryptographic weakness, the adapter's v2 path must be patched or retired;
  v1 plaintext remains available as a fallback.
- **Conformance test scope expansion.** `pnpm verify:nostr-self-test`
  gains three new MUST clauses (§8), adding test surface and (marginally)
  gate runtime.

### Neutral / follow-up

- ADR-0014 is not superseded. v1 plaintext remains a valid operating mode;
  this ADR adds v2 as an opt-in variant.
- Forward secrecy (per-message DHKE) and authenticated key agreement
  (NIP-44 ECDH against a long-lived identity key) are explicitly deferred;
  they each require their own ADR with a threat-model section.
- Re-keying on room membership change (e.g., after a peer drops) is out of
  scope; rooms are ephemeral and a new session uses a new invite and a new
  `roomId`.
- `docs/signaling-nostr-spec.md` MUST be updated in the same PR that ships
  the v2 implementation to reflect the v2 `content` encoding, the §2 key
  derivation, the §3 sentinel, and the §5 receive path. The spec section
  covering the `NostrEventV1` interface shape will gain a v2 counterpart.

## Related

- ADR-0007: [Vendor-neutral signaling and relay](0007-vendor-neutral-signaling-and-relay.md) — vendor-neutrality constraint this ADR must satisfy; no relay-specific extension permitted.
- ADR-0014: [Nostr signaling adapter](0014-signaling-nostr.md) — extended by this ADR; v1 wire shape and ephemeral keypair discipline remain authoritative.
- Spec: [docs/signaling-nostr-spec.md](../signaling-nostr-spec.md) — normative wire shape; must be updated to reflect v2 content encoding.
- Spec: [docs/room-and-invite-spec.md](../room-and-invite-spec.md) §RoomId — the `roomId` that seeds the §2 HKDF derivation.
- Spec: [docs/security-model.md](../security-model.md) — threat model the symmetric key scope claim is grounded in.
- NIP-44: https://github.com/nostr-protocol/nips/blob/master/44.md — normative reference for the ChaCha20 + HMAC-SHA256 + HKDF-SHA256 cipher (encrypt-then-MAC).
