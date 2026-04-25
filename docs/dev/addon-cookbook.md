# Add-on Cookbook

## Intent

Ready-to-adapt recipes for the most common rich add-on patterns. Every
recipe states the minimum manifest, the SDK calls, and the conformance
notes. Copy, then customize.

If you are an AI agent generating an add-on, prefer adapting a recipe over
inventing structure. Follow the manifest fields exactly; only add what you
need.

## Recipe index

| Recipe | What it shows | Minimum permissions |
|--------|---------------|----------------------|
| [Whiteboard](#whiteboard) | Stroke events over peers, optional local save | `peer.send`, `peer.receive`, `storage.local.write`, `ui.panel` |
| [Avatar Presence](#avatar-presence) | Lightweight presence, no video | `peer.send`, `peer.receive`, `presence.read`, `audio.level`, `ui.overlay` |
| [Local Vault](#local-vault) | Saved files / cards, listed and deletable | `storage.local.read`, `storage.local.write`, `file.write.user_approved`, `ui.panel` |
| [File Drop](#file-drop) | User-selected file → peer | `peer.send`, `peer.receive`, `file.read.user_selected`, `ui.panel` |
| [Local Profile](#local-profile) | Display name + icon, shared on join | `peer.send`, `peer.receive`, `storage.local.write`, `ui.panel` |
| [Co-pointer / cursor](#co-pointer) | Throttled pointer presence | `peer.send`, `peer.receive`, `ui.overlay` |

---

## Whiteboard

```json
{
  "id": "com.example.whiteboard",
  "name": "Whiteboard",
  "version": "0.1.0",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "storage.local.write", "ui.panel"],
  "capabilities": ["whiteboard-v1"]
}
```

```ts
import { createAddon } from "@senn/addon-sdk";

const addon = await createAddon({ id: "com.example.whiteboard", version: "0.1.0" });

addon.peer.on("whiteboard-v1", (msg) => {
  if (msg.type === "stroke") draw(msg.payload);
});

canvas.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  addon.peer.send({ type: "stroke", payload: { x: e.offsetX, y: e.offsetY } });
});

saveBtn.addEventListener("click", async () => {
  await addon.storage.put("snapshot", canvas.toDataURL());
});
```

Conformance notes: throttle stroke events (e.g. coalesce to 60 Hz max).
SENN Core enforces a per-add-on rate limit; staying well under it keeps the
add-on portable.

---

## Avatar Presence

```json
{
  "id": "com.example.avatar-presence",
  "name": "Avatar Presence",
  "version": "0.1.0",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "presence.read", "audio.level", "ui.overlay"],
  "capabilities": ["avatar-presence-v1"]
}
```

```ts
const addon = await createAddon({ id: "com.example.avatar-presence", version: "0.1.0" });

addon.presence.on((p) => render(p.peerId, { speaking: p.speaking, level: p.audioLevel }));

addon.peer.on("avatar-presence-v1", (msg) => {
  if (msg.type === "reaction") spawnEmoji(msg.payload.emoji);
});

reactionPicker.on("pick", (emoji) => {
  addon.peer.send({ type: "reaction", payload: { emoji } });
});
```

Conformance notes: never send raw audio or video. SENN's avatar presence
relies on Core-derived metadata (`presence.read`, `audio.level`) only.

---

## Local Vault

```json
{
  "id": "com.example.local-vault",
  "name": "Local Vault",
  "version": "0.1.0",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["storage.local.read", "storage.local.write", "file.write.user_approved", "ui.panel"],
  "capabilities": ["local-vault-v1"]
}
```

```ts
const addon = await createAddon({ id: "com.example.local-vault", version: "0.1.0" });

const items = await addon.storage.list();
items.forEach(renderRow);

deleteBtn.addEventListener("click", async (e) => {
  await addon.storage.delete(e.currentTarget.dataset.key);
});
```

Conformance notes: `file.write.user_approved` requires a Core-mediated
approval prompt; the add-on never writes files unprompted.

---

## File Drop

```json
{
  "id": "com.example.file-drop",
  "name": "File Drop",
  "version": "0.1.0",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "file.read.user_selected", "ui.panel"],
  "capabilities": ["file-drop-v1"]
}
```

```ts
const addon = await createAddon({ id: "com.example.file-drop", version: "0.1.0" });

dropZone.addEventListener("drop", async (e) => {
  const file = await addon.files.pickDropped(e);
  await addon.peer.sendFile(file);
});

addon.peer.onFile(async (incoming) => {
  if (await addon.ui.confirm(`Save ${incoming.name}?`)) {
    await addon.files.save(incoming);
  }
});
```

Conformance notes: file metadata flows through Core; the add-on never
touches `RTCDataChannel` directly. Save dialogs MUST be user-driven.

---

## Local Profile

```json
{
  "id": "com.example.local-profile",
  "name": "Local Profile",
  "version": "0.1.0",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "storage.local.write", "ui.panel"],
  "capabilities": ["local-profile-v1"]
}
```

```ts
const addon = await createAddon({ id: "com.example.local-profile", version: "0.1.0" });

const profile = (await addon.storage.get("profile")) ?? { name: "anon", color: "#888" };

addon.peer.on("local-profile-v1", (msg) => {
  if (msg.type === "hello") render(msg.from, msg.payload);
});

addon.peer.send({ type: "hello", payload: profile });
```

---

## Co-pointer

```json
{
  "id": "com.example.copointer",
  "name": "Co-pointer",
  "version": "0.1.0",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "ui.overlay"],
  "capabilities": ["copointer-v1"]
}
```

```ts
const addon = await createAddon({ id: "com.example.copointer", version: "0.1.0" });

let last = 0;
window.addEventListener("pointermove", (e) => {
  const now = performance.now();
  if (now - last < 16) return;            // ~60 Hz cap
  last = now;
  addon.peer.send({ type: "pointer", payload: { x: e.clientX, y: e.clientY } });
});

addon.peer.on("copointer-v1", (msg) => moveGhost(msg.from, msg.payload));
```

Conformance notes: throttle. Pointer streams flooded into Core will hit
rate limits and degrade other add-ons in the same room.
