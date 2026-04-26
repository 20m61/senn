# SENN Privacy

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

This page is for **users**, **operators considering deploying SENN**,
and **non-engineers reviewing what SENN does to data**. It is the
plain-language counterpart to the technical
[security-model.md](security-model.md).

Everything below is grounded in the protocol specifications and
ADRs in this repository. If a claim contradicts the code, the code
wins — please open an issue.

## What SENN does, in one paragraph

SENN moves messages between two people's browsers directly, over
WebRTC. The peers' browsers establish a connection through a small
hand-off (URL fragment, QR code, or a tiny short-lived endpoint),
and from then on every byte they exchange — text, files, presence
state, add-on payloads — flows directly between them, end-to-end
encrypted by the browser's WebRTC stack.

SENN does not run a service in the middle. There is no SENN account,
no SENN server, and no SENN database. The project ships software that
operators run on their own infrastructure, and the wire formats those
operators speak are open.

## What SENN never sees

Because there is no project-operated service, the SENN project itself
has no copy of your data. Beyond that, the protocol is designed so
that **even the operators who relay the connection cannot read what
you send**:

| Concern | Visible to whom |
|--------|-----------------|
| Message bodies (text, file bytes, presence, addon payloads) | Only the two peers. End-to-end encrypted via DTLS-SRTP / DTLS-over-SCTP. |
| Add-on storage (local-vault files, whiteboard snapshots) | Only the local browser that wrote them. Never network-replicated. |
| Microphone audio (when `voice-meter`-class addons run) | Only your browser. Add-ons receive a `[0,1]` energy number; raw audio never leaves the host page. |
| Add-on network traffic | None. Add-ons run sandboxed with `connect-src 'none'`. They cannot make their own HTTP calls. |

## What SENN does see (be honest about this)

SENN's privacy story is not "no metadata exists." Establishing a
WebRTC connection requires a tiny exchange of routing info, and
relays in restrictive networks see connection-level metadata. We
state this plainly:

| Operator | What they can observe | What they cannot observe |
|---------|----------------------|--------------------------|
| Signaling (Tier 0 — URL fragment / QR) | Nothing — there is no operator. | Everything. |
| Signaling (Tier 1 — HTTP poll, Nostr, WebSocket) | Room ID, peer IDs, the SDP/ICE handshake itself, the IP address that posted each handshake message, approximate session start time. | Anything sent after the data channel opens. |
| TURN relay (Tier 2, optional) | Both peers' public IPs, session duration, relayed byte counts. | The encrypted bytes themselves; channel labels (`core.text`, `core.bin`); add-on payloads. |

Concretely: a signaling operator subpoenaed for "who connected to
whom from where" can answer; one subpoenaed for "what did they say"
cannot. The rationale is in
[ADR-0007](adr/0007-vendor-neutral-signaling-and-relay.md) and
[ADR-0013](adr/0013-tier-2-turn.md); the threat tables live in
[security-model.md](security-model.md).

## How users stay in control

- **Local-first storage.** Anything an addon stores, it stores in
  *this* browser. There is no remote storage tier.
  ([ADR-0005](adr/0005-local-first-persistence.md))
- **User gestures gate sensitive actions.** Downloading a file,
  picking a file, sending a file across peers — each requires a
  click in the addon UI. No add-on can auto-save, auto-download, or
  silently exfiltrate. ([addon-file-transfer-spec](addon-file-transfer-spec.md))
- **Explicit microphone consent.** The voice-meter flow only runs
  when the user clicks "enable mic for audio.level". The add-on
  receives only a number; the raw stream never leaves the host
  page. ([addon-audio-level-spec](addon-audio-level-spec.md))
- **Per-add-on storage namespacing.** One add-on cannot read or
  modify another add-on's stored data.
  ([addon-storage-spec](addon-storage-spec.md))
- **Opt-out of metadata.** If you do not want any operator on your
  signaling path, use Tier 0 (URL fragment / QR) — no operator
  exists for that tier.

## How a deployment can prove its claims

A deployment that claims to follow SENN's privacy posture should be
auditable from the outside:

- The Core packages are open source (Apache-2.0). A reviewer can
  read the entire P2P path.
- Every official add-on ships a detached Ed25519 signature
  (`manifest.sig.json`) over its byte-for-byte manifest. The
  publisher's public key is pinned in
  [`addons/official/index.json`](../addons/official/index.json).
  ([ADR-0008](adr/0008-manifest-signing.md))
- A `connect-src 'none'` CSP makes it impossible for a sandboxed
  addon to phone home, even when bugs land in it. The CI's
  `pnpm check:addon-forbidden` step also rejects raw network APIs
  inside addon source. ([addon-runtime-spec](addon-runtime-spec.md))
- The WordPress plugin scaffold proxies nothing — the iframe talks
  WebRTC directly between the two visitors' browsers, even when the
  embedding page lives on a CMS.
  ([WordPress plugin scaffold](../examples/wordpress-plugin/README.md))

## What SENN explicitly does NOT promise

Saying things SENN does not do is the other half of being honest:

- **Perfect anonymity.** Your IP address is visible to your direct
  peer (this is unavoidable in WebRTC) and to whatever signaling
  operator you choose. Pair SENN with your own anonymity layer if
  you need one.
- **Hiding connection metadata from a TURN relay.** A relay sees
  *that* you connected and how long, just not *what* you said.
- **Server-side undo.** Once a message reaches the other peer, SENN
  has no way to "unsend" it. The recipient's local copy is the
  recipient's.
- **Safe third-party add-ons by default.** The runtime sandboxes
  any addon, but unsigned community addons are exactly that —
  community. Your host application chooses which publishers'
  `trustedKeys` to trust.

## Where to dig deeper

- [SENN Charter](charter.md) — mission, principles, non-goals.
- [Security Model](security-model.md) — threats and controls in
  technical terms.
- [ADR Index](adr/README.md) — the design decisions that produced
  this posture.
- [Addon Spec](addon-spec.md) — every permission an addon can ask
  for, and what it allows.

## Contact

This is a docs-only contract. Bugs, gaps, and disagreements:
<https://github.com/20m61/senn/issues>.
