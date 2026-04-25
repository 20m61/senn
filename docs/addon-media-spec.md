# Add-on Media Specification (cross-peer audio + video)

## Status

Design only. The bridge ops below are normative for any future
implementation; the wire format on `RTCPeerConnection` is the
existing WebRTC mechanics — there is nothing SENN-specific on the
network side.

## Intent

Define how a SENN add-on requests **cross-peer audio and video
streams** without ever owning a `MediaStreamTrack` or a raw frame.
The add-on layouts host-rendered `<video>` / `<audio>` elements
through opaque routing handles; the host page captures with
`getUserMedia`, attaches tracks to PeerSession, and renders incoming
tracks into the host-controlled DOM the addon points at.

The decision and rationale live in
[ADR-0015](adr/0015-media-tracks.md). This page covers the wire
shape and the conformance bar an implementation must hit.

## Threat surface

A `MediaStreamTrack` reference inside the addon iframe would let a
buggy or malicious addon:

- record without the user noticing,
- decode the audio with `MediaRecorder` or `AudioWorklet` and ship
  the decoded frames over `peer.send.bin`,
- cross-correlate via `getCapabilities()` / `getSettings()` (device
  IDs, focal length, …).

This spec keeps the raw track entirely host-side. The add-on sees:

- an opaque, host-issued element handle (a string id),
- track-level events (`added`, `removed`, `mute`, `unmute`,
  `level`),
- numeric level values (the same shape as `audio.level`).

That is enough for "show the remote camera here", "mute the local
mic", or "draw a meter that pulses with the remote talker", and not
enough to reconstruct content outside SENN's contract.

## Permission strings

| Permission | What it allows |
|------------|----------------|
| `media.send.audio` | Host MAY add a microphone track to the peer connection on the addon's request. |
| `media.send.video` | Host MAY add a camera or display-capture track. |
| `media.receive.audio` | Host MAY render a remote audio track into a host-controlled element on the addon's behalf. |
| `media.receive.video` | Same for remote video. |

Sending and receiving are independent. An add-on that only listens
to a remote talker for presence detection declares only
`media.receive.audio`.

## Bridge ops

Two op categories: **send** (addon → host: capture + transmit) and
**receive** (addon → host: render + observe).

```ts
// addon → host: start sending local microphone audio.
interface AddonMediaSendAudioStart {
  readonly kind: "senn.addon.v1";
  readonly op: "media.send.audio.start";
}

// addon → host: stop sending. Idempotent.
interface AddonMediaSendAudioStop {
  readonly kind: "senn.addon.v1";
  readonly op: "media.send.audio.stop";
}

// Symmetric ops for video.
interface AddonMediaSendVideoStart {
  readonly kind: "senn.addon.v1";
  readonly op: "media.send.video.start";
  /** Source preference: "camera" (default) or "display" for screen share. */
  readonly source?: "camera" | "display";
}
interface AddonMediaSendVideoStop {
  readonly kind: "senn.addon.v1";
  readonly op: "media.send.video.stop";
}

// addon → host: render the remote audio into an addon-supplied element.
interface AddonMediaReceiveAudioRequest {
  readonly kind: "senn.addon.v1";
  readonly op: "media.receive.audio.subscribe";
  /** A handle the addon previously got back from "media.element.create". */
  readonly elementHandle: string;
}
// Symmetric for video.
interface AddonMediaReceiveVideoRequest {
  readonly kind: "senn.addon.v1";
  readonly op: "media.receive.video.subscribe";
  readonly elementHandle: string;
}
interface AddonMediaUnsubscribe {
  readonly kind: "senn.addon.v1";
  readonly op: "media.receive.unsubscribe";
  readonly elementHandle: string;
}

// addon → host: ask the host to mount a media element above an
// addon-chosen anchor (a CSS-rect within the iframe). The host
// returns a handle the addon then references in `subscribe` ops.
interface AddonMediaElementCreate {
  readonly kind: "senn.addon.v1";
  readonly op: "media.element.create";
  readonly tag: "video" | "audio";
  readonly anchorRect: { x: number; y: number; width: number; height: number };
}

// host → addon
interface HostMediaElementCreated {
  readonly kind: "senn.addon.v1";
  readonly op: "media.element.created";
  readonly elementHandle: string;
}

// host → addon: track lifecycle and metadata.
interface HostMediaTrackEvent {
  readonly kind: "senn.addon.v1";
  readonly op: "media.track";
  readonly elementHandle: string;
  readonly state: "added" | "removed" | "muted" | "unmuted";
}
interface HostMediaLevelEvent {
  readonly kind: "senn.addon.v1";
  readonly op: "media.level";
  readonly direction: "local" | "remote";
  readonly track: "audio" | "video";
  readonly level: number; // [0,1]
}

// host → addon: standard error op (existing).
interface HostError {
  readonly kind: "senn.addon.v1";
  readonly op: "error";
  readonly code:
    | "permission-denied"
    | "device-unavailable"
    | "user-denied"
    | "not-connected"
    | "bad-handle";
  readonly message: string;
}
```

## SDK surface

```ts
interface SennAddonMedia {
  /** Mount a host-rendered <video> or <audio> at the given iframe rect. */
  createElement(opts: {
    tag: "video" | "audio";
    anchorRect: { x: number; y: number; width: number; height: number };
  }): Promise<{ handle: string }>;

  /** Render the remote stream into a previously-created element. */
  attachRemoteAudio(handle: string): Promise<{ unsubscribe: () => void }>;
  attachRemoteVideo(handle: string): Promise<{ unsubscribe: () => void }>;

  /** Start / stop transmitting the local microphone or camera. */
  startLocalAudio(): Promise<{ stop: () => void }>;
  startLocalVideo(opts?: { source?: "camera" | "display" }): Promise<{ stop: () => void }>;

  /** Subscribe to level updates (same [0,1] semantics as audio.level). */
  onLevel(handler: (e: { direction: "local" | "remote"; track: "audio" | "video"; level: number }) => void): () => void;

  /** Subscribe to track lifecycle on a specific element handle. */
  onTrack(handle: string, handler: (state: "added" | "removed" | "muted" | "unmuted") => void): () => void;
}
```

## Normative checklist

- The host MUST refuse `media.send.audio.start` from an addon
  without `media.send.audio` (mirror for video).
- The host MUST refuse `media.receive.{audio,video}.subscribe`
  from an addon without the matching `media.receive.*`.
- The host MUST NOT expose any `MediaStream`, `MediaStreamTrack`,
  `MediaRecorder`, or `MediaSource` reference across the bridge.
- The host MUST resolve `elementHandle` strings through an internal
  registry that maps to *host-page* DOM elements (positioned over
  the addon iframe via the supplied `anchorRect`). The handle
  string MUST NOT be guessable by content (random ≥ 96 bits is
  recommended).
- The host MUST clean up element handles when the addon iframe
  unloads or `AddonHost.close()` runs.
- The host MUST call `getUserMedia` / `getDisplayMedia` only in
  response to a fresh user gesture inside the host page (not the
  iframe). The host SHOULD make this gesture explicit in its UI
  (e.g. a "you started mic" banner).
- The host MUST stop all local tracks on
  `media.send.*.stop`, on the addon's `close`, or when PeerSession
  closes.
- Levels MUST be `[0,1]` reals, ≤ 30 Hz, computed by the host.
- The forbidden-API grep MUST extend to `getUserMedia`,
  `getDisplayMedia`, `MediaRecorder`, `MediaSource`,
  `MediaStreamTrack`, and `RTCRtpSender` / `RTCRtpReceiver`.

## Negative examples

- An addon calling `navigator.mediaDevices.getUserMedia(...)` —
  blocked by the audit grep + iframe sandbox feature policy.
- An addon storing the `elementHandle` and trying to reuse it after
  unsubscribe — host refuses with `bad-handle`.
- A host returning an `elementHandle` that exposes the underlying
  DOM node id — non-conformant; the handle MUST be opaque.
- A host that starts capture without a user gesture on the host
  page — non-conformant.
- An addon trying to record incoming audio with a Web Audio
  `AudioWorklet` chain inside the iframe — blocked because the
  raw stream never enters the iframe.

## Conformance

```sh
pnpm --filter @senn/addon-runtime test    # bridge gates + handle registry
pnpm --filter @senn/web e2e               # reference UI (when implemented)
pnpm check:addon-forbidden                # extended forbidden-API list
```

## Implementation staging

This spec is shippable as-is for review. Implementation is staged:

1. PeerSession track surface (`@senn/core`):
   `addLocalTrack` / `removeLocalTrack`, `track` events, internal
   renegotiation through the existing `SignalingTransport`.
2. AddonHost bridge ops (`@senn/addon-runtime`):
   permission gates, element-handle registry, level pump.
3. SDK surface (`@senn/addon-sdk`).
4. Reference addon `voice-call` showing 1:1 audio.
5. Forbidden-API grep extension.

Each stage lands as its own PR with its own test coverage.

## Cross-references

- [ADR-0015 — Cross-peer media tracks](adr/0015-media-tracks.md)
- [addon-audio-level-spec.md](addon-audio-level-spec.md)
- [addon-runtime-spec.md](addon-runtime-spec.md)
- [peer-session-spec.md](peer-session-spec.md)
- [security-model.md](security-model.md)
- [Charter](charter.md)
