# Nostr Signaling Adapter Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Intent

Define a Tier-1 SENN signaling adapter that uses Nostr relays as the
SDP/ICE transport. This page is normative.

The decision and rationale live in
[ADR-0014](adr/0014-signaling-nostr.md). This page covers the wire
shape and the conformance bar.

The adapter is opt-in. SENN Core sees only `SignalingTransport`; a
deployment swaps in `NostrSignaling` for `HttpPollSignaling` or
`UrlFragmentSignaling` without recompiling anything.

## Normative checklist

- An adapter implementing this spec MUST satisfy `SignalingTransport`
  in `@senn/protocol` (`publish`, `subscribe`, `close`).
- The adapter MUST take `relays: string[]` via the constructor and
  MUST NOT embed any default list.
- The adapter MUST NOT log signed event bodies.
- The Nostr keypair the adapter signs with MUST be ephemeral by
  default (regenerated per construction). A host MAY pass an
  externally-generated key for testing purposes; SENN identity
  remains `PeerId`.
- Every published event MUST be of `kind: 25556`.
- Every published event MUST carry exactly one tag of the form
  `["t", "senn:<roomId>"]`. Additional tags are permitted but
  servers MUST tolerate adapters that ship none.
- Every published event's `content` MUST be the UTF-8 JSON encoding
  of a `SignalingMessage` (the same shape used by other adapters).
- Subscribers MUST `REQ` with the filter
  `{ kinds: [25556], "#t": [\`senn:${roomId}\`] }`. They MAY add a
  `since` timestamp to skip backfill on reconnect.
- The adapter MUST de-duplicate by Nostr event id across relays —
  publishing one logical message via N relays MUST surface to the
  receiver as one `SignalingMessage`.
- The adapter MUST emit the configured handler exactly once per
  distinct event id, even when reconnecting.
- The adapter MUST NOT use NIP-42 (relay AUTH). Relays requiring
  AUTH are not in scope for v1.
- The adapter MAY implement the OPTIONAL v2 content cipher defined in
  §"v2 content cipher (NIP-44, OPTIONAL)". A v2-capable adapter MUST
  also accept v1 plaintext frames per the §"Receive path" fallback.

## Wire frames (informative)

NIP-01 plain frames over WebSocket text messages:

```
client → relay  ["EVENT", <signed-event>]
client → relay  ["REQ", "<sub-id>", { "kinds": [25556], "#t": ["senn:<roomId>"] }]
client → relay  ["CLOSE", "<sub-id>"]

relay  → client ["EVENT", "<sub-id>", <signed-event>]
relay  → client ["EOSE",  "<sub-id>"]
relay  → client ["NOTICE", "<msg>"]
relay  → client ["OK", "<event-id>", true|false, "<msg>"]
```

A signed event:

```ts
interface NostrEventV1 {
  readonly id: string;        // sha256(serialized([0, pubkey, created_at, kind, tags, content]))
  readonly pubkey: string;    // 32-byte hex secp256k1 public key
  readonly kind: 25556;
  readonly created_at: number;
  readonly tags: Array<readonly [string, string]>;
  readonly content: string;   // JSON.stringify(SignalingMessage)
  readonly sig: string;       // 64-byte hex schnorr signature
}
```

## Reconnect behaviour

When a relay connection drops, the adapter SHOULD:

1. Apply exponential backoff (default 1 s → 60 s).
2. Re-subscribe with the same filter on reconnect, with a `since`
   value just before the last delivered event's `created_at` — this
   minimises duplicate floods while protecting against the rare
   relay that drops events under load.
3. Continue publishing successfully to other reachable relays during
   the outage. `publish` resolves once at least one relay has
   ACKed (`["OK", id, true, …]`). It rejects only if every relay
   either NACKs or stays disconnected past a configurable timeout.

## Negative examples

- Publishing `kind: 1` (note) instead of `25556` — non-conformant;
  relays would persist the SDP indefinitely.
- Publishing without the `t` tag — non-conformant; subscribers
  filtering by `#t` would not see the message.
- Reusing the same Nostr keypair across distinct sessions — allowed,
  but discouraged: relay correlation across rooms becomes trivial.
- Falling back to NIP-42 AUTH — out of scope for v1.

## v2 content cipher (NIP-44, OPTIONAL)

[ADR-0024](adr/0024-encrypted-nostr-signaling-nip44.md) defines an opt-in
v2 wire variant that encrypts the `content` field with NIP-44 v2 keyed off
a room-derived symmetric secret. v1 plaintext frames remain valid; v2 is
enabled per-adapter (constructor flag or runtime option) and is
relay-opaque — no new tag, no new `kind`, no relay-specific extension.

### Normative checklist (v2)

- A v2-capable adapter MUST derive the room key as

  ```
  encryption_key =
    HKDF-SHA256(
      salt = UTF-8("senn-nip44-v1"),
      ikm  = UTF-8(roomId),
      info = UTF-8("senn:nostr-signaling:v2"),
      L    = 32
    )
  ```

  where `roomId` is the 26-char Crockford base32 RoomId from the room
  URL (see [room-and-invite-spec.md](room-and-invite-spec.md)).
- The derived key MUST be used as the NIP-44 v2 conversation key (the
  `shared_x` slot in NIP-44's key-derivation step). No
  Diffie-Hellman step is performed; the room key is symmetric and
  independent of the ephemeral Nostr keypair.
- Implementations MUST NOT use the deprecated NIP-44 v1 cipher.
- A v2 sender MUST prepend the 4-byte ASCII sentinel `nv44`
  (bytes `6e 76 34 34`) to `JSON.stringify(signalingMessage)` before
  encryption. The plaintext passed to NIP-44 is therefore
  `UTF-8("nv44") || UTF-8(JSON.stringify(signalingMessage))`.
- A v2 sender MUST place the resulting base64 NIP-44 v2 ciphertext
  envelope in the Nostr event's `content` field. `kind`, `tags`,
  `pubkey`, `sig`, `created_at`, and every other event field MUST be
  unchanged from v1.
- A v2-capable receiver MUST follow this ordered logic on every
  inbound kind-25556 event whose `t` tag matches the current room:
  1. Derive `encryption_key` from the room tag (`senn:<roomId>`)
     per the formula above.
  2. Attempt NIP-44 v2 decryption of `content` using `encryption_key`.
  3. If decryption succeeds AND the plaintext begins with the
     `nv44` sentinel, strip the sentinel and JSON-parse the
     remainder as a `SignalingMessage`. (v2 path.)
  4. If decryption succeeds but the sentinel is absent, the receiver
     MUST treat the event as a format error and discard it. The
     receiver MUST NOT attempt the v1 fallback in this case (v1
     frames are never NIP-44 ciphertext per the v1 §"Wire frames"
     above and [ADR-0024](adr/0024-encrypted-nostr-signaling-nip44.md)
     §3, so a successful NIP-44 decryption without the sentinel
     implies a foreign or future format).
  5. If decryption fails, attempt to JSON-parse `content` directly
     as a v1 `SignalingMessage`. (v1 fallback path.)
  6. If both paths fail (step 4 discard or step 5 parse failure), the
     receiver MUST discard the event and MUST NOT surface a parse
     error to its `SignalingMessage` handler.
- v1 and v2 paths MUST converge on the same `SignalingMessage`
  handler. Core sees no difference in shape between v1 and v2.
- The room key MUST derive solely from the `roomId` per the §2
  formula above. Implementations MUST NOT mix the ephemeral Nostr
  keypair (or any other identity material) into the derivation; the
  encryption identity is independent of the signaling identity
  (preserves ADR-0014 §3 ephemeral-keypair properties; see
  [ADR-0024](adr/0024-encrypted-nostr-signaling-nip44.md) §7).
- The room key is fixed for the lifetime of the `roomId`.
  Implementations MUST NOT re-key mid-session within a single room
  (see [ADR-0024](adr/0024-encrypted-nostr-signaling-nip44.md)
  §"Out of scope" — re-keying mid-session).
- v2 MUST NOT introduce any new Nostr tag, change `kind` (which
  remains `25556`), or require relay-specific extensions
  (NIP-42 AUTH, group-DMs, NIP-04 DMs, etc).

### Wire frame (v2, informative)

A v2 signed event uses the same envelope as v1; only `content`
changes shape:

```ts
interface NostrEventV2 {
  readonly id: string;        // sha256(serialized([0, pubkey, created_at, kind, tags, content]))
  readonly pubkey: string;    // 32-byte hex secp256k1 public key (ephemeral, ADR-0014 §3)
  readonly kind: 25556;
  readonly created_at: number;
  readonly tags: Array<readonly [string, string]>;
  readonly content: string;   // base64 NIP-44 v2 ciphertext envelope;
                              // plaintext = UTF-8("nv44") || UTF-8(JSON.stringify(SignalingMessage))
  readonly sig: string;       // 64-byte hex schnorr signature over the
                              // NIP-01 serialization
                              // [0, pubkey, created_at, kind, tags, content];
                              // covers the ciphertext envelope via `content`.
}
```

The NIP-01 frames (`EVENT`, `REQ`, `EOSE`, `OK`, `NOTICE`, `CLOSE`)
and the relay subscription filter
(`{ kinds: [25556], "#t": ["senn:<roomId>"] }`) are identical to v1.
Relay operators see an opaque encrypted blob in `content`; the wire
version is end-to-end and relay-opaque.

### Negative examples (v2)

- A v2 sender that omits the `nv44` sentinel — non-conformant; v2
  receivers MUST discard ciphertext without the sentinel (step 4 of
  the receive logic above).
- A v2 receiver that surfaces a decryption failure to the
  `SignalingMessage` handler instead of falling back to v1 plaintext
  parse — non-conformant; the fallback is mandatory while
  mixed-version rooms exist.
- A v2 receiver that aborts on a valid v1 frame because v2 is
  enabled — non-conformant; v1 fallback (step 5) is mandatory.
- A v2 receiver that, on successful NIP-44 decryption with no
  `nv44` sentinel, falls through to v1 JSON parsing — non-conformant;
  v1 frames are never NIP-44 ciphertext, so this state implies a
  foreign format and the event MUST be discarded.
- Falling back to NIP-44 v1 (deprecated cipher) — non-conformant;
  only NIP-44 v2 is permitted.
- Mixing the ephemeral Nostr keypair into the encryption key —
  non-conformant; the key MUST derive solely from the `roomId`.
- Re-deriving the room key mid-session (e.g., on peer-rejoin) —
  non-conformant; the key is fixed for the lifetime of the `roomId`.
- Adding a new tag (e.g., `["senn-v", "2"]`) to mark v2 events —
  non-conformant; v2 MUST be invisible to relays. Use the in-plaintext
  `nv44` sentinel.
- Using the invite URL or the full invite bundle JSON as HKDF `ikm`
  instead of the bare 26-char Crockford base32 `roomId` —
  non-conformant; only the `roomId` is permitted as `ikm` per the
  §"Normative checklist (v2)" formula.
- Substituting different `salt` or `info` strings in the HKDF
  derivation (e.g., empty `salt`, or `info = "senn:nostr:v2"`) —
  non-conformant; the four parameters in §"Normative checklist (v2)"
  are fixed and any deviation breaks room-key compatibility across
  peers.
- Encoding the NIP-44 v2 ciphertext envelope with anything other than
  whatever NIP-44 v2 itself mandates (e.g., base64url instead of
  standard base64) — non-conformant; the envelope encoding is fully
  delegated to NIP-44 v2 and MUST NOT be re-coded by the adapter.
- Changing the relay subscription filter for v2 (e.g., adding a
  v2-only `#e` filter, or a v2-specific `since` offset) —
  non-conformant; v2 MUST reuse the v1 subscription filter
  (`{ kinds: [25556], "#t": ["senn:<roomId>"] }`) so that a single
  REQ delivers both v1 and v2 events to a v2-capable receiver.

### Threat model (v2)

The room key derives solely from the `roomId`. Any peer holding a
valid invite — including an unauthorised joiner who obtained the
invite link — can decrypt all v2 content in that room. This matches
the ADR-0014 threat model: the invite link is the trust boundary.

v2 protects against:

- **Passive relay operators** reading SDP offers and ICE candidates
  (which include peer IP addresses and ports).
- **On-path network observers** between the adapter and the relay.
- **Cross-relay correlation** of `content` payloads, since identical
  `SignalingMessage` values map to distinct ciphertexts under the
  NIP-44 v2 nonce.

v2 does NOT protect against:

- Anyone who holds the invite link (by design — invite = trust
  boundary).
- Forward-compromise: a passive observer who records all ciphertext
  and later obtains the `roomId` can decrypt the session retroactively
  (mitigated only by ephemeral-event TTL; structural forward secrecy
  is out of scope per ADR-0024 §Out of scope).
- Active relay operators who modify or drop events; the Nostr `sig`
  remains an ephemeral-key signature carrying the same advisory
  authenticity it does in v1.

## Conformance

```sh
pnpm --filter @senn/signaling-nostr test
pnpm verify:nostr-self-test
```

vitest covers the adapter against an in-process mock relay
implementing the NIP-01 frame subset above: round-trip publish ➜
subscribe, dedup across relays, reconnect after socket close.

`pnpm verify:nostr-self-test` (included in `pnpm conformance`) is a
CLI smoke that mirrors `pnpm verify:http-poll-self-test` for the
Nostr adapter: it spins up an in-process NIP-01 mock relay, injects
it via `wsCtor`, and runs each MUST clause as a named check
(publish ➜ subscribe round-trip, dedup across relays, non-25556
event drop, all-relay-NACK rejection, and ephemeral-key per
construction). It surfaces a single `ok / FAIL` line per spec
clause so a regression in the adapter or in the spec mapping is
visible from the conformance summary.

Once the v2 content cipher (§"v2 content cipher (NIP-44, OPTIONAL)")
ships in the adapter, `pnpm verify:nostr-self-test` MUST add the
following named checks (per ADR-0024 §8):

- v2 round-trip: a v2 sender and v2 receiver in the same room
  exchange a `SignalingMessage` end-to-end through the in-process
  mock relay; the receiver's handler fires exactly once with the
  correct payload.
- Mixed-version graceful degradation (v1 sender ↔ v2 receiver):
  a v1 sender and a v2 receiver in the same room interoperate via the
  mandatory v1 fallback path (decrypt fails → JSON-parse v1 plaintext
  succeeds).
- Mixed-version graceful degradation (v2 sender ↔ v1-only receiver):
  a v2 sender and a v1-only receiver in the same room; the v1-only
  receiver silently discards the ciphertext (its v1 JSON parse fails
  and it has no decryption path) and never surfaces a parse error to
  its handler.
- Sentinel detection: a v2 receiver that decrypts a ciphertext whose
  plaintext lacks the `nv44` prefix discards the event without
  surfacing an error to the handler.
- Room-key independence: two adapters constructed with distinct
  `roomId` values cannot decrypt each other's v2 ciphertext (the
  mock relay forwards the event but the receiver discards it via
  step 5 → step 6 of the receive logic).

The in-process NIP-01 mock relay used by `verify:nostr-self-test`
requires no NIP-44 awareness: encryption is end-to-end between the
adapter instances under test, not relay-side.

The adapter does not run against a real Nostr relay in the gate to
keep the test surface deterministic and vendor-neutral
([ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md)).
Operators verifying their own relay setup SHOULD adapt
`scripts/verify-nostr-self-test.ts` to point at the relay, or pair
the adapter with an external NIP-01 probe of their choosing.

## Cross-references

- [ADR-0007 — Vendor-neutral signaling and relay](adr/0007-vendor-neutral-signaling-and-relay.md)
- [ADR-0014 — Nostr signaling adapter](adr/0014-signaling-nostr.md)
- [ADR-0024 — Encrypted Nostr signaling content via NIP-44](adr/0024-encrypted-nostr-signaling-nip44.md)
- [room-and-invite-spec.md](room-and-invite-spec.md) §RoomId — seeds the v2 HKDF derivation.
- [signaling-http-poll-spec.md](signaling-http-poll-spec.md)
- [security-model.md](security-model.md)
- [NIP-44 (ChaCha20 + HMAC-SHA256 + HKDF-SHA256, encrypt-then-MAC)](https://github.com/nostr-protocol/nips/blob/master/44.md) — normative reference for the v2 cipher envelope.
