# Add-on Audio Level Specification

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

## Intent

Define how a SENN add-on may receive a numeric **audio level** stream
from the host's microphone, without ever seeing the raw waveform.
This page is normative.

The motivating use case is voice-activity-driven UI: a presence
add-on that highlights "speaking", a meter overlay, a push-to-talk
indicator. Cross-peer audio (sending the actual sound) is out of
scope here; that belongs to a future media-channel ADR.

## Threat surface

A raw microphone stream inside an add-on iframe would be unwise:

- The add-on origin is opaque, so revoking it later is messy.
- A buggy or malicious add-on could exfiltrate audio (the manifest
  has `network: false`, but `MediaStreamTrack` has surface beyond
  network — recording to local storage and exposing it later via
  a peer message would still leak).
- Browsers gate `getUserMedia` per-iframe-origin, so prompting from
  the iframe creates extra UX confusion.

This spec keeps the raw stream entirely on the host side. The add-on
sees a `[0, 1]` real number, sampled at most ~20 Hz. That is enough
for a meter or a "speaking" boolean, and useless for reconstructing
speech.

## Normative checklist

- An add-on declaring `audio.level` MAY subscribe to the level
  stream by posting `{ op: "audio.level.subscribe" }` to the host
  bridge.
- An add-on declaring `audio.level` MAY unsubscribe at any time by
  posting `{ op: "audio.level.unsubscribe" }`.
- The host MUST refuse `audio.level.subscribe` from an add-on that
  has not declared the `audio.level` permission. The refusal MUST
  surface as a bridge `error` op with `code: "permission-denied"`.
- The host MUST emit `{ op: "audio.level", level: number }` to the
  subscribing add-on while the subscription is active. `level` MUST
  be a finite real number in `[0, 1]`.
- The host SHOULD throttle emissions to **≤ 30 Hz** so the iframe's
  message queue stays light. The default reference rate is **20 Hz**.
- The host MUST stop emitting when (a) the add-on unsubscribes, or
  (b) the underlying microphone stream ends, or (c) the AddonHost
  closes.
- The host MAY surface an internal `error` op with
  `code: "audio-unavailable"` when it cannot satisfy the
  subscription (no mic, user denied, no `getUserMedia`).
- The host MUST NOT include any audio buffer, waveform, frequency
  bins, peak indicators, channel count, or sample rate in the
  message — only `level`.
- The host MUST NOT persist the audio anywhere observable to the
  add-on (no storage backend write, no peer forwarding).

## Bridge ops

```ts
// Add-on iframe → host
interface AddonAudioLevelSubscribe {
  readonly kind: "senn.addon.v1";
  readonly op: "audio.level.subscribe";
}
interface AddonAudioLevelUnsubscribe {
  readonly kind: "senn.addon.v1";
  readonly op: "audio.level.unsubscribe";
}

// Host → add-on iframe
interface AddonAudioLevelEvent {
  readonly kind: "senn.addon.v1";
  readonly op: "audio.level";
  readonly level: number; // 0..1
}
```

The SDK exposes:

```ts
senn.audio.subscribeLevel(handler: (level: number) => void): () => void;
```

which returns an unsubscribe function. Multiple subscriptions inside
one add-on share a single host-side stream.

## Negative examples

- An add-on without `audio.level` calling `audio.level.subscribe` —
  **rejected** with `permission-denied`.
- A host that emits `{ op: "audio.level", level: 1.4 }` —
  **non-conformant**; the level must clip to `[0, 1]`.
- A host that includes `frequencyBins: number[]` alongside `level`
  — **non-conformant**; spec rejects any waveform exposure.
- An add-on echoing received levels to the peer over `peer.send` —
  permitted by the protocol but discouraged: reconstructing
  utterance timing across many subscribers becomes possible. Hosts
  may surface this in audit reports.

## Conformance

```sh
pnpm --filter @senn/addon-runtime test
```

The runtime tests gate `audio.level.subscribe` on the permission and
verify the level event reaches the iframe only between subscribe and
unsubscribe. Real `getUserMedia` plumbing is a host concern (the
`apps/web` reference deployment wires it; tests inject a synthetic
level source).

## Cross-references

- [addon-runtime-spec.md](addon-runtime-spec.md)
- [addon-spec.md](addon-spec.md) (`audio.level` permission)
- [security-model.md](security-model.md)
