# ADR 0004: P2P Transport Strategy

## Status

Accepted

## Decision

SENN uses WebRTC as the primary P2P transport.
RTCDataChannel is used for dynamic add-on and message data.
MediaStream is used for voice.
Direct P2P is preferred. TURN is optional fallback.

## Rationale

WebRTC provides browser-native P2P communication and avoids custom network stack complexity.

## Consequences

- Connectivity over restrictive NATs requires an optional TURN deployment, which is deferred past MVP.
- Signaling is ephemeral; SENN-hosted signaling never persists message content.
- The transport surface is intentionally narrow so additional channels (e.g. WebTransport) can be added later behind the same Core API.
