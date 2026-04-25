# Add-on Cookbook

## Intent

Ready-to-adapt recipes for the most common rich add-on patterns. Every
recipe states the minimum manifest and the SDK calls. The runtime is
the classic-script `window.senn` global from
[`addon-sdk-spec.md`](../addon-sdk-spec.md); each `index.html` loads
`senn-addon-sdk.js` (copied from `packages/addon-sdk/runtime/`) before
its own `addon.js`.

If you are an AI agent generating an add-on, prefer adapting a recipe
over inventing structure. Follow the manifest fields exactly; only add
what you need. The recipes below are condensed; the **shipping**
versions of all of these (signed against the official trust root) live
under `apps/web/public/addons/` and are the authoritative implementations.

## Recipe index

| Recipe | What it shows | Minimum permissions |
|--------|---------------|----------------------|
| [Whiteboard](#whiteboard) | Stroke events over peers, optional local save | `peer.send`, `peer.receive`, `storage.local.write`, `ui.panel` |
| [Avatar Presence](#avatar-presence) | State-only presence (no video) — speaking + reactions | `peer.send`, `peer.receive`, `audio.level`, `ui.overlay` |
| [Local Vault](#local-vault) | Saved files / cards, listed and deletable; chunked P2P transfer | `storage.local.read`, `storage.local.write`, `file.read.user_selected`, `file.write.user_approved`, `peer.send.bin`, `peer.receive.bin`, `ui.panel` |
| [Voice Meter](#voice-meter) | Speaking detection without raw audio | `audio.level`, `ui.panel` |
| [Voice Call](#voice-call) | 1:1 mic + remote audio via the ADR-0015 media bridge | `media.send.audio`, `media.receive.audio`, `ui.panel` |
| [Co-pointer / cursor](#co-pointer) | Throttled pointer presence | `peer.send`, `peer.receive`, `ui.overlay` |

---

## Whiteboard

```json
{
  "id": "com.example.whiteboard",
  "name": "Whiteboard",
  "version": "0.1.0",
  "description": "Shared whiteboard. Strokes flow P2P; the canvas snapshot is local-first.",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "storage.local.write", "ui.panel"],
  "capabilities": ["whiteboard-v1"]
}
```

```js
// addon.js — loaded after senn-addon-sdk.js
senn.on("deliver", ({ payload }) => {
  if (payload?.type === "stroke") draw(payload.point);
});

canvas.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  senn.peer.send({ type: "stroke", point: { x: e.offsetX, y: e.offsetY } });
});

saveBtn.addEventListener("click", async () => {
  await senn.storage.put("snapshot", canvas.toDataURL());
});

senn.ready();
```

Throttle stroke events (e.g. coalesce to 60 Hz). The add-on never opens
its own data channel — `senn.peer.send` rides Core's `core.text` channel.

---

## Avatar Presence

```json
{
  "id": "com.example.avatar-presence",
  "name": "Avatar Presence",
  "version": "0.1.0",
  "description": "Lightweight presence (speaking, reactions). No video — state only.",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "audio.level", "ui.overlay"],
  "capabilities": ["avatar-presence-v1"]
}
```

```js
// Speaking detection is energy-only; the host computes the level.
senn.audio.subscribeLevel((level) => {
  setSpeaking(level > 0.05);
  if (level > 0.05) senn.peer.send({ type: "speaking", level });
});

senn.on("deliver", ({ payload, from }) => {
  if (payload?.type === "reaction") spawnEmoji(from, payload.emoji);
});

reactionPicker.addEventListener("pick", (ev) => {
  senn.peer.send({ type: "reaction", emoji: ev.detail });
});

senn.ready();
```

Never send raw audio or video. Avatar presence is metadata only —
that's what the `audio.level` permission is for.

---

## Local Vault

```json
{
  "id": "com.example.local-vault",
  "name": "Local Vault",
  "version": "0.1.0",
  "description": "Stores user-selected files locally and ships them P2P (≤ 4 MiB chunked).",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": [
    "storage.local.read",
    "storage.local.write",
    "file.read.user_selected",
    "file.write.user_approved",
    "peer.send.bin",
    "peer.receive.bin",
    "ui.panel"
  ],
  "capabilities": ["local-vault-v1"]
}
```

```js
// User-selected file → store locally + ship to peer.
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await senn.storage.put(file.name, { mime: file.type, size: bytes.byteLength });
  senn.peer.sendBinary({ mime: file.type, bytes }); // chunked transparently up to 4 MiB
});

senn.on("deliver-bin", async ({ mime, bytes, from }) => {
  // user-approved download — see file.write.user_approved
  const ok = confirm(`Save ${bytes.byteLength} bytes from peer?`);
  if (!ok) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
  a.download = `from-${from ?? "peer"}.bin`;
  a.click();
});

const items = await senn.storage.list();
items.forEach(renderRow);

senn.ready();
```

`peer.sendBinary` accepts up to 4 MiB per logical message; PeerSession
splits it into ≤ 60 KiB on-wire frames (ADR-0011 / ADR-0012). The
addon does not see the chunking. `iframe sandbox` needs
`allow-downloads` for the `a.click()` save flow — `AddonHost` adds
that token automatically when the manifest declares
`file.write.user_approved`.

---

## Voice Meter

```json
{
  "id": "com.example.voice-meter",
  "name": "Voice Meter",
  "version": "0.1.0",
  "description": "Visualises microphone-derived audio level via the audio.level bridge — no raw audio is exposed to the add-on.",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["audio.level", "ui.panel"],
  "capabilities": ["voice-meter-v1"]
}
```

```js
const meter = document.querySelector('[data-testid="meter-value"]');
const speaking = document.querySelector('[data-testid="meter-speaking"]');

senn.audio.subscribeLevel((level) => {
  meter.textContent = level.toFixed(3);
  speaking.textContent = level > 0.05 ? "yes" : "no";
});

senn.ready();
```

The host runs `getUserMedia` + an `AnalyserNode`, computes RMS, and
delivers it through `audio.level`. The add-on never holds a
`MediaStream`.

---

## Voice Call

```json
{
  "id": "com.example.voice-call",
  "name": "Voice Call",
  "version": "0.1.0",
  "description": "Reference 1:1 voice call via the media.* bridge; the addon never sees raw audio (ADR-0015).",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["media.send.audio", "media.receive.audio", "ui.panel"],
  "capabilities": ["voice-call-v1"]
}
```

```js
senn.media.onTrack(({ direction, track, state }) => {
  // direction: "local" | "remote", track: "audio" | "video", state: "added" | "removed"
  setUiState(direction, track, state);
});

btnStart.addEventListener("click", () => senn.media.startLocalAudio());
btnStop.addEventListener("click", () => senn.media.stopLocalAudio());
btnListen.addEventListener("click", () => senn.media.subscribeRemoteAudio());
btnMute.addEventListener("click", () => senn.media.unsubscribeRemoteAudio());

senn.on("error", (err) => log(`error: ${err.code ?? ""} ${err.message}`));

senn.ready();
```

ADR-0015 contract: the add-on **asks** the host to start / stop
sending or receiving; the host owns `getUserMedia` and the
`<audio>` / `<video>` element where the remote track lands. The
host MUST stop the underlying `MediaStreamTrack` on stop / close so
the OS mic indicator flips off — that's a privacy MUST verified by
the addon-runtime regression tests.

---

## Co-pointer

```json
{
  "id": "com.example.copointer",
  "name": "Co-pointer",
  "version": "0.1.0",
  "description": "Throttled pointer presence overlay.",
  "entry": "index.html",
  "license": "Apache-2.0",
  "network": false,
  "permissions": ["peer.send", "peer.receive", "ui.overlay"],
  "capabilities": ["copointer-v1"]
}
```

```js
let last = 0;
window.addEventListener("pointermove", (e) => {
  const now = performance.now();
  if (now - last < 16) return;            // ~60 Hz cap
  last = now;
  senn.peer.send({ type: "pointer", x: e.clientX, y: e.clientY });
});

senn.on("deliver", ({ payload, from }) => {
  if (payload?.type === "pointer") moveGhost(from, payload);
});

senn.ready();
```

Throttle. Pointer streams flooded into Core will hit the per-add-on
rate limit and degrade other add-ons in the same room.
