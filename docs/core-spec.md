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

Peers exchange supported capabilities on connection.

```json
{
  "type": "hello",
  "client": "senn",
  "version": "0.1.0",
  "capabilities": [
    "text-v1",
    "voice-v1",
    "file-transfer-v1",
    "addon-runtime-v1",
    "local-storage-v1"
  ]
}
```

## Text

- Text messages **MUST** be sent over DataChannel.
- Small messages **MAY** be sent without compression.
- Larger messages **MAY** be compressed.

## Voice

- Voice **MUST** use WebRTC MediaStream.
- Voice **MUST** use browser-native codecs; app-layer compression
  **MUST NOT** be applied.

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
