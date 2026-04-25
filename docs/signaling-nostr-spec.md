# Nostr Signaling Adapter Specification

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

## Conformance

```sh
pnpm --filter @senn/signaling-nostr test
```

vitest covers the adapter against an in-process mock relay
implementing the NIP-01 frame subset above: round-trip publish ➜
subscribe, dedup across relays, reconnect after socket close.

The adapter does not run against a real Nostr relay in CI to keep
the test surface deterministic; operators verifying their own relay
setup should pair this adapter with a smoke script (analogous to
`pnpm verify:http-poll-endpoint`) — that script is future work.

## Cross-references

- [ADR-0007 — Vendor-neutral signaling and relay](adr/0007-vendor-neutral-signaling-and-relay.md)
- [ADR-0014 — Nostr signaling adapter](adr/0014-signaling-nostr.md)
- [signaling-http-poll-spec.md](signaling-http-poll-spec.md)
- [security-model.md](security-model.md)
