# SENN MVP Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Goal

Validate that SENN can provide:

1. Browser P2P communication.
2. Static add-on execution.
3. Core-managed peer data flow.
4. Optional local persistence.
5. Minimal developer experience for add-ons.

## MVP Core Features

- Static web app
- Room creation
- Invite URL
- QR invite
- WebRTC P2P connection
- RTCDataChannel
- Text messages
- Voice call
- File transfer
- Presence
- Reactions
- Capability negotiation
- Add-on runtime
- Sandboxed iframe add-ons
- Manifest validation
- Core Add-on API
- Local storage API
- Basic compression

## MVP Official Add-ons

### Local Profile

- Display name
- Icon
- Local ID
- Theme color

### Local Vault

- Save received files
- Save profile cards
- List saved items
- Delete saved items

### Whiteboard

- Draw strokes
- Send stroke events P2P
- Optional local save

### Avatar Presence

- Display lightweight avatar
- React to speaking state
- React to reactions
- No video transmission

## MVP Exclusions

- Account system
- Cloud storage
- Name search
- Friend cloud sync
- Multi-party video conference
- Public social network
- Paid marketplace
- IPFS bridge
- Full XR
- Server AI

## Initial Design Decisions

The following five decisions are locked in at MVP scope (see ADRs for rationale):

1. TURN は MVP では任意・後回し。Direct P2P を優先し、relay モードは UI で明示。
2. アドオン外部通信は初期は完全禁止。`connect-src 'none'` を CSP デフォルトに。
3. UI は軽量に。Vite + TypeScript + 最小 UI（Web Components 寄り）。
4. ローカル保存は `packages/storage` に分離。Core API として再エクスポート。
5. 公式アドオンは同一モノレポ（`addons/official/*`）で管理。
