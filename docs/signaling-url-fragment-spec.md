# URL-Fragment Signaling Adapter Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Intent

Define the wire format and semantics of the **Tier 0 signaling adapter**: a
`SignalingTransport` whose carrier is the URL fragment, with transmission
between peers performed **out-of-band** by the user (chat, email, QR code,
in-person hand-off). This page is normative.

This adapter is the only one that requires zero infrastructure. It is the
reference implementation that all other adapters MUST be interchangeable
with from the perspective of SENN Core.

## Normative checklist

- An adapter implementing this spec MUST satisfy the `SignalingTransport`
  contract in `@senn/protocol` (`publish`, `subscribe`, `close`).
- `publish(roomId, message)` MUST resolve immediately and place the message
  in an internal **outbox** keyed by `roomId`. It MUST NOT contact any
  server.
- The adapter MUST expose `exportBundle(roomId): string` that drains the
  outbox for that room and returns a `signaling-bundle-v1` encoded string
  (defined below). Calling `exportBundle` on an empty outbox MUST return an
  empty string.
- The adapter MUST expose `importBundle(encoded)` that decodes and validates
  a bundle, then synchronously delivers each message to all matching
  subscribers via the `subscribe` callback for that room.
- `subscribe(roomId, handler)` MUST register the handler for that room only.
  Handler exceptions MUST be caught.
- `close()` MUST clear all subscribers, drain all outboxes, and make
  subsequent calls to `publish`, `exportBundle`, or `importBundle` reject
  with `Error("adapter closed")`. `close()` is idempotent.
- The adapter MUST NOT log message bodies, MUST NOT persist messages beyond
  process memory, and MUST NOT couple itself to any vendor.

## Wire format

A **signaling bundle** is a self-contained payload that may travel via URL
fragment, QR code, copy/paste, or any other out-of-band channel.

```ts
type SignalingBundleV1 = {
  readonly v: 1;
  readonly roomId: RoomId;
  readonly messages: readonly SignalingMessage[];
};
```

Encoding pipeline (identical to invite encoding):

```
JSON.stringify(bundle) → UTF-8 → CompressionStream("deflate-raw") → base64url
```

Decoders MUST reject:

- A bundle whose `v` is not `1`.
- A bundle whose `roomId` is not a valid `RoomId` (per [room-and-invite-spec.md](room-and-invite-spec.md)).
- A bundle whose `messages` is empty.
- Any unknown top-level key.
- Any signaling message whose shape does not match `SignalingMessage` in `@senn/protocol`.

## URL form

When carried in a URL fragment, the bundle MUST live under fragment key `s`:

```
https://<host>/<path>#s=<base64url-deflate-raw-utf8-json>
```

A URL MAY combine an invite (`#i=...`) and a bundle (`#s=...`), e.g. for the
inviter's first hop:

```
https://<host>/<path>#i=<invite>&s=<bundle>
```

Adapters MUST process `s=` independently of `i=`. The invite payload is
defined in [room-and-invite-spec.md](room-and-invite-spec.md).

## Out-of-band flow (informative)

```
Alice (inviter)                              Bob (joiner)
──────────────────────────────────────       ─────────────────────────────────────
adapter.publish(room, offer)
url = base + "#i=…&s=" + adapter.exportBundle(room)
                              ──── URL ────▶
                                              adapter.importBundle(s_part)
                                              // handler fires with {kind:"offer", …}
                                              adapter.publish(room, answer)
                                              url2 = base + "#s=" + adapter.exportBundle(room)
                              ◀──── URL ────
adapter.importBundle(s_part)
// handler fires with {kind:"answer", …}
…ICE candidates exchanged the same way…
```

The adapter MUST work with any number of round trips. It MUST NOT assume
that the same out-of-band channel is used in both directions.

## Positive example

A bundle containing a single offer:

```json
{
  "v": 1,
  "roomId": "01jrmcv3p4n8e7y9w0q5t2k1h6",
  "messages": [
    {
      "kind": "offer",
      "from": "01jrmcv3p4abcdefghjkmnpqrs",
      "sdp": "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n"
    }
  ]
}
```

A round-trip fixture lives under [`examples/signaling-url-fragment-roundtrip/`](../examples/signaling-url-fragment-roundtrip/)
and is checked by `pnpm validate:bundle` (added alongside this adapter).

## Negative examples

```json
{
  "v": 1,
  "roomId": "01jrmcv3p4n8e7y9w0q5t2k1h6",
  "messages": []
}
```

→ rejected: bundle MUST contain at least one message.

```json
{
  "v": 1,
  "roomId": "ROOM-01",
  "messages": [{"kind":"offer","from":"alice","sdp":""}]
}
```

→ rejected: `roomId` is not Crockford base32; `from` is not a `PeerId`;
`sdp` is empty.

```
https://senn.example/#room=01jrmcv3p4n8e7y9w0q5t2k1h6
```

→ rejected: bundle MUST live under `s=`, never as a raw room id.

## Conformance

```sh
pnpm -r --filter @senn/signaling-url-fragment test
pnpm validate:bundle examples/signaling-url-fragment-roundtrip/bundle.json
```

The adapter test suite covers:

- Round-trip across two adapter instances (offer / answer / ICE / bye).
- Cross-room isolation (messages in room A MUST NOT be delivered to a
  handler subscribed to room B on the same adapter instance).
- Subscription lifecycle (`subscribe` returns an `Unsubscribe` that cancels
  delivery; `close` cancels all).
- Negative paths (tampered bundle, wrong version, unknown fields).

## Cross-references

- [ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md) — vendor-neutral signaling.
- [room-and-invite-spec.md](room-and-invite-spec.md) — `i=` invite payload.
- [/docs/dev/signaling-adapter.md](dev/signaling-adapter.md) — adapter author guide.
- [/docs/deployment.md](deployment.md) — Tier 0 deployment.
