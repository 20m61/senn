# SENN Core Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Core Responsibilities

SENN Core is responsible for:

- Room creation
- Invite generation
- P2P connection
- DataChannel transport
- Voice transport
- File transfer
- Presence
- Reactions
- Add-on loading
- Add-on permission enforcement
- Local storage APIs
- Message validation
- Capability negotiation

## Room

A room is a temporary P2P communication context.

### Requirements

- A room **MAY** be created without an account.
- Room IDs **MUST** be random and hard to guess.
- Room data **MUST NOT** be stored on application servers.
- Invite data **MAY** be embedded in URL fragments.
- QR invites **MUST** be supported.

## Peer Connection

SENN uses WebRTC.

### Requirements

- Direct P2P **SHOULD** be used; relay (TURN) **MAY** be used as a fallback.
- RTCDataChannel **MUST** be used for dynamic data.
- MediaStream **MUST** be used for voice.
- Connection state **MUST** be visible to users.
- Failure states **MUST** be understandable.

## Message Envelope

All messages use a shared envelope.

```json
{
  "id": "msg_01J0000000000000000000000",
  "kind": "core.message",
  "type": "text",
  "createdAt": 1780000000,
  "payload": {}
}
```

## Add-on Message Envelope

```json
{
  "id": "msg_01J0000000000000000000001",
  "kind": "addon.message",
  "addon": "com.example.whiteboard",
  "version": "1.0.0",
  "createdAt": 1780000001,
  "payload": {
    "action": "stroke"
  }
}
```

## Capability Negotiation

Peers exchange supported capabilities on connection. Capability tags
follow the `<feature>-v<major>` convention pinned by
[ADR-0026](adr/0026-capability-tag-naming.md), where `<feature>` is
kebab-case ASCII matching `^[a-z][a-z0-9-]*$` and `<major>` is a
positive integer with no leading zeros. Versioning is by major only.

```json
{
  "type": "hello",
  "client": "senn",
  "version": "0.1.0",
  "capabilities": [
    "text-v1",
    "peer-bin-v1",
    "media-audio-v1",
    "media-video-v1",
    "file-transfer-v1",
    "addon-runtime-v1",
    "local-storage-v1"
  ]
}
```

### v1 capability registry (normative)

| Tag | Means "this peer supports..." | Anchored by |
|-----|--------------------------------|-------------|
| `text-v1` | UTF-8 text messaging on `core.text` | this spec §Text |
| `peer-bin-v1` | Binary peer transfer on `core.bin` (≤ 4 MiB per logical message; transparent chunking into ≤ 64 KiB wire frames) | [ADR-0011](adr/0011-binary-peer-transfer.md), [ADR-0012](adr/0012-chunked-binary-peer-transfer.md), [addon-binary-transfer-spec.md](addon-binary-transfer-spec.md) |
| `media-audio-v1` | Cross-peer audio tracks (host-captured `getUserMedia`, perfect-negotiation flow) | [ADR-0015](adr/0015-media-tracks.md), [addon-media-spec.md](addon-media-spec.md) §`media.{send,receive}.audio` |
| `media-video-v1` | Cross-peer video tracks (camera or display capture) | [ADR-0015](adr/0015-media-tracks.md), [addon-media-spec.md](addon-media-spec.md) §`media.{send,receive}.video` |
| `file-transfer-v1` | Local file picker + chunked file transfer | this spec §File Transfer |
| `addon-runtime-v1` | Sandboxed-iframe add-on runtime contract | [ADR-0003](adr/0003-addon-sandbox-model.md), [addon-runtime-spec.md](addon-runtime-spec.md) |
| `local-storage-v1` | Per-add-on local-first persistence | [ADR-0005](adr/0005-local-first-persistence.md), [addon-storage-spec.md](addon-storage-spec.md) |

Adding, removing, or repurposing a capability tag requires an ADR
that names ADR-0026 as authority for the convention. New tags MUST
be added to this table in the same PR that ships the implementation.

The previously documented `voice-v1` is **superseded** by
`media-audio-v1` (per ADR-0026 §Decision); peers SHOULD NOT advertise
`voice-v1` on new sessions. A peer that does not advertise
`peer-bin-v1` MUST be assumed not to support binary peer transfer;
senders MUST gracefully fall back to text flows or surface a UI
error. The same opt-in fallback applies to `media-audio-v1` and
`media-video-v1`.

## Text

- Text messages **MUST** be sent over DataChannel.
- Small messages **MAY** be sent without compression.
- Larger messages **MAY** be compressed.

## Media (audio + video)

- Media tracks **MUST** use WebRTC `MediaStream` / `MediaStreamTrack`.
- Capture **MUST** be host-owned: `getUserMedia` and `getDisplayMedia`
  are called only from the host page in response to a fresh user
  gesture, never from inside an add-on iframe
  ([ADR-0015](adr/0015-media-tracks.md);
  [addon-media-spec.md](addon-media-spec.md)).
- Track attachment to the existing `RTCPeerConnection` MUST ride the
  perfect-negotiation pattern through the same `SignalingTransport`
  the session already uses; no separate signaling channel is opened
  for media.
- Media **MUST** use browser-native codecs; app-layer compression
  **MUST NOT** be applied.
- A peer advertising `media-audio-v1` (cross-peer audio) does not
  imply `media-video-v1` (cross-peer video); the two capabilities are
  negotiated independently, mirroring the
  `media.{send,receive}.{audio,video}` permission split.

## File Transfer

- File transfers **MUST** use DataChannel.
- Files **MUST** be chunked.
- Implementations **MAY** compress chunks when useful.
- The receiver **MUST** explicitly choose whether to save the file (no
  silent disk writes).

## Presence

Presence events include:

- joined
- left
- typing
- speaking
- muted
- idle
- connection quality
- add-on active
