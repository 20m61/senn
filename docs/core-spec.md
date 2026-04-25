# SENN Core Specification

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

- A room can be created without an account.
- Room IDs must be random and hard to guess.
- Room data is not stored on application servers.
- Invite data may be embedded in URL fragments.
- QR invites must be supported.

## Peer Connection

SENN uses WebRTC.

### Requirements

- Direct P2P is preferred.
- RTCDataChannel is used for dynamic data.
- MediaStream is used for voice.
- Connection state must be visible to users.
- Failure states must be understandable.

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

- Sent over DataChannel.
- Small messages are sent without compression.
- Larger messages may be compressed.

## Voice

- Uses WebRTC MediaStream.
- Uses browser-native codecs.
- App-layer compression is not applied.

## File Transfer

- Uses DataChannel.
- Files are chunked.
- Compress only when useful.
- Receiver explicitly chooses whether to save.

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
