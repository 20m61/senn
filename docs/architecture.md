# SENN Architecture

## High-level Architecture

```txt
[Static Hosting / CDN]
  - SENN Web App
  - Static Add-ons
  - Manifest files
  - Signature metadata
          ↓
[Browser A]
  - SENN Core
  - Add-on Runtime
  - Local Storage
  - WebRTC Transport
  - Static Add-ons
          ⇄ WebRTC P2P
[Browser B]
  - SENN Core
  - Add-on Runtime
  - Local Storage
  - WebRTC Transport
  - Static Add-ons
```

## Core Components

### Room Manager

- Creates temporary rooms.
- Generates invite URLs.
- Generates QR codes.
- Handles room lifecycle.

### Peer Connection Manager

- Manages WebRTC peer connections.
- Handles ICE candidates.
- Manages connection state.
- Exposes connection quality.

### DataChannel Manager

- Opens RTCDataChannel.
- Sends and receives core messages.
- Handles ordering, chunking, and flow control.

### Message Router

- Routes core messages.
- Routes add-on messages.
- Validates message envelopes.
- Enforces size limits and permission rules.

### Add-on Runtime

- Loads static add-ons.
- Runs add-ons in sandboxed iframes.
- Bridges add-on messages to Core API.
- Enforces permissions.

### Storage Manager

- Provides local storage APIs.
- Separates storage by add-on.
- Uses IndexedDB and OPFS.
- Supports explicit user-controlled persistence.

### Security Manager

- Validates manifests.
- Applies CSP policies.
- Manages permissions.
- Enforces sandbox boundaries.

## Optional Components

### Ephemeral Signaling

Used only to establish peer connections.
No message content is stored.

Signaling is **pluggable** via the `SignalingTransport` interface in
`@senn/protocol`. Reference adapters (URL/QR fragment, HTTP short-poll,
WebSocket, …) live outside Core; host applications choose one at startup.
SENN Core MUST NOT depend on any specific signaling backend. See
[ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md) and
[deployment.md](deployment.md).

### TURN Relay

Used only as an explicit fallback if direct P2P fails.
The product should prefer direct P2P and expose relay mode clearly.
