# ADR 0015: Cross-peer media tracks (audio + video) — design contract

## Status

Implemented. Stage 1 (PeerSession `addLocalTrack` + `remote-track`
events) landed in commit d32497a; stages 2–5 (host media bridge,
Addon SDK `senn.media.*`, voice-call reference addon, audit grep)
landed in 65c3e1c. Bidirectional perfect negotiation followed in
4cd0b4a, and the host-side `track.stop()` privacy fix landed in
4bddf5b.

## Context

The SENN [Charter](../charter.md) Mission says SENN moves
"テキスト、音声、ファイル、状態、操作イベント、アドオンデータ"
between peers. Today the text path is `core.text`, the file path is
`core.bin` (ADR-0011/0012), and metadata-only audio is the
`audio.level` bridge (ADR added during voice-meter work). What is
missing — and the largest standing gap against the Charter Mission —
is **actual cross-peer audio and video streams**.

Constraints from the rest of the architecture:

- The Core sandbox model
  ([ADR-0003](0003-addon-sandbox-model.md)) keeps add-ons inside an
  iframe with `allow-scripts` and an opaque origin. Media capture
  inside that iframe would require an extra browser permission per
  origin and is operationally hostile.
- The bridge contract
  ([addon-runtime-spec](../addon-runtime-spec.md)) is "addon never
  owns dynamic network connections, never owns the raw transport".
  Any media path must keep that.
- The peer transport already exists: `RTCPeerConnection`. WebRTC
  natively supports media tracks alongside data channels. Adding a
  second peer connection would be wasteful.
- Vendor neutrality
  ([ADR-0007](0007-vendor-neutral-signaling-and-relay.md)) — no
  third-party SFU, no media-specific signaling shape.

## Decision

1. **Media is `RTCRtpSender` / `RTCRtpReceiver` on the existing
   PeerSession**, not a new data channel and not a new peer
   connection. PeerSession gains a typed surface for adding /
   removing tracks; the underlying SDP renegotiation flows through
   the same `SignalingTransport`.

2. **Capture stays host-side.** `getUserMedia` is called by the
   host app (analogous to the audio.level pipeline), which then
   passes the resulting `MediaStream` into PeerSession. Add-ons
   never receive a `MediaStreamTrack` reference.

3. **Add-ons get routing handles, not raw streams.** A new bridge
   surface lets an add-on:
   - declare it wants to *render* the remote peer's audio or video
     (to a `<video>` / `<audio>` element the host page provides),
   - subscribe to **track-level events** (track-added, track-ended,
     mute, unmute, signal-level),
   - request `audio.level`-style metadata derived from the remote
     stream (so a peer-side voice meter is symmetric with the local
     one).

   The actual rendering happens on the host page, not inside the
   addon iframe. The host displays the `<video>` element wherever
   the addon's UI directs it (e.g. an addon-supplied container).

4. **Four new permission strings.**
   | Permission | What it grants |
   |-----------|----------------|
   | `media.send.audio` | Host MAY add a microphone track to the peer connection on this addon's request. Capture remains host-side; the addon does not see audio bytes. |
   | `media.send.video` | Same as above for camera (or display capture). |
   | `media.receive.audio` | Host MAY render the remote audio track in a host-controlled element on the addon's behalf. |
   | `media.receive.video` | Same for video. |

   Sending and receiving are independent. An "ear-only" addon
   declares only `media.receive.audio`. A "broadcast" addon
   declares only `media.send.video`.

5. **Add-ons never call `getUserMedia` themselves.** The bridge
   refuses any media op from an iframe whose `sandbox` does not
   include the corresponding browser-level permission. SENN's
   sandbox MUST NOT add `allow-popups-to-escape-sandbox` or feature
   policy `microphone` / `camera` to the iframe — capture stays
   strictly on the host page's origin.

6. **Bandwidth caps are operator policy, not protocol.** The bridge
   does not enforce a max bitrate. Hosts that want to cap (e.g.
   for low-bandwidth regions) configure the `RTCRtpSender`
   parameters directly.

7. **No project-default SFU.** Multi-party media (mesh, SFU, MCU)
   is out of scope for v1. PeerSession is 1:1; multi-party is a
   separate orchestration layer the host builds. ADR-0013's TURN
   contract handles the symmetric-NAT case.

## Rationale

- WebRTC media tracks ride on the same `RTCPeerConnection` as the
  data channels we already have, so we don't add wire surface or
  new signaling kinds. The existing `SignalingMessage` schema
  already carries SDP and ICE — renegotiation for a track add fits
  the same `offer` / `answer` flow.
- Keeping `getUserMedia` on the host page solves three problems at
  once: (a) the user prompt happens once on a familiar origin,
  (b) the addon iframe stays at its minimum sandbox, (c) raw audio
  / video frames never enter the addon, matching how `audio.level`
  already works.
- Routing handles instead of stream references means an addon can
  layout the remote video in its UI (place a `<video>` element,
  size it, mute it) without owning the track. The host attaches
  the actual `srcObject` outside the iframe.
- Splitting send and receive into separate permission strings keeps
  least-privilege. An add-on that only listens to remote audio for
  presence detection never gets a path to broadcast.
- Refusing to host an SFU keeps the project's vendor-neutrality
  promise. Multi-party SFU implies running infrastructure or
  picking a vendor; both contradict the charter.

## Consequences

- `@senn/core` PeerSession gains methods like `addLocalTrack(track,
  { kind: "audio" | "video" })`, `removeLocalTrack(senderId)`, and
  events `remote-track-added` / `remote-track-removed`. Renegotiation
  is internal — the host calls a method, PeerSession sends a fresh
  offer through the existing transport.
- `@senn/addon-runtime` AddonHost gains bridge ops for the media
  permissions: `media.subscribe.audio` / `media.subscribe.video`
  (returns track id + a host-rendered element handle), `media.send.{
  audio | video }.start` / `.stop`, and `media.level` events
  symmetric with the existing `audio.level` for incoming streams.
  Permission gates mirror the existing send-bin / audio.level work.
- `@senn/addon-sdk` exposes:
  ```ts
  interface SennAddonMedia {
    requestRemoteAudio(into: HTMLElement): Promise<{ unsubscribe: () => void }>;
    requestRemoteVideo(into: HTMLElement): Promise<{ unsubscribe: () => void }>;
    requestSendAudio(): Promise<{ stop: () => void }>;
    requestSendVideo(opts: { camera?: boolean; display?: boolean }): Promise<{ stop: () => void }>;
    onRemoteLevel(handler: (kind: "audio" | "video", level: number) => void): () => void;
  }
  ```
- New normative spec `docs/addon-media-spec.md` defines the wire
  side of these ops, including the host's element-handle protocol
  (an opaque id passed across the bridge that the host resolves to
  a real DOM element).
- The forbidden-API grep
  ([addon-runtime-spec](../addon-runtime-spec.md)) extends to
  `getUserMedia`, `getDisplayMedia`, `MediaRecorder`, and direct
  `MediaStreamTrack` access — addons MUST go through the bridge.
- Compatibility: peers without `media.*` permissions never advertise
  tracks, so old peers keep working unchanged. A peer that adds a
  track will trigger a fresh SDP exchange; the receiving peer must
  decide whether to render based on its own permissions / UX.
- Multi-party expansion later: an SFU would speak the *same*
  `SignalingTransport` from the SFU's vantage point, so the addon
  contract here is forward-compatible. The decision to ship one is
  separate.

## What this ADR explicitly does NOT do

- Implement any of the above in code. Implementation is staged in
  follow-up PRs (probably split into: PeerSession track surface,
  AddonHost bridge ops, SDK surface, reference "voice-call" addon).
- Define multi-party media. That needs its own ADR after a real
  use case lands.
- Define recording. Recording across peers is a feature an addon
  may build (with both sides' consent surfaced in UI), but the
  protocol stays oblivious — the addon receives metadata-derived
  level events and a host-rendered `<video>` handle, not raw frames.
- Define DRM. SENN does not transport DRM-protected media; if a
  deployment needs Widevine / FairPlay / PlayReady, that lives
  outside SENN.
