# ADR 0012: Chunked binary peer transfer (multi-frame, header-extended)

## Status

Accepted — supersedes the single-frame caveat in
[ADR-0011](0011-binary-peer-transfer.md) §Decision.

## Context

ADR-0011 picked a single-frame, 64 KiB-capped binary path on a
dedicated `core.bin` data channel. That cap was deliberate — single
frame keeps the v1 implementation tiny and audits well — but it made
the realistic file-transfer story for local-vault-class add-ons
(images, PDFs, short audio) unreachable.

The constraints that motivated ADR-0011 still apply:

- The wire stays on `core.bin` (no new channel, no relay).
- The host bridge stays auditable; the SDK stays optional.
- We still don't want resume / multiplexing / QoS in the protocol.

What we DO need now: **multi-frame** delivery with bounded buffers
on the receiver, so a > 64 KiB add-on payload can cross peers
reliably.

## Decision

1. **Header is extended additively.** The v1 header schema gains
   three optional fields:

   ```ts
   interface BinaryFrameHeaderV1 {
     readonly v: 1;
     readonly addon: string;
     readonly mime: string;
     readonly size: number;       // body byte length of THIS frame
     readonly id?: string;        // message id; same across all frames of one logical message
     readonly seq?: number;       // 0-based frame index
     readonly total?: number;     // total frame count (>= 1)
   }
   ```

   A frame with all three of `id`/`seq`/`total` absent is a
   single-frame message — the v1 wire from ADR-0011, unchanged.

2. **Per-frame body cap stays 64 KiB.** That is the single-message
   budget WebRTC implementations agree on. Chunking does not raise
   the per-frame cap.

3. **Per-message body cap is 4 MiB by default.** The receiver
   rejects (drops + emits `error`) any message whose declared
   `total * 64 KiB` would exceed the cap. The cap is enforced on
   the host bridge (where the addon is talking) and on the
   receiver's reassembly buffer (where peer bytes arrive).

4. **Reassembly buffer is bounded.** PeerSession holds at most
   **16 MiB** of in-flight reassembly state per peer, across all
   addons. New frames that would push the buffer past the limit
   cause the oldest in-flight message to be dropped (with an
   `error` event) before the new frame is accepted.

5. **Reassembly timeout is 60 seconds.** A message that has not
   completed within 60 s of its first frame is dropped. The receiver
   does NOT request retransmission — RTCDataChannel ordered+reliable
   delivers in-order or fails the connection; a partial message is
   a peer bug.

6. **Sender chunks deterministically.** PeerSession.sendBinary
   takes the same shape as before; the **caller** does not chunk.
   Internally, sendBinary splits the body into ⌈size / 60 KiB⌉
   frames (60 KiB body keeps room for the header within the
   64 KiB total frame cap), assigns a fresh ULID-style `id`,
   stamps `seq` / `total`, and sends frames in order.

7. **Add-on bridge cap matches the per-message cap.** AddonHost's
   `send-bin` cap rises from 64 KiB to **4 MiB**. The SDK does not
   enforce the cap (so the rule lives in one place — the host).

8. **Frames from different messages MAY interleave.** Receivers
   demux by `id`. Senders SHOULD avoid interleaving (one message at
   a time on the SDK shape), but the protocol does not forbid it
   so the future "concurrent transfers" feature does not need a
   wire change.

## Rationale

- The optional `id`/`seq`/`total` is the smallest schema change that
  buys reassembly. Existing single-frame senders keep working
  byte-for-byte; existing single-frame receivers keep working
  byte-for-byte. Old peer ↔ new peer is fine in both directions
  for ≤ 64 KiB messages.
- 60 KiB body keeps the absolute frame ≤ 64 KiB even after the
  larger header (extended schema is at most ~150 bytes of JSON
  for sane values), so we don't accidentally trip the per-frame
  cap.
- 4 MiB / 16 MiB / 60 s are coarse but sane. They are policy, not
  protocol: a host can override them at PeerSession construction
  time. The numbers exist so an unconfigured host has a safe
  default.
- Dropping the oldest in-flight message on buffer pressure beats
  dropping the newest: the newest frame just arrived in order on a
  reliable channel, so it is the most likely to complete. The
  oldest is the least likely (it has been waiting longer).
- Resume / retransmission would require sequence acknowledgements,
  which would require a back-channel and timers and per-message
  state on the sender. ADR-0007's "vendor-neutral signaling" rules
  out a stateful relay. Out of scope.

## Consequences

- PeerSession gains a small reassembly state machine. The code path
  stays under ~100 LOC.
- AddonHost bridge cap bumps to 4 MiB. Existing 64 KiB add-ons keep
  working unchanged. Local-vault can now ship moderate-sized files.
- The wire format is forward-extensible: future ADRs adding
  retransmission / parallel transfers can use `id` as their
  identifier without renaming or rebasing.
- Two new failure modes need user-facing surfacing in add-on UIs:
  "buffer full" (the receiver dropped your old in-flight message)
  and "incomplete" (timeout). Both surface as `error` ops on the
  bridge with `code: 'reassembly-timeout'` and
  `code: 'reassembly-overflow'` respectively.
- Compatibility: a peer running an ADR-0011 build refuses to parse
  a header whose schema includes the new fields, because the v1
  validator was strict-no-extras. We have two choices:
  - **a)** Loosen the v1 validator NOW (this ADR) to ignore unknown
    extra fields, treating `seq`/`total` as advisory.
  - **b)** Treat the extension as a separate format (`v: 2`).
  We pick **(a)** — the receiver's strict-rejection added no
  security; the body bytes are the only payload that matters and
  they are still length-checked against `size`.
