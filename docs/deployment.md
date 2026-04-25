# SENN Deployment

SENN is designed so that **all dynamic data flows directly between peers**.
Servers only ever distribute static files and, in some configurations, relay
the small SDP/ICE bootstrap exchange. This means SENN can be deployed across
a wide range of infrastructure, from a single shared rental host up to a
self-operated stack.

This page describes three reference deployment tiers. Each tier is fully
sufficient for SENN to work; you pick the one that matches your operational
constraints. None of the tiers requires a specific vendor, and SENN does not
ship a hosted default. (See [ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md).)

## Tier 0 — Zero infrastructure (URL/QR signaling)

```
[Static hosting]                             ← any static file server
   • SENN web app
   • Static add-ons + manifests

[Browser A] — invite URL / QR — [Browser B]
        ⇄ WebRTC P2P (direct or STUN-assisted)
```

What you operate:

- A static file host (Apache / Nginx / shared rental / `python -m http.server` / object storage with web access). HTTPS is required.

What you don't operate:

- No signaling server. The SDP/ICE handshake is encoded into the invite URL or
  QR code, exchanged out-of-band (chat, email, in-person), and unrolled in the
  receiving browser.
- No TURN. Direct P2P only. May fail under symmetric NAT.

Use this tier for: demos, classroom or workshop sessions, single-event use,
embedded "join this room" QR posters, fully offline LAN scenarios.

## Tier 1 — Shared rental hosting + short-lived KV

```
[Shared rental host]                         ← LAMP / static + tiny PHP / Node CGI
   • SENN web app
   • Static add-ons + manifests
   • signal.php (or equivalent)              ← stores 1 small JSON for ≤ 30s
                ▲ HTTPS PUT/GET
[Browser A] ⇄ short-poll signaling ⇄ [Browser B]
        ⇄ WebRTC P2P (direct or STUN)
```

What you operate:

- A static host (same as Tier 0).
- A tiny endpoint that stores a JSON blob keyed by room id for a short TTL
  (≤ 60 seconds is plenty). A reference implementation in PHP or Node is
  ~30 lines and runs anywhere your hoster offers a single dynamic handler.
- A public STUN server URL in the host app config. Public STUN is fine; STUN
  carries no message data.

What you don't operate:

- No long-lived process. The signaling endpoint serves request/response only.
- No TURN. Add it via Tier 2 if your audience hits restrictive NATs.

Use this tier for: small communities, school clubs, hobby projects, event
sites — anything that already has a shared rental host.

## Tier 2 — Self-hosted realtime signaling and TURN

```
[Static host or CDN]                         ← unchanged
   • SENN web app
   • Static add-ons + manifests

[Signaling server]                           ← WebSocket or SSE; any commodity runtime
[TURN server]                                ← coturn or equivalent on a single VM

[Browser A] ⇄ realtime signaling ⇄ [Browser B]
        ⇄ WebRTC P2P (relayed only when direct fails)
```

What you operate:

- Static host.
- A WebSocket signaling adapter (the SENN reference implementation runs as
  a single Node process or any equivalent runtime that accepts WS upgrades).
- A TURN server (coturn is the conventional open-source choice). One VM is
  usually enough for thousands of concurrent users.

Use this tier for: sustained services, enterprise-internal SENN deployments,
events where guaranteed connectivity matters.

## Static hosting requirements (all tiers)

- HTTPS is mandatory. WebRTC, the Web Crypto API, and Service Workers refuse
  to run on plain HTTP.
- Correct MIME types: `application/javascript` for `.js` and `.mjs`,
  `application/wasm` for `.wasm`, `application/json` for `.json`.
- Recommended response headers (Apache `.htaccess` example):

  ```apache
  <IfModule mod_mime.c>
    AddType application/javascript .js .mjs
    AddType application/wasm .wasm
  </IfModule>

  <IfModule mod_headers.c>
    Header set Cross-Origin-Opener-Policy "same-origin"
    Header set Cross-Origin-Embedder-Policy "require-corp"
    Header set Referrer-Policy "no-referrer"
  </IfModule>
  ```

- If the SENN web app uses client-side routing, point the 404 fallback at
  `index.html` (`FallbackResource /index.html` on Apache, `try_files $uri /index.html;` on Nginx).

## Choosing an adapter

Adapters are selected by the host application, not by Core. See
[`docs/dev/signaling-adapter.md`](dev/signaling-adapter.md) for the contract
(`SignalingTransport` in `@senn/protocol`) and reference implementations.

A typical host app passes:

```ts
import { createCore } from "@senn/core";
import { UrlFragmentSignaling } from "@senn/signaling-url-fragment";

const core = createCore({
  signaling: new UrlFragmentSignaling(),
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
});
```

Swap the adapter (and optionally the STUN/TURN list) to move between tiers
without changing add-on or Core code.

## What SENN does **not** ship

- No hosted signaling endpoint.
- No hosted TURN.
- No vendor-bound default (no Cloudflare, Firebase, Twilio, AWS, etc. in
  Core or in the manifest spec).

If a future ADR opts in to running a project-operated reference instance, it
will be opt-in and clearly labelled as such.
