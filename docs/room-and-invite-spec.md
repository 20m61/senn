# Room and Invite Specification

## Intent

Define the wire format for SENN room identifiers, peer identifiers, and invite
URLs so that two browsers can establish a peer connection without sharing a
hosted backend (Tier 0 in [deployment.md](deployment.md)). This page is
normative.

## Normative checklist

- A `RoomId` MUST be a 128-bit value drawn from a cryptographically secure
  random source, encoded as exactly 26 characters of Crockford base32
  (lowercase alphabet `0123456789abcdefghjkmnpqrstvwxyz`).
- A `PeerId` MUST be a ULID (Crockford base32, lowercase, 26 characters)
  per the ULID specification (48-bit big-endian timestamp + 80-bit random).
- An `InvitePayload` MUST contain exactly the fields listed in the schema
  below. Unknown fields MUST be rejected on decode.
- `protocolVersion` MUST be the SemVer of the `@senn/protocol` package the
  inviter shipped against. Decoders MUST reject majors they do not understand.
- `capabilities` MUST be a non-empty array of capability tags (kebab-case,
  versioned, e.g. `whiteboard-v1`).
- An invite URL MUST encode the payload as
  `JSON.stringify(payload)` → UTF-8 bytes → `CompressionStream("deflate-raw")`
  → base64url (no padding), placed in the URL fragment after `#i=`.
- The full invite URL MUST be ≤ 2048 characters end-to-end.
- The fragment MUST NOT be sent to any server. Hosts MUST NOT log it.
  Decoders MUST treat it as untrusted input and validate before use.
- Any decoded payload that fails schema validation MUST be discarded; the
  host application MUST surface a generic "invalid invite" error and MUST NOT
  echo the payload back to the user.

## Schemas

### `RoomId`

```ts
type RoomId = string & { readonly __brand: "RoomId" };
// MUST match: /^[0-9a-hjkmnp-tv-z]{26}$/
```

### `PeerId`

```ts
type PeerId = string & { readonly __brand: "PeerId" };
// ULID, lowercase Crockford base32: /^[0-9a-hjkmnp-tv-z]{26}$/
// First 10 chars encode 48-bit timestamp_ms (big-endian).
```

### `InvitePayload`

```ts
interface InvitePayload {
  readonly v: 1;                       // schema version of THIS payload, not protocol version
  readonly roomId: RoomId;
  readonly from: PeerId;
  readonly protocolVersion: string;    // SemVer of @senn/protocol
  readonly capabilities: readonly string[];
  readonly note?: string;              // ≤ 64 unicode code points
}
```

Decoders MUST reject:

- `v` ≠ `1`
- a missing or malformed `roomId` (regex above)
- a missing or malformed `from` (regex above)
- `protocolVersion` not parseable as SemVer
- `capabilities` empty
- any extra top-level field

## Invite URL form

```
https://<host>/<path>#i=<base64url-deflate-raw-utf8-json>
```

- The scheme MUST be `https` (or `file://` for local-only test fixtures).
- The fragment key MUST be `i`. Other keys are reserved for future use.
- The fragment value MUST decode to a valid `InvitePayload`.
- QR codes MUST encode the full URL.

## Positive example

Payload (decoded):

```json
{
  "v": 1,
  "roomId": "01jrmcv3p4n8e7y9w0q5t2k1h6",
  "from": "01jrmcv3p4abcdefghjkmnpqrs",
  "protocolVersion": "0.1.0",
  "capabilities": ["text-v1", "whiteboard-v1"],
  "note": "studio drop-in"
}
```

The fixture in [`examples/invite-roundtrip/`](../examples/invite-roundtrip/)
contains this payload along with its canonical encoded form. The conformance
script proves they round-trip.

## Negative examples

```json
{
  "v": 2,
  "roomId": "01jrmcv3p4n8e7y9w0q5t2k1h6",
  "from": "01jrmcv3p4abcdefghjkmnpqrs",
  "protocolVersion": "0.1.0",
  "capabilities": ["text-v1"]
}
```

→ rejected: `v` is not `1`. Decoders refuse to interpret unknown payload
schema versions.

```json
{
  "v": 1,
  "roomId": "ROOM-001",
  "from": "alice",
  "protocolVersion": "0.1",
  "capabilities": []
}
```

→ rejected on every line:
- `roomId` is not 26 lowercase Crockford base32 characters.
- `from` is not a ULID.
- `protocolVersion` is not a SemVer.
- `capabilities` is empty.

```
https://senn.example/#room=01jrmcv3p4n8e7y9w0q5t2k1h6
```

→ rejected: invite payload MUST live under fragment key `i`, not `room`,
and MUST be the encoded payload — never a raw room id alone.

## Conformance

```sh
pnpm tsx scripts/validate-invite.ts examples/invite-roundtrip/payload.json
```

The validator script:

1. Reads the canonical payload.
2. Encodes it via `encodeInvite` from `@senn/protocol`.
3. Compares the result to `examples/invite-roundtrip/encoded.txt`.
4. Decodes the encoded form back and asserts deep equality with the input.
5. Asserts the resulting URL length is ≤ 2048 characters under a 64-char
   host prefix budget.

Any add-on or core change that touches invite handling MUST run this
script. The SDD reviewer agent will block PRs that update encoding without
regenerating the fixture.

## Cross-references

- [ADR-0004](adr/0004-p2p-transport-strategy.md) — WebRTC as transport.
- [ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md) — pluggable
  signaling; this spec defines the format the URL-fragment adapter carries.
- [/docs/deployment.md](deployment.md) — Tier 0 (zero infrastructure)
  consumes invite URLs as the only signaling channel.
- [/docs/core-spec.md](core-spec.md) — Room lifecycle (created elsewhere).
