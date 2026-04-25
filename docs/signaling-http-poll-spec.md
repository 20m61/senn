# HTTP-Poll Signaling Adapter Specification

## Intent

Define a Tier-1 SENN signaling adapter — a `SignalingTransport` whose
carrier is a tiny HTTP endpoint that briefly stores a list of opaque
JSON messages per room. The endpoint can be implemented in ~30 lines of
PHP, Node, Python, Go, or any other language that any commodity shared
hosting plan supports. This page is normative.

The adapter exists so that small communities, school clubs, and event
sites that already have a shared rental host can run SENN without
deploying a long-lived process. It satisfies the same `SignalingTransport`
contract as the URL-fragment adapter; SENN Core sees no difference.

## Normative checklist

- An adapter implementing this spec MUST satisfy `SignalingTransport`
  in `@senn/protocol` (`publish`, `subscribe`, `close`).
- The adapter MUST take its endpoint URL via the constructor. It MUST
  NOT embed any vendor URL.
- The adapter MUST NOT log message bodies.
- The adapter MUST NOT persist messages locally.
- `publish(roomId, message)` MUST send `POST <endpoint>/<roomId>` with a
  JSON body matching `{ message: SignalingMessage }`. It MUST resolve
  only after a 2xx response.
- `subscribe(roomId, handler)` MUST start a polling loop that calls
  `GET <endpoint>/<roomId>?since=<cursor>`. The loop MUST honour the
  configured interval (default 1000 ms; range [200 ms, 60 000 ms]).
- The cursor MUST be opaque to the adapter — the adapter MUST round-trip
  whatever cursor the server returned in the response without parsing.
- The adapter MUST coalesce duplicate deliveries — if a message id has
  already been delivered to a room's handlers, it MUST NOT be delivered
  again.
- `close()` MUST stop all polling loops, abort any in-flight fetch via
  `AbortController`, and reject any subsequent call. `close()` MUST be
  idempotent.
- The adapter MUST NOT depend on long-lived sockets. It MUST work
  against an endpoint that only handles single request/response cycles.

## Endpoint contract (server-side)

The endpoint is a simple key/value queue keyed by `roomId` with a TTL.

### `POST <endpoint>/<roomId>`

Request body:

```json
{ "message": { "kind": "offer", "from": "01jrm…", "sdp": "v=0\r\n…" } }
```

Response:

```json
{ "id": "01k0…", "cursor": "01k0…" }
```

- `id` is the server-assigned message id (ULID recommended).
- `cursor` is the new high-water mark for the room.
- The endpoint MUST validate that `message.kind` is one of
  `offer | answer | ice | bye`. Other shapes MUST be rejected with 400.
- The endpoint MAY apply a per-room rate limit; on rate-limit it MUST
  return 429.
- The endpoint MUST NOT persist messages longer than 60 seconds.

### `GET <endpoint>/<roomId>?since=<cursor>`

Response:

```json
{
  "messages": [
    { "id": "01k0…", "message": { "kind": "offer", "from": "01jrm…", "sdp": "v=0\r\n…" } }
  ],
  "cursor": "01k1…"
}
```

- `since` MAY be omitted by the client on the first poll.
- The endpoint MUST return only messages strictly newer than `since`.
- An empty room or a room past TTL MUST return `{ messages: [], cursor: <since or "0"> }`.
- The endpoint SHOULD use long-poll semantics (block up to a few seconds
  for new messages); short-poll is acceptable.

### CORS

- For browser clients on a different origin, the endpoint MUST set
  `Access-Control-Allow-Origin: *` (or echo the requesting origin).
- The endpoint MUST set `Cache-Control: no-store`.

## Reference endpoints (informative)

A reference PHP implementation that fits in ~40 lines using the
filesystem as a TTL cache, and a Node implementation using an in-memory
Map, will live under `examples/signaling-http-poll-server/`. They are
optional; any compliant server works.

## Wire example

Inviter publishes an offer:

```http
POST /signaling/01jrmcv3p4n8e7y9w0q5t2k1h6 HTTP/1.1
Content-Type: application/json

{"message":{"kind":"offer","from":"01jrmcv3p4abcdefghjkmnpqrs","sdp":"v=0\r\n…"}}

HTTP/1.1 200 OK
Content-Type: application/json

{"id":"01k0...","cursor":"01k0..."}
```

Joiner polls:

```http
GET /signaling/01jrmcv3p4n8e7y9w0q5t2k1h6?since=0 HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{"messages":[{"id":"01k0...","message":{"kind":"offer", … }}],"cursor":"01k0..."}
```

## Negative examples

- Adapter that defaults to `https://senn-signal.example.com/...` if no
  endpoint is configured — **rejected**, no vendor lock-in.
- Adapter that re-delivers a message because the server returned the
  same `id` twice — **rejected**, the adapter MUST de-duplicate.
- Adapter that polls every 50 ms — **rejected**, interval MUST be
  ≥ 200 ms.
- Endpoint that returns the entire history forever — **rejected**, TTL
  ≤ 60 s.

## Conformance

```sh
pnpm --filter @senn/signaling-http-poll test
```

The vitest suite drives two adapter instances against an in-memory
mock endpoint and exercises:

- Offer/answer/ICE/bye round-trip.
- Cursor advances; the second poll receives only new messages.
- Cross-room isolation.
- `close()` aborts the polling loop and rejects subsequent calls.
- Server 4xx / 5xx responses surface as `Error` from `publish`.
- The adapter does not embed any default endpoint URL.

## Cross-references

- [ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md)
- [signaling-url-fragment-spec.md](signaling-url-fragment-spec.md)
- [/docs/deployment.md](deployment.md) — Tier 1 description.
