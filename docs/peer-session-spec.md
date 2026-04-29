# Peer Session Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Intent

Define how SENN Core establishes a real-time peer-to-peer connection on top
of any conformant `SignalingTransport` adapter. A `PeerSession` is the
runtime object the host application uses for one logical connection from
this peer to one remote peer in one room. This page is normative.

## Normative checklist

- A `PeerSession` MUST take a `SignalingTransport` instance as a constructor
  dependency. It MUST NOT pick a transport itself.
- A `PeerSession` MUST take an `RTCConfiguration` for ICE servers from the
  host application. It MUST NOT embed any default STUN or TURN URL.
- The session MUST use `RTCPeerConnection` and `RTCDataChannel`. Other
  transports are out of scope until a future ADR opens them.
- The DataChannel labelled `core.text` MUST be created by the **inviter**
  (the peer that produced the SDP offer). The DataChannel labelled
  `core.text` MUST be reachable from the joiner via `pc.ondatachannel`.
- Outgoing payloads on `core.text` MUST be UTF-8 strings ≤ 64 KiB.
- A second DataChannel labelled `core.bin` MUST be created by the
  inviter alongside `core.text`. It MUST be configured
  `{ ordered: true }` with default reliability. The text channel MUST
  NOT carry binary frames; the binary channel MUST NOT carry text
  frames (ADR-0011).
- A logical binary message sent via `sendBinary(...)` MUST be ≤ **4 MiB**
  (ADR-0012). Each wire frame on `core.bin` MUST be ≤ **64 KiB**
  (ADR-0011); the session MUST chunk transparently for messages larger
  than one frame and MUST emit one `binary` event per fully reassembled
  logical message.
- The receiver-side reassembly buffer MUST be bounded at **16 MiB**
  in-flight per peer; messages exceeding the bound MUST be dropped
  with a session-level error. Reassembly state for an in-flight message
  MUST time out after **60 s** since the first frame.
- The session MUST emit a typed event stream:
  - `state` — one of `idle`, `connecting`, `connected`, `closed`, `failed`.
  - `text` — a UTF-8 message received from the peer.
  - `binary` — a fully reassembled binary message
    (`{ addon, mime, bytes }`) received from the peer.
  - `remote-track` — a remote audio or video track was added by the
    peer (`{ kind, track, streams }`); `kind` is `"audio" | "video"`.
  - `remote-track-ended` — a previously announced remote track has
    ended (`{ kind, track }`).
  - `error` — a connection-level error.
- The session MAY accept media tracks via `addLocalTrack(...)` once it
  is `connecting` or `connected`. Renegotiation MUST ride the
  perfect-negotiation pattern through the existing
  `SignalingTransport` — no separate signaling channel is opened for
  media. The session MUST NOT call `getUserMedia` /
  `getDisplayMedia` itself; capture is host-owned (ADR-0015).
- The session MUST NOT log binary payload bodies, MUST NOT log media
  track content, and MUST NOT expose any host-supplied
  `MediaStreamTrack` reference back to the host through any channel
  other than the explicit `remote-track` / `remote-track-ended`
  events.
- The session MUST close cleanly:
  - `close()` MUST publish a `bye` signaling message before tearing down.
  - `close()` MUST stop the peer connection, close the DataChannel, and
    release the signaling subscription.
  - `close()` MUST be idempotent.
- The session MUST NOT log message bodies.
- The session MUST validate every received signaling message against
  `@senn/protocol` types before acting on it. Unexpected `from` peer IDs
  MUST be ignored.

## Roles

- **Inviter** — creates the offer and the DataChannel; produces the
  initial invite/bundle URL.
- **Joiner** — consumes the invite, accepts the offer, produces the
  answer.

A `PeerSession` knows its role at construction time; it does not switch
roles mid-session.

## Lifecycle

```
idle ── start() ──▶ connecting ──▶ connected ──▶ closed
                       │
                       └────────▶ failed
```

- `start()` is the only legal transition out of `idle`.
- `connected` is reached only after the `core.text` DataChannel emits
  `open` on both sides.
- `failed` is terminal; the host MUST construct a new session to retry.

## Wire shape (informative)

The session uses the existing `SignalingMessage` envelope from
`@senn/protocol`:

```ts
type SignalingMessage =
  | { kind: "offer";  from: PeerId;            sdp: string }
  | { kind: "answer"; from: PeerId; to: PeerId; sdp: string }
  | { kind: "ice";    from: PeerId; to: PeerId; candidate: RTCIceCandidateInit }
  | { kind: "bye";    from: PeerId };
```

ICE candidates MUST be sent as `kind: "ice"` messages. End-of-candidates
(null candidate) MAY be omitted; receivers MUST tolerate its absence.

## API (TypeScript signature)

```ts
import type {
  PeerId,
  RoomId,
  SignalingTransport,
} from "@senn/protocol";

export type PeerSessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "failed";

export interface PeerSessionBinaryMessage {
  /** Routing key (e.g. addon id). Used by AddonHost to demux per-addon. */
  readonly addon: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export interface PeerSessionRemoteTrack {
  readonly kind: "audio" | "video";
  readonly track: MediaStreamTrack;
  readonly streams: ReadonlyArray<MediaStream>;
}

export interface PeerSessionLocalSender {
  readonly senderId: string;
  readonly kind: "audio" | "video";
  /** Idempotent. Removes the track from the peer connection and rides
   *  the existing perfect-negotiation flow. */
  remove(): Promise<void>;
}

export interface PeerSessionEvents {
  state: PeerSessionState;
  text: string;
  binary: PeerSessionBinaryMessage;
  "remote-track": PeerSessionRemoteTrack;
  "remote-track-ended": { kind: "audio" | "video"; track: MediaStreamTrack };
  error: Error;
}

export interface PeerSessionOptions {
  readonly role: "inviter" | "joiner";
  readonly roomId: RoomId;
  readonly localPeerId: PeerId;
  readonly remotePeerId: PeerId | null; // joiner: known from invite; inviter: null until answer
  readonly signaling: SignalingTransport;
  readonly rtcConfig: RTCConfiguration;
}

export class PeerSession {
  constructor(opts: PeerSessionOptions);
  on<K extends keyof PeerSessionEvents>(
    event: K,
    handler: (value: PeerSessionEvents[K]) => void,
  ): () => void;
  start(): Promise<void>;
  sendText(message: string): Promise<void>;
  /** Send a logical binary message (≤ 4 MiB) on `core.bin`. The session
   *  chunks transparently into ≤ 64 KiB wire frames; receivers see one
   *  `binary` event per logical message. */
  sendBinary(message: PeerSessionBinaryMessage): Promise<void>;
  /** Attach a host-owned audio or video track to the peer connection.
   *  The host owns the track lifetime; PeerSession surfaces a
   *  SENN-shaped handle. Renegotiation rides the existing
   *  `SignalingTransport` via perfect negotiation. */
  addLocalTrack(
    track: MediaStreamTrack,
    stream?: MediaStream,
  ): Promise<PeerSessionLocalSender>;
  close(): Promise<void>;
  readonly state: PeerSessionState;
}
```

## Positive example (informative)

```ts
const session = new PeerSession({
  role: "inviter",
  roomId,
  localPeerId,
  remotePeerId: null,
  signaling,
  rtcConfig: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
});

session.on("text", (msg) => render(msg));
session.on("state", (s) => statusBar.textContent = s);

await session.start();
// inviter exports its outbox via the URL-fragment adapter to the joiner.
// once both sides are connected:
await session.sendText("hello from inviter");
```

## Negative example

A session that:

- Constructs `RTCPeerConnection({ iceServers: [{ urls: "stun:vendor.example" }] })`
  internally — **rejected**, ICE servers are host-supplied.
- Skips `pc.close()` on `bye` — **rejected**, `close()` MUST tear down
  the connection.
- Reads or logs `text` payloads — **rejected**, payloads are user data.
- Routes binary frames through `core.text` (or text frames through
  `core.bin`) — **rejected**, the channels are split per ADR-0011.
- Calls `sendBinary` with a 5 MiB body — **rejected**, exceeds the
  4 MiB per-message cap (ADR-0012).
- Calls `navigator.mediaDevices.getUserMedia(...)` from inside the
  PeerSession — **rejected**, capture is host-owned (ADR-0015).

## Conformance

```sh
pnpm --filter @senn/core test    # Vitest — spec checklist against fakes
pnpm --filter @senn/web e2e      # Playwright drives a real RTCPeerConnection round-trip
```

Two harnesses, by design:

- **Vitest (`packages/core/test/peer-session.test.ts`)** asserts every
  normative MUST in this spec — DataChannel labels, state-machine
  transitions, `sendText` bounds, idempotent `close`, signaling
  validation (`from`/`to` filtering), peer-initiated `bye` — against
  in-process fakes. Cheap, deterministic, runs in
  `pnpm conformance`.
- **Playwright e2e** drives the same flows against a real
  `RTCPeerConnection` in three browsers, catching browser-stack
  regressions the fakes cannot model. Slow (~25 min per browser);
  on-demand only.

The two together are the conformance harness for `PeerSession`; both
MUST stay green before a PR merges to `develop`.

## Cross-references

- [ADR-0004](adr/0004-p2p-transport-strategy.md) — WebRTC primary transport.
- [ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md) — pluggable signaling.
- [ADR-0011](adr/0011-binary-peer-transfer.md) — `core.bin` channel and the 64 KiB single-frame baseline.
- [ADR-0012](adr/0012-chunked-binary-peer-transfer.md) — 4 MiB per-message cap, transparent chunking, and the reassembly bounds.
- [ADR-0015](adr/0015-media-tracks.md) — host-captured media tracks, perfect-negotiation pattern, host-only `getUserMedia` / `getDisplayMedia`.
- [room-and-invite-spec.md](room-and-invite-spec.md) — Room/PeerId formats.
- [signaling-url-fragment-spec.md](signaling-url-fragment-spec.md) — Tier-0 carrier.
- [addon-binary-transfer-spec.md](addon-binary-transfer-spec.md) — add-on-facing wire of `sendBinary` / `binary`.
- [addon-media-spec.md](addon-media-spec.md) — add-on-facing wire of `addLocalTrack` / `remote-track*`.
