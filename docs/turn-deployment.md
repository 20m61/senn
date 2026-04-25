# TURN deployment guide

## Intent

A practical, vendor-neutral recipe for adding a TURN relay tier to a
SENN deployment. Use this when peers occasionally fail to connect
behind symmetric NATs (corporate networks, mobile carriers, double-NAT
home setups).

The design contract is in [ADR-0013](adr/0013-tier-2-turn.md). This
page is informative — choose any TURN server that speaks RFC 5766;
coturn is shown because it is the most-common open-source option.

## When you need TURN

You probably do **not** need TURN for:

- Local development.
- Demos where both peers are on the same network or one of them is
  on a permissive home network.
- One-off invite flows where users can retry.

You probably do need TURN when:

- A measurable percentage of pairs sit at `connecting` ➜ `failed`
  in PeerSession's state stream.
- Your audience is largely on mobile carriers that do CGNAT.
- Your support traffic is dominated by "we can't connect" reports.

A practical heuristic: enable TURN when ≥ 5 % of sessions fail to
reach `connected` within 30 s.

## coturn quickstart (single VPS)

This is the minimum viable setup. Treat it as a starting point — a
production deployment will add monitoring, firewall hardening, and
log retention policy.

### 1. Provision

A 1 vCPU / 1 GB VPS handles small communities. Bandwidth is the
binding constraint, not CPU. Pick a provider whose egress pricing
you understand. Open these ports:

| Port | Protocol | Purpose |
|------|----------|---------|
| 3478 | UDP + TCP | TURN/STUN |
| 5349 | TCP | TURN over TLS |
| 49152–65535 | UDP | TURN relay range |

### 2. Install coturn

```sh
sudo apt-get install coturn        # Debian/Ubuntu
# or use the official Docker image: instrumentisto/coturn
```

### 3. Generate a shared auth secret

The app server and coturn share a secret. Pick a long random value
and keep it out of git.

```sh
openssl rand -hex 32 > /etc/turnserver.secret
chmod 600 /etc/turnserver.secret
```

### 4. Minimal `/etc/turnserver.conf`

```conf
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=turn.example.com
external-ip=A.B.C.D            # public IP of this VPS
use-auth-secret
static-auth-secret=<contents of /etc/turnserver.secret>
total-quota=200                 # cap concurrent allocations
bps-capacity=0                  # cap bandwidth per session, 0 = unlimited
no-loopback-peers
no-multicast-peers
no-cli                          # disable telnet management interface
syslog
```

For TLS, also set `cert=` and `pkey=` to certificates from Let's
Encrypt. coturn does not auto-renew; pair with `certbot` and a
post-renewal hook that runs `systemctl reload coturn`.

### 5. Start

```sh
sudo systemctl enable --now coturn
sudo journalctl -u coturn -f       # tail logs
```

## Vending ephemeral credentials

Per ADR-0013 §3, hosts MUST mint short-lived credentials. coturn's
`use-auth-secret` mode means the username is a UNIX timestamp and
the password is HMAC-SHA1(secret, username), encoded base64.

```ts
import { createHmac } from "node:crypto";

interface TurnCred {
  username: string;
  credential: string;
  ttlSeconds: number;
  urls: string[];
}

export function mintTurnCred(opts: {
  secret: string;
  realm: string;
  ttlSeconds?: number;
}): TurnCred {
  const ttl = opts.ttlSeconds ?? 60 * 60; // 1 hour default
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${opts.realm}`;
  const credential = createHmac("sha1", opts.secret).update(username).digest("base64");
  return {
    username,
    credential,
    ttlSeconds: ttl,
    urls: [
      `turn:turn.${opts.realm}:3478?transport=udp`,
      `turn:turn.${opts.realm}:3478?transport=tcp`,
      `turns:turn.${opts.realm}:5349?transport=tcp`,
    ],
  };
}
```

Expose this from your existing app backend behind whatever auth
gates the rest of your app. SENN does not include a credential
endpoint — see ADR-0013 §6 for why.

## Plugging into PeerSession

PeerSession already takes `RTCConfiguration` through its constructor.
Fetch credentials, build the config, then construct the session:

```ts
const cred = await fetch("/api/turn-cred").then((r) => r.json()) as TurnCred;

const session = new PeerSession({
  role,
  roomId,
  localPeerId: me,
  remotePeerId,
  signaling,
  rtcConfig: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: cred.urls,
        username: cred.username,
        credential: cred.credential,
      },
    ],
  },
});
```

If the TURN cred endpoint is unreachable, fall back to STUN-only —
ADR-0013 §5 requires the application to keep working with whatever
ICE servers reach.

## What TURN sees, and what it does not

WebRTC media and data channels are end-to-end encrypted (DTLS-SRTP /
DTLS over SCTP). The TURN relay forwards opaque packets. Specifically:

| Visible to TURN | Not visible to TURN |
|----------------|---------------------|
| Both peers' public IP and port | DTLS-protected bytes (text, binary, audio, video) |
| Connection timing (start, end) | RTCDataChannel labels (`core.text`, `core.bin`) |
| Relayed byte counts | Add-on payloads, signed manifests, anything inside the data channel |
| The TURN username (i.e. expiry timestamp) | The signaling SDP/ICE if a different transport (Tier 0/1) is used |

A subpoena to a TURN operator therefore yields connection metadata
but not message content. This MUST be reflected in
[security-model.md](security-model.md) when that page is amended.

## Cost ballparks

Bandwidth is the entire cost. Worst case: **all** of a peer's traffic
relays through TURN. Plan for the upper bound of:

| Workload | Per-pair worst-case |
|----------|---------------------|
| Text chat | a few KB / minute |
| Whiteboard strokes | tens of KB / minute |
| Voice (Opus 24 kbps) | ~ 11 MB / hour each direction |
| Video 360p / 500 kbps | ~ 220 MB / hour each direction |
| Local-vault file transfer | size of the file |

For 95 % of SENN deployments today (text + small files), a $5 VPS
with a few hundred GB of egress is enough.

## Cross-references

- [ADR-0007 — Vendor-neutral signaling and relay](adr/0007-vendor-neutral-signaling-and-relay.md)
- [ADR-0013 — Tier 2 TURN](adr/0013-tier-2-turn.md)
- [peer-session-spec.md](peer-session-spec.md)
- [security-model.md](security-model.md)
