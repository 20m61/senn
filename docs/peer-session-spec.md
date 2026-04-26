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
- The session MUST emit a typed event stream:
  - `state` — one of `idle`, `connecting`, `connected`, `closed`, `failed`.
  - `text` — a UTF-8 message received from the peer.
  - `error` — a connection-level error.
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

export interface PeerSessionEvents {
  state: PeerSessionState;
  text: string;
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
- [room-and-invite-spec.md](room-and-invite-spec.md) — Room/PeerId formats.
- [signaling-url-fragment-spec.md](signaling-url-fragment-spec.md) — Tier-0 carrier.
