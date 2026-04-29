# ADR 0026: Capability tag naming convention and v1 registry

## Status

Implemented (2026-04-29; PR #20, commit a17a696). The v1 capability
registry table is shipped on `develop` in `docs/core-spec.md`
§"Capability Negotiation"; the `<feature>-v<major>` naming pattern is
the contract every existing tag (`text-v1`, `peer-bin-v1`,
`media-audio-v1`, `media-video-v1`, `file-transfer-v1`,
`addon-runtime-v1`, `local-storage-v1`) already satisfies. Closes drift
items #7 and #8 from the `sdd-expert` audit against ADR-0011,
ADR-0012, and ADR-0015.

## Context

SENN uses a capability-negotiation handshake at session start. Each peer
sends a `hello` message carrying an array of string tags that declare which
protocol features the peer can participate in. The receiving peer uses the
intersection of the two arrays to decide which data-channel flows and media
tracks it will open.

The naming pattern `<feature>-v<major>` (e.g., `text-v1`, `whiteboard-v1`)
has been used consistently since the first spec draft and is pinned in the
SENN contributor guide. However, that pattern has never been codified in a
normative ADR: it appears only as prose guidance and as examples in
`docs/core-spec.md` and `docs/addon-manifest.md`. That gap has two
consequences.

First, three significant capabilities introduced by Accepted ADRs were never
assigned canonical tags. ADR-0011 (binary peer transfer) and ADR-0012
(chunked binary peer transfer) together specify the `core.bin` DataChannel
flow, but neither ADR names a capability tag, so peers have no standard way
to advertise or discover binary-transfer support. ADR-0015 (cross-peer media
tracks) specifies audio and video track negotiation using perfect negotiation,
but similarly does not name canonical capability tags for audio and video
separately. The `sdd-expert` audit logged these as drift items #7 and #8.

Second, the example `capabilities` array in `docs/core-spec.md`
§"Capability Negotiation" still lists `voice-v1`, a coarse tag that predates
ADR-0015's fine-grained audio/video track model. Keeping `voice-v1` in the
example creates ambiguity about whether a peer advertising `voice-v1` supports
the ADR-0015 perfect-negotiation flow or an older, unspecified flow.

This ADR assigns the missing canonical tags, retires `voice-v1` in favour of
the more granular `media-audio-v1` and `media-video-v1`, and establishes the
rules by which future capability tags are named and registered.

The sibling permission system uses kebab-case dotted notation (e.g.,
`peer.send`, `media.send.audio`) and governs per-add-on API declarations.
Capability tags govern per-peer feature negotiation. The two vocabularies are
deliberately separate and MUST NOT be conflated. They share the kebab-case
requirement but differ in separator (hyphen vs. dot) and semantics
(bidirectional session feature vs. fine-grained add-on permission).

## Decision

### 1. Naming pattern (normative)

A SENN capability tag MUST conform to the pattern `<feature>-v<major>` where:

- `<feature>` MUST match `^[a-z][a-z0-9-]*$`: lowercase ASCII, starting with
  a letter, using hyphens as word separators, no dots, no underscores, no
  uppercase characters.
- `<major>` MUST be a positive integer with no leading zeros (e.g., `1`, `2`,
  `10`). Capability versioning is a feature-flag mechanism, not a semver
  dependency graph: only backward-incompatible changes bump the major, and the
  bump ships under a new tag while the old tag MAY coexist.
- Tags MUST NOT carry a vendor prefix (e.g., no `senn-`, no `core-`).
  Capability tags are vocabulary of the SENN protocol, not of any
  implementation.

A peer that supports both an old and a new major of the same feature MAY
advertise both tags simultaneously (e.g., `media-audio-v1` and a hypothetical
`media-audio-v2` during a migration window). A peer that receives an unknown
tag MUST silently ignore it.

### 2. Feature-name guidance for new tags

- One feature per tag. Composite tags (e.g., a hypothetical
  `audio-and-video-v1`) are PROHIBITED because they prevent a peer from
  advertising partial support.
- A tag covers bidirectional participation in a feature unless the feature is
  inherently asymmetric (e.g., an observer-only mode), in which case a
  separate tag is appropriate.
- The tag name SHOULD correspond to the most prominent permission prefix it
  gates (e.g., `media-audio-v1` corresponds to `media.send.audio` and
  `media.receive.audio`). Tags and permissions are separate vocabularies;
  the SHOULD correspondence is a readability aid, not a structural constraint.

### 3. Normative v1 capability registry

The following table is the complete v1 registry. It is normative; no other
capability tags are currently defined by the SENN core spec. This table MUST
also appear in `docs/core-spec.md` §"Capability Negotiation".

| Tag | Means "this peer supports…" | Spec anchor |
|---|---|---|
| `text-v1` | UTF-8 text messaging on the `core.text` DataChannel flow | `docs/core-spec.md` §Text |
| `peer-bin-v1` | Binary peer transfer on the `core.bin` DataChannel: logical messages up to 4 MiB, wire frames up to 64 KiB, transparent chunking and reassembly | ADR-0011; ADR-0012; `docs/addon-binary-transfer-spec.md` |
| `media-audio-v1` | Cross-peer audio tracks: host-captured `getUserMedia` audio, perfect negotiation per ADR-0015 | ADR-0015; `docs/addon-media-spec.md` §`media.{send,receive}.audio` |
| `media-video-v1` | Cross-peer video tracks: camera or display capture, perfect negotiation per ADR-0015 | ADR-0015; `docs/addon-media-spec.md` §`media.{send,receive}.video` |
| `file-transfer-v1` | Local file-picker selection and chunked DataChannel transfer with explicit receiver save-confirmation | `docs/core-spec.md` §File Transfer; `docs/addon-file-transfer-spec.md` |
| `addon-runtime-v1` | Sandboxed-iframe add-on runtime contract | ADR-0003; `docs/addon-runtime-spec.md` |
| `local-storage-v1` | Per-add-on local-first persistence | ADR-0005; `docs/addon-storage-spec.md` |

The tag `voice-v1`, which appears in the example `capabilities` array in the
current `docs/core-spec.md` §"Capability Negotiation", is **superseded** by
`media-audio-v1`. Implementations MUST NOT treat `voice-v1` as a defined tag.
The spec example MUST be updated in the same PR that records this ADR as
Implemented (see §5 below).

### 4. Stability and registry amendment rules

- Adding a new capability tag REQUIRES either a new ADR or a spec amendment
  that cites this ADR (ADR-0026) as the naming authority.
- The new tag MUST be added to the registry table in `docs/core-spec.md`
  §"Capability Negotiation" in the same PR that ships the feature
  implementation.
- Removing or repurposing an existing tag REQUIRES a new ADR.
- Renaming a tag is equivalent to removing the old tag and adding a new one,
  and therefore REQUIRES a new ADR.

### 5. Non-breaking introduction and graceful fallback

Capability negotiation is opt-in feature discovery, not a hard session
requirement. A peer that does not advertise `peer-bin-v1` MUST be assumed to
lack binary DataChannel support; a sender MUST either fall back to `text-v1`
flows or surface a user-visible error — it MUST NOT silently drop the
payload. The same logic applies to `media-audio-v1` and `media-video-v1`:
absence of the tag means no audio or video track SHOULD be opened toward
that peer.

### 6. Sibling spec updates required by this ADR

The following updates MUST land in the same PR that transitions this ADR's
Status to Implemented:

- `docs/core-spec.md` §"Capability Negotiation": replace the current
  freeform `capabilities` array example with the registry table from §3 above,
  removing `voice-v1` and adding `peer-bin-v1`, `media-audio-v1`, and
  `media-video-v1`.
- `docs/core-spec.md` §"Voice": rename to §"Media (audio + video)" and
  rewrite to describe the host-captured `getUserMedia` plus perfect-negotiation
  flow specified in ADR-0015. The existing normative requirement "MUST use
  browser-native codecs; app-layer compression MUST NOT be applied" is
  retained verbatim.

## Rationale

The naming pattern `<feature>-v<major>` is already in use and working; this
ADR codifies rather than invents it. Major-only versioning is appropriate
because capability negotiation is binary (either both peers have the tag or
they do not); minor and patch signals are irrelevant to the intersection
computation. Separating audio and video into distinct tags (`media-audio-v1`,
`media-video-v1`) rather than a single `media-v1` tag allows a peer to
participate in audio-only sessions without advertising unimplemented video
support — this is the "one feature per tag" rule made concrete. Retiring
`voice-v1` explicitly rather than leaving it as a deprecated alias avoids
ambiguity about whether a peer advertising `voice-v1` has implemented the
ADR-0015 perfect-negotiation flow.

The vendor-prefix prohibition follows directly from ADR-0007's
vendor-neutrality principle: a fork MUST be able to implement any registered
capability without first adopting a vendor label that does not belong to it.

## Consequences

- Positive
  - Peers that implement ADR-0011/ADR-0012 binary transfer or ADR-0015 media
    tracks can now advertise those capabilities using normative, interoperable
    tags. Feature discovery is unambiguous.
  - The registry table in `docs/core-spec.md` gives add-on authors, runtime
    implementers, and fork maintainers a single authoritative reference.
  - Graceful-fallback requirements (§5) are now explicit: senders that ignore
    capability negotiation results can be identified as non-conformant.
  - The naming rules and amendment process (§4) prevent ad-hoc tag
    proliferation without ADR overhead for implementation-only decisions.
  - `voice-v1` is retired cleanly; the spec example no longer misleads readers
    about the current audio model.

- Negative
  - Any existing implementation that used `voice-v1` must migrate to
    `media-audio-v1`. Because capability negotiation is feature-flag
    intersection, the migration is non-breaking in new sessions but requires
    both peers to update before audio tracks can be established via the
    new tag. The old tag is not defined by the spec, so implementations
    SHOULD have been negotiating audio only experimentally.
  - Adding a new capability tag now requires an ADR or a spec amendment.
    This is intentional gatekeeping, but it adds a small process overhead
    for new feature work.

- Neutral / follow-up
  - This ADR does not define a formal capability-deprecation procedure. A
    follow-up ADR, gated on the first concrete need for a v2 tag, will
    establish that procedure.
  - Per-add-on capability advertisement (the `capabilities` array in
    `docs/addon-manifest.md`) uses the same naming rules as peer-level
    capability tags. This ADR does not change the manifest field; it only
    confirms that the same vocabulary applies.
  - Whether peers MUST gossip capability changes mid-session is out of scope.
    Capability negotiation runs at hello-time only; renegotiation is implicit
    in a new session.
  - This ADR is reversible in principle (a future ADR could change the naming
    pattern), but reversing it after the v1 registry tags are in deployed
    implementations would require coordinated upgrades across all peers. The
    cost of reversal is therefore high; the naming pattern should be considered
    stable.

## Related

- `docs/core-spec.md` §"Capability Negotiation" — normative example this ADR
  updates; registry table MUST land here.
- `docs/addon-manifest.md` §`capabilities` — confirms the naming rule applies
  to the manifest vocabulary as well.
- ADR-0003: Add-on Sandbox Model — gates `addon-runtime-v1`.
- ADR-0005: Local-first Persistence — gates `local-storage-v1`.
- ADR-0007: Vendor-neutral signaling and relay — vendor-prefix prohibition
  applied here to capability tags.
- ADR-0011: Binary peer transfer — defines the `core.bin` flow that
  `peer-bin-v1` advertises.
- ADR-0012: Chunked binary peer transfer — defines the chunking and
  reassembly semantics covered by `peer-bin-v1`.
- ADR-0015: Cross-peer media tracks — defines the perfect-negotiation flow
  that `media-audio-v1` and `media-video-v1` advertise.
