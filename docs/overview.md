# SENN Overview

## What SENN Provides

SENN provides a browser-native P2P communication runtime.

Users can:

1. Open a SENN-powered web app.
2. Create a temporary room.
3. Share an invite URL or QR code.
4. Connect directly with another user.
5. Exchange messages, files, voice, reactions, presence, and add-on events.
6. Optionally save selected data locally.
7. Optionally share saved data with peers.

## Server Responsibilities

Servers may provide:

- Static web app hosting
- Static add-on hosting
- Add-on metadata
- Signature metadata
- Version metadata
- Compatibility metadata
- Optional ephemeral signaling

Servers must not store:

- Chat content
- Voice data
- File content
- Add-on dynamic data
- Profiles
- Room state
- Local storage data
- Peer relationship data

## Add-on Model

Add-ons are static UI and logic modules.
They can provide experiences such as:

- Whiteboards
- Avatars
- XR rooms
- File vaults
- Profile cards
- Games
- Local notes
- Event interactions

Add-ons cannot directly send dynamic data over the network.
They must use SENN Core APIs.

## Data Flow

```txt
Add-on
  ↓
SENN Core API
  ↓
Permission Check
  ↓
Message Envelope
  ↓
Validation / Compression
  ↓
WebRTC DataChannel
  ↓
Peer Browser
  ↓
SENN Core
  ↓
Target Add-on
```
