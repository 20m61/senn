# SENN Add-on Specification

## Definition

A SENN add-on is a static UI and logic module.
Add-ons can create communication experiences, but they cannot directly own network connections.
Dynamic data flow must go through SENN Core.

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

Allows reading non-content audio level metadata.

## Forbidden

Add-ons must not:

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

Add-ons run in sandboxed iframes.

Recommended:

```html
<iframe sandbox="allow-scripts" src="addon/index.html"></iframe>
```

## CSP

Default CSP for add-ons:

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
