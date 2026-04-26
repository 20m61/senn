# SENN Add-on Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Definition

A SENN add-on is a static UI and logic module.
Add-ons **MAY** create communication experiences but **MUST NOT** directly
own network connections. Dynamic data flow **MUST** go through SENN Core.

## Add-on Package

```txt
addon/
  manifest.json
  index.html
  addon.js
  style.css
  assets/
```

## Manifest Example

```json
{
  "id": "com.example.whiteboard",
  "name": "Whiteboard",
  "version": "1.0.0",
  "description": "A simple P2P whiteboard add-on.",
  "entry": "index.html",
  "license": "MIT",
  "author": "Example Developer",
  "network": false,
  "permissions": [
    "peer.send",
    "peer.receive",
    "storage.local.write",
    "ui.panel"
  ],
  "capabilities": [
    "whiteboard-v1"
  ]
}
```

## Required Fields

- `id`
- `name`
- `version`
- `entry`
- `license`
- `permissions`
- `network`
- `capabilities`

See [addon-manifest.md](addon-manifest.md) for the full schema.

## Permissions

### `peer.send`

Allows sending add-on messages to connected peers through SENN Core.

### `peer.receive`

Allows receiving add-on messages from connected peers through SENN Core.

### `peer.send.bin`

Allows sending binary payloads (≤ 64 KiB single-frame, v1) to the
connected peer over the dedicated `core.bin` channel. See
[addon-binary-transfer-spec.md](addon-binary-transfer-spec.md).

### `peer.receive.bin`

Allows receiving binary payloads from connected peers over `core.bin`.

### `storage.local.read`

Allows reading the add-on's own local storage namespace.

### `storage.local.write`

Allows writing to the add-on's own local storage namespace.

### `file.read.user_selected`

Allows reading files explicitly selected by the user.

### `file.write.user_approved`

Allows writing files explicitly approved by the user.

### `ui.panel`

Allows showing a panel in the SENN UI.

### `ui.overlay`

Allows showing an overlay in the SENN UI.

### `presence.read`

Allows reading peer presence state.

### `audio.level`

Allows receiving microphone-derived energy values in `[0, 1]` from
the host. The add-on never sees raw audio. See
[addon-audio-level-spec.md](addon-audio-level-spec.md).

### `media.send.audio` / `media.send.video` / `media.receive.audio` / `media.receive.video`

Cross-peer audio and video tracks. The add-on never owns a
`MediaStreamTrack`; the host captures with `getUserMedia` and the
add-on places host-rendered `<video>` / `<audio>` elements via
opaque routing handles. Currently **design only** — see
[ADR-0015](adr/0015-media-tracks.md) and
[addon-media-spec.md](addon-media-spec.md). Manifests MAY declare
these permissions ahead of implementation; the bridge ops will
land in follow-up PRs.

## Forbidden

Add-ons **MUST NOT**:

- Directly use WebSocket for dynamic user data.
- Directly use WebRTC.
- Directly access RTCDataChannel.
- Exfiltrate data through fetch.
- Access other add-ons' storage.
- Access Core private storage.
- Read files without user selection.
- Store data without user approval.
- Bypass SENN permissions.
- Fake Core security UI.

## Runtime

Add-ons **MUST** run in sandboxed iframes. The host **SHOULD** declare the
iframe as follows:

```html
<iframe sandbox="allow-scripts" src="addon/index.html"></iframe>
```

The host **MUST NOT** add `allow-same-origin`, `allow-top-navigation`, or
`allow-popups-to-escape-sandbox` to add-on iframes.

## CSP

The host **MUST** apply the following Content-Security-Policy to every
add-on iframe (additional restrictions **MAY** be added; the listed
directives **MUST NOT** be relaxed):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
media-src 'self' blob:;
connect-src 'none';
frame-ancestors 'self';
```

## API Principle

Bad:

```js
dataChannel.send(payload)
```

Good:

```js
await senn.peer.send({
  addon: "com.example.whiteboard",
  type: "stroke",
  payload: {
    x: 120,
    y: 240
  }
});
```
