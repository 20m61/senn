# SENN Deployment

SENN is designed so that **all dynamic data flows directly between peers**.
Servers only ever distribute static files and, in some configurations, relay
the small SDP/ICE bootstrap exchange. This means SENN can be deployed across
a wide range of infrastructure, from a single shared rental host up to a
self-operated stack.

This page describes the reference deployment tiers. Each tier is fully
sufficient for SENN to work; you pick the one that matches your operational
constraints. None of the tiers requires a specific vendor, and SENN does not
ship a hosted default. (See [ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md).)

### Tier numbering

The tier numbering on this page mirrors
[ADR-0013 §"Tier numbering used in this repo"](adr/0013-tier-2-turn.md):

| Tier | Layer | Examples |
|------|-------|----------|
| **Tier 0** | Out-of-band signaling | URL fragment, QR code |
| **Tier 1** | Online signaling (operator-run endpoint) | HTTP poll, WebSocket |
| **Tier 2** | Media/data relay (TURN) | coturn or equivalent |

Tier 2 is **layered on top of any Tier 0 or Tier 1 signaling choice**:
TURN does not replace signaling, and a deployer MAY mix any signaling
tier with or without Tier 2. The sections below describe each tier
independently; pick one signaling tier and decide on Tier 2
separately.

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

## Tier 1 — Online signaling

Tier 1 covers any deployment where peers reach a third-party endpoint
to exchange the SDP/ICE bootstrap. The endpoint operator sees session
metadata (see [security-model.md §Threats vs. signaling / TURN
operators](security-model.md#threats-vs-signaling--turn-operators))
but never message content. Tier 1 splits into two operational
profiles by long-running-ness of the endpoint.

### Tier 1-A — Shared rental hosting + short-lived KV (HTTP poll)

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
- No TURN. Layer Tier 2 on top if your audience hits restrictive NATs.

Use this profile for: small communities, school clubs, hobby projects,
event sites — anything that already has a shared rental host.

### Tier 1-B — Long-lived realtime signaling (WebSocket / SSE)

```
[Static host or CDN]                         ← unchanged
   • SENN web app
   • Static add-ons + manifests

[Signaling server]                           ← WebSocket or SSE; any commodity runtime

[Browser A] ⇄ realtime signaling ⇄ [Browser B]
        ⇄ WebRTC P2P (direct or STUN)
```

What you operate:

- Static host.
- A WebSocket / SSE signaling adapter (the SENN reference
  implementation runs as a single Node process or any equivalent
  runtime that accepts WS upgrades).
- A public STUN server URL in the host app config.

What you don't operate:

- No TURN. Layer Tier 2 on top if your audience hits restrictive NATs.

Use this profile for: sustained services, enterprise-internal SENN
deployments, anywhere a long-lived process is operationally
acceptable. Realtime signaling reduces handshake latency relative to
polling but does not change the metadata exposure surface.

## Tier 2 — Media/data relay (TURN)

Tier 2 layers on top of any Tier 0 or Tier 1 signaling choice. It is
**not a replacement for Tier 1**: the SDP/ICE exchange still rides the
chosen signaling tier, and the TURN allocation only carries
WebRTC-encrypted bytes when direct P2P fails. See
[ADR-0013](adr/0013-tier-2-turn.md) and
[turn-deployment.md](turn-deployment.md) for the full deployment
runbook; the operational picture is:

```
[Static host or CDN]                         ← serves the SENN web app
[Signaling tier]                             ← Tier 0, 1-A, or 1-B (any)
[TURN server]                                ← coturn or equivalent on a single VM

[Browser A] ⇄ signaling exchange ⇄ [Browser B]
        ⇄ WebRTC P2P (direct, or relayed via TURN when direct fails)
```

What you operate (in addition to your chosen signaling tier):

- A TURN server (coturn is the conventional open-source choice). One
  VM is usually enough for thousands of concurrent users.
- Per-session TURN credentials with short expiry (ADR-0013 §3); SENN
  does not require any specific credential issuance scheme but the
  TURN URL list passed to the host app SHOULD rotate per session.

What you don't operate:

- No project-default TURN service is provided; SENN's contract is the
  STUN/TURN URL list the host app passes to PeerSession via
  `RTCConfiguration.iceServers`.

Use Tier 2 alongside Tier 1 for: sustained services and enterprise-
internal deployments where guaranteed connectivity through restrictive
NATs matters. Use Tier 2 alongside Tier 0 only when out-of-band
signaling has already happened and a relay is the only thing missing
(uncommon in practice).

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

## Embedding into existing sites (WordPress / static CMS)

SENN's web app is just a static deployment, so any site that can drop an
iframe can host a SENN room. For WordPress in particular,
[`examples/wordpress-plugin/senn-room`](../examples/wordpress-plugin/senn-room)
ships a tiny shortcode plugin (~80 LOC) that embeds a deployed SENN app
into any post. The plugin proxies nothing — the iframe talks WebRTC
directly to the other peer. Configure the embed with:

```
[senn-room app="https://senn.example.com/"]
```

See [`examples/wordpress-plugin/README.md`](../examples/wordpress-plugin/README.md)
for the iframe sandbox flags and security notes.

## What SENN does **not** ship

- No hosted signaling endpoint.
- No hosted TURN.
- No vendor-bound default (no Cloudflare, Firebase, Twilio, AWS, etc. in
  Core or in the manifest spec).

If a future ADR opts in to running a project-operated reference instance, it
will be opt-in and clearly labelled as such.
