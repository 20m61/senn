# ADR 0011: Binary peer transfer (single-frame, second data channel)

## Status

Accepted

## Context

Local-vault and similar add-ons can already pick a file (ADR linked
via [addon-file-transfer-spec.md](../addon-file-transfer-spec.md)) and
persist it locally. They cannot send those bytes to the connected
peer. Without that leg, "線でつながる" only holds for text — the value
proposition of SENN is incomplete.

We need a peer-to-peer binary path that:

- Lives on the existing PeerSession / RTCDataChannel substrate (no new
  infra, no relay).
- Stays auditable for sandboxed add-ons (no raw RTC access — the
  bridge mediates).
- Does not turn the protocol into a file-transfer protocol overnight
  (no chunking, flow control, resume, or QoS in v1).

Three plausible designs were on the table:

1. **Base64-on-`core.text`** — encode binary into the existing text
   channel. Zero new wire surface, but ~33 % bandwidth overhead and a
   permission semantics problem (the same `peer.send` covers both
   text and bytes, so the audit can't distinguish them).
2. **Single-frame on a second `core.bin` channel, capped at 64 KiB.**
3. **Chunked binary stream with flow control** — full file-transfer
   feature set in one go.

## Decision

Pick **(2)**: a dedicated `core.bin` RTCDataChannel, single-frame
messages, 64 KiB body cap. New permission strings `peer.send.bin` and
`peer.receive.bin` gate the bridge ops independently of `peer.send` /
`peer.receive`.

The wire format is one ArrayBuffer per message:
`[u32 LE header_len][JSON header][body bytes]`. The header carries
`{ v: 1, mime, size }`.

Chunking, resume, multiplexing concurrent transfers, and explicit
flow control are EXPLICITLY out of scope for this version. They will
land under a future ADR once a real use case demands them (e.g. an
add-on shipping > 64 KiB images or audio clips).

## Rationale

- A second channel keeps text and binary semantics independent. A
  buggy binary add-on cannot wedge `core.text`, and the audit
  permission set ("can this add-on send binary?") becomes a 1:1 map
  to a single channel.
- 64 KiB is a safe single-frame size across browser RTC implementations
  (some default to 16 KiB max but most negotiate up to 256 KiB).
  Picking 64 KiB matches the existing `core.text` cap, so the runtime
  has one mental model for "max single message".
- Single-frame keeps the v1 implementation a few dozen lines: no
  reassembly, no out-of-order, no missing-chunk timeout. We can add
  chunking later without changing the permission strings or the
  bridge ops — the wire would just gain a `seq` / `total` in the
  header.
- Splitting the permission ("peer.send.bin" vs "peer.send") preserves
  least-privilege. An add-on that only chats text never gets a path to
  ship bytes; an add-on that only ships images never gets a chat
  transcript path.
- Rejecting base64-on-text means the audit's "what does this add-on do
  on the wire?" stays answerable by reading the manifest. With
  base64-on-text, that answer would require dataflow analysis.

## Consequences

- The bridge protocol gains two ops (`send-bin`, `deliver-bin`) and
  the manifest validator gains two permission strings. Both are
  additive — no existing add-on changes.
- PeerSession opens a second data channel even when no add-on uses
  binary. The cost is small (one extra DTLS-protected SCTP stream).
  Future optimisation: open lazily on first `send-bin` call.
- Add-ons can send up to 64 KiB at a time — large enough for thumbnails,
  config blobs, small PDFs; too small for whole videos. The error
  (`payload-too-large`) is explicit so add-ons can refuse before
  trying.
- Future chunked transfer is a non-breaking addition: a header with
  `seq > 0` / `total > 1` extends the schema without breaking the
  current single-frame senders.
- Compatibility: a peer running a build without binary support simply
  never opens `core.bin`. The sender's `send-bin` will then fail with
  `not-connected`, surfaced as an `error` op to the add-on. The text
  path is unaffected.
