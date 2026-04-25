# Lightweight Data Strategy

## Principle

SENN optimizes for low server cost, low network load, and good user experience.

Optimization order:

1. Do not send unnecessary data.
2. Represent data compactly.
3. Send diffs.
4. Batch events.
5. Compress when useful.
6. Use workers or WASM only when necessary.

## Data Strategy

### Text

- Small messages: raw
- Large messages: compressed

### JSON

- Small events: raw
- Batched events: compressed
- Future option: MessagePack or custom binary

### Avatar / Presence

- Do not send video.
- Send state only:
  - speaking
  - mouth level
  - emotion
  - gesture
  - idle
  - reaction

### Voice

- Use WebRTC codec.
- Do not double-compress.

### Files

- Chunk transfer.
- Compress only compressible file types.
- Avoid recompressing JPEG, MP4, ZIP, etc.

### Invite URL

- JSON payload
- deflate-raw
- base64url
- URL fragment

## Compression Thresholds

- < 1KB: no compression by default
- 1KB – 32KB: compress text/JSON if useful
- > 32KB: stream/chunk transfer
- Already compressed data: no compression
