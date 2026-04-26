# Add-on Binary Peer Transfer Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Intent

Define how a SENN add-on may send and receive **binary** payloads
across the data channel between two peers. This page is normative.

The text peer flow lives in
[addon-runtime-spec.md](addon-runtime-spec.md); the local file flow
(picker + download) lives in
[addon-file-transfer-spec.md](addon-file-transfer-spec.md). This spec
unlocks the missing leg: bytes that cross peers without going through
a server.

The decision and the size cap are recorded in
[ADR-0011](adr/0011-binary-peer-transfer.md).

## Normative checklist

- An add-on declaring `peer.send.bin` MAY ask the host bridge to
  deliver a binary payload to the connected peer.
- An add-on declaring `peer.receive.bin` MAY receive binary payloads
  delivered by the bridge.
- The host MUST refuse a `send-bin` request from an add-on that has
  not declared `peer.send.bin`.
- The host MUST NOT deliver a `deliver-bin` event to an add-on that
  has not declared `peer.receive.bin`.
- A v1 single-frame body MUST be ≤ **65,536 bytes** (64 KiB).
  Larger logical messages MUST be split into multiple frames per
  [ADR-0012](adr/0012-chunked-binary-peer-transfer.md). The
  per-message cap is **4 MiB**; bodies exceeding it MUST cause the
  host to reject the `send-bin` op with `payload-too-large`.
  Senders MUST chunk transparently — add-ons see one logical
  `send-bin` / `deliver-bin` regardless of how many frames travel
  on the wire.
- Binary frames travel on a dedicated `core.bin` data channel,
  separate from `core.text`. The text channel MUST NOT carry binary
  frames; the binary channel MUST NOT carry text frames.
- The `core.bin` channel MUST be ordered and reliable
  (`{ ordered: true }`, default reliability), so single-frame
  messages are delivered in send order.
- Bytes MUST NOT be base64-encoded on the wire. Encoding is reserved
  for the host↔addon bridge boundary, where postMessage's structured
  clone already passes `Uint8Array` natively.

## Permission strings

| Permission | What it allows |
|------------|----------------|
| `peer.send.bin` | Calls `senn.addon.v1` `send-bin`; bytes are delivered to the connected peer. |
| `peer.receive.bin` | Receives `senn.addon.v1` `deliver-bin` events from the bridge. |

`peer.send.bin` does NOT imply `peer.send` (text). An add-on that
wants both flows declares both permissions.

## Bridge protocol additions

Two new ops on the existing `kind: "senn.addon.v1"` envelope. Both
carry a `Uint8Array` directly (postMessage transfers it via structured
clone — no base64).

```ts
// Add-on iframe → host
interface AddonSendBinRequest {
  readonly kind: "senn.addon.v1";
  readonly op: "send-bin";
  readonly mime: string;          // informative; e.g. "application/octet-stream"
  readonly bytes: Uint8Array;     // ≤ 65_536 bytes
}

// Host → add-on iframe
interface AddonDeliverBinEvent {
  readonly kind: "senn.addon.v1";
  readonly op: "deliver-bin";
  readonly from: string;          // remote peerId
  readonly mime: string;          // as supplied by the sender
  readonly bytes: Uint8Array;
}
```

Errors surface on the existing `error` op with one of:

| `code` | When |
|--------|------|
| `permission-denied` | Add-on lacks `peer.send.bin` (or `peer.receive.bin` for inbound). |
| `payload-too-large` | `bytes.byteLength` exceeds the per-message cap (4 MiB by default; ADR-0012). |
| `bad-payload` | `mime` not a string, `bytes` not a `Uint8Array`, etc. |
| `not-connected` | `core.bin` channel is not open. |
| `reassembly-overflow` | Receiver dropped this in-flight message because the per-peer reassembly buffer (16 MiB) was exhausted. |
| `reassembly-timeout` | Receiver did not see all frames of a message within 60 s of the first frame. |

## Wire format (informative)

The host side packs an outbound `send-bin` into one binary
`ArrayBuffer` for `RTCDataChannel.send`:

```
+--------------------+--------------------------+--------------------+
| u32 LE header_len  | header bytes (UTF-8 JSON) | body bytes         |
+--------------------+--------------------------+--------------------+
```

Header schema:

```ts
interface BinaryFrameHeaderV1 {
  readonly v: 1;
  readonly addon: string;         // routing key — addon id
  readonly mime: string;
  readonly size: number;          // body byte length of THIS frame
  readonly id?: string;           // logical message id, same across all frames
  readonly seq?: number;          // 0-based frame index
  readonly total?: number;        // total frame count (>= 1)
}
```

The `addon` field demuxes per-addon at the receiver (mirrors the
`addon` field in the JSON envelope used on `core.text`). The receiver
MUST drop frames whose `addon` does not match a loaded `AddonHost`.

A frame omitting all of `id` / `seq` / `total` is a single-frame
message (the original v1 wire). When `total > 1`, the receiver
buffers frames keyed by `(from, addon, id)` and emits one
`deliver-bin` once `seq` 0..total-1 have all arrived. Decoders MUST
ignore unknown extra header fields so future ADRs (retransmission,
parallel transfers) can extend the schema without bumping `v`.

The receiver parses the header, validates `size === body.byteLength`,
and emits `deliver-bin` to the matching add-on. A frame whose
`header_len` exceeds the frame, whose JSON does not parse, or whose
`size` mismatches the body MUST be dropped silently and surfaced as a
`PeerSession` `error` event — it is treated as a corrupt peer, not a
delivery.

## Negative examples

- An add-on without `peer.send.bin` calling `send-bin` —
  **rejected** with `permission-denied`.
- A 70 KiB body — **rejected** with `payload-too-large`.
- Sending text on `core.bin` — undefined behaviour; spec implementations
  drop the frame.
- Receiver finds `header.size !== body.byteLength` — frame **dropped**
  and `error` emitted (corrupt peer).

## Cross-references

- [ADR-0011 — Binary peer transfer](adr/0011-binary-peer-transfer.md)
- [addon-runtime-spec.md](addon-runtime-spec.md)
- [addon-file-transfer-spec.md](addon-file-transfer-spec.md)
- [peer-session-spec.md](peer-session-spec.md)
- [addon-spec.md](addon-spec.md)
