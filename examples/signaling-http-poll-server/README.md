# SENN HTTP-poll signaling — reference servers

Two minimal reference implementations of the endpoint defined in
[`/docs/signaling-http-poll-spec.md`](../../docs/signaling-http-poll-spec.md).

Either one is sufficient to run a Tier-1 SENN deployment against a
shared rental host or a single small VM. SENN does not operate any of
these endpoints itself.

| Implementation | When to pick it |
|----------------|-----------------|
| [`php/signal.php`](php/signal.php) | A typical shared rental host. PHP, the filesystem, `<some>/data/` writable. ~50 lines. |
| [`node/server.mjs`](node/server.mjs) | Self-hosted on any commodity Node runtime. ~70 lines. In-memory; restart wipes state. |

Both implement the wire contract from
[`signaling-http-poll-spec.md`](../../docs/signaling-http-poll-spec.md):

- `POST /<roomId>` with `{ "message": SignalingMessage }` → `{ id, cursor }`
- `GET  /<roomId>?since=<cursor>` → `{ messages: [{ id, message }], cursor }`
- TTL ≤ 60 s
- `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`

## Choosing an implementation

- The PHP reference uses the filesystem as a TTL queue. Every shared
  hosting plan we have looked at can run it as-is. Drop `signal.php`
  into your `public_html` and point `HttpPollSignaling`
  `endpoint: 'https://your-host/signal.php?room='`.
- The Node reference is a single self-contained `.mjs` file using only
  Node 22+ standard library. It is also what the adapter's integration
  test boots in-process to verify the real wire behaviour.

## Running the Node reference

```sh
node examples/signaling-http-poll-server/node/server.mjs --port 8787
# Endpoint: http://localhost:8787/signal/<roomId>
```

## Verifying with curl

```sh
ROOM=01jrmcv3p4n8e7y9w0q5t2k1h6
curl -sS -X POST -H content-type:application/json \
  -d '{"message":{"kind":"offer","from":"01jrmcv3p4abcdefghjkmnpqrs","sdp":"v=0\r\n"}}' \
  http://localhost:8787/signal/$ROOM
curl -sS http://localhost:8787/signal/$ROOM
```

## What these references intentionally do not provide

- Authentication / room ACLs.
- Persistence across server restarts.
- Long-poll (both implementations are short-poll only).
- Rate limiting beyond a soft per-room TTL.

For production use, fork either reference and add what your operating
context requires. The wire contract is the contract; everything else is
operator policy.
