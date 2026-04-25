# Signaling Adapter Guide

## Intent

Implement a signaling backend for SENN. The contract is the
`SignalingTransport` interface in `@senn/protocol`. Any implementation that
satisfies the contract is a valid adapter; SENN does not privilege any
particular vendor or protocol. (See [ADR-0007](../adr/0007-vendor-neutral-signaling-and-relay.md)
and [/docs/deployment.md](../deployment.md).)

## The contract (normative)

```ts
import type {
  RoomId,
  SignalingHandler,
  SignalingMessage,
  SignalingTransport,
  Unsubscribe,
} from "@senn/protocol";

export class MySignaling implements SignalingTransport {
  publish(roomId: RoomId, message: SignalingMessage): Promise<void> { /* ... */ }
  subscribe(roomId: RoomId, handler: SignalingHandler): Unsubscribe { /* ... */ }
  close(): Promise<void> { /* ... */ }
}
```

Required behavior:

| Method | MUST |
|--------|------|
| `publish` | Resolve only after the message is durably handed to the underlying transport. Reject with `Error` on failure. |
| `subscribe` | Invoke the handler at-least-once for each distinct delivered message. Catch handler exceptions; never let them crash the adapter. Return an idempotent `Unsubscribe`. |
| `close` | Release every resource (sockets, polling timers, AbortControllers). Subsequent calls MUST be no-ops. |

Non-functional requirements:

- Adapters MUST NOT log message bodies.
- Adapters MUST NOT persist messages beyond what the transport itself does.
- Adapters MUST treat `RoomId` as opaque. No parsing, no padding, no
  trimming.

## Reference adapters (planned)

| Adapter | Package | Tier | Status |
|---------|--------|------|--------|
| URL fragment | `@senn/signaling-url-fragment` | Tier 0 | shipped (see [/docs/signaling-url-fragment-spec.md](../signaling-url-fragment-spec.md)) |
| HTTP short-poll | `@senn/signaling-http-poll` | Tier 1 | shipped (see [/docs/signaling-http-poll-spec.md](../signaling-http-poll-spec.md)) |
| WebSocket | `@senn/signaling-ws` (planned) | Tier 2 | not started |
| Nostr relay | `@senn/signaling-nostr` (proposed) | optional | needs ADR |
| Matrix room | `@senn/signaling-matrix` (proposed) | optional | needs ADR |

Until these packages are published, host applications can ship their own
adapter that satisfies the interface. See the cookbook below.

## Cookbook

### URL fragment (no infrastructure)

```ts
export class UrlFragmentSignaling implements SignalingTransport {
  // The "offer" is encoded into the invite URL fragment by the inviter.
  // The "answer" comes back via whatever channel the user already uses
  // (chat, mail, in-person QR). The adapter is effectively a local
  // EventTarget plus a clipboard helper.
  ...
}
```

Use when: one-shot invites, posters, demos, classrooms, fully offline LAN.

### HTTP short-poll (shared rental hosting)

```ts
export class HttpPollSignaling implements SignalingTransport {
  constructor(private endpoint: string, private intervalMs = 1000) {}

  publish(roomId, message) {
    return fetch(`${this.endpoint}/${roomId}`, {
      method: "PUT",
      body: JSON.stringify(message),
    }).then(r => { if (!r.ok) throw new Error(`signaling publish ${r.status}`); });
  }

  subscribe(roomId, handler) {
    let stopped = false;
    const tick = async () => {
      while (!stopped) {
        try {
          const r = await fetch(`${this.endpoint}/${roomId}?since=${this.cursor}`);
          if (r.ok) {
            const msgs = await r.json();
            for (const m of msgs) handler(m);
            this.cursor = r.headers.get("x-cursor") ?? this.cursor;
          }
        } catch { /* swallow + back off */ }
        await new Promise(res => setTimeout(res, this.intervalMs));
      }
    };
    tick();
    return () => { stopped = true; };
  }

  async close() { /* nothing persistent */ }
}
```

Server side: ~30 lines. Any language. Stores one JSON blob keyed by room
id with a short TTL (≤ 60 seconds). Reference snippets for PHP, Node, and
Python will live alongside the adapter package once it ships.

### WebSocket (self-hosted realtime)

```ts
export class WebSocketSignaling implements SignalingTransport {
  constructor(private url: string) {}
  // Standard WS reconnect loop, JSON encode/decode, per-room channel.
  // No vendor specifics. Any commodity runtime that accepts WS upgrades works.
}
```

## Choosing an adapter at the host app layer

```ts
import { createCore } from "@senn/core";
import { UrlFragmentSignaling } from "./signaling/url-fragment.ts";

const core = createCore({
  signaling: new UrlFragmentSignaling(),
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
});
```

The Core constructor MUST NOT default to any specific signaling backend.
Host apps make the choice; tests pass an in-memory adapter.

## Conformance

Every adapter in this repo MUST come with:

1. A short README explaining intent, infra requirements, failure modes.
2. A test that spins two adapter instances against an in-memory transport,
   exchanges an offer/answer/ICE/bye sequence, and asserts ordering and
   isolation between rooms.
3. A note in [/docs/deployment.md](../deployment.md) under the relevant tier.

## Negative example

Do **not** ship an adapter that opens a connection to a hard-coded vendor
URL on `import`. Adapters MUST take their endpoint via constructor, and
SENN Core MUST be runnable with the URL-fragment adapter alone.
