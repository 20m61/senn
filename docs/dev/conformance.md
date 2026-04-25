# Conformance

## Intent

A single page listing every check that runs locally and in CI, what each
check guards, and how to interpret a failure. AI coders MUST run each
relevant block and paste the output into their PR description.

## Repo-level

```sh
pnpm install
pnpm typecheck
pnpm lint
```

| Check | Guards |
|-------|--------|
| `pnpm install` | Lockfile and dependency allow list |
| `pnpm typecheck` | TypeScript project references and the protocol contract |
| `pnpm lint` (`biome check .`) | Formatting and lints |

## Protocol level

```sh
pnpm validate:invite examples/invite-roundtrip/payload.json
```

| Check | Guards |
|-------|--------|
| Invite round-trip | `docs/room-and-invite-spec.md` (encode/decode, URL length, fragment key) |
| Bundle round-trip | `docs/signaling-url-fragment-spec.md` (encode/decode, message schema) |
| Adapter unit tests (URL fragment) | `pnpm --filter @senn/signaling-url-fragment test` (round-trip, isolation, close, negatives) |
| Adapter contract tests (HTTP poll) | `pnpm --filter @senn/signaling-http-poll test` (mock + real Node reference server: round-trip, dedup, 4xx surfacing, no vendor lock-in) |
| Adapter contract tests (Nostr) | `pnpm --filter @senn/signaling-nostr test` (in-process mock relay implementing the NIP-01 frame subset: round-trip, multi-relay dedup, no-relay rejection, fresh ephemeral keypair per construction, kind 25556 + tag-based room routing per ADR-0014) |
| Storage backend tests | `pnpm --filter @senn/storage test` (in-memory backend: namespacing, quota, length, close, types) |
| Manifest signing tests | `pnpm --filter @senn/manifest test` (Ed25519 sign/verify round-trip, tampered manifest, untrusted key, schema rejections, keystore PKCS#8 round-trip) |
| Signing CLI | `pnpm sign:manifest <dir> --generate-key <ks.json>` then `pnpm verify:manifest <dir>` — both exit 0; tampering causes verify to exit non-zero |
| Official registry | `pnpm verify:official` — every add-on listed in `addons/official/index.json` has a `manifest.sig.json` whose key is in `trustedKeys` and whose bytes match the served `manifest.json` |
| Registry re-sign | `pnpm sign:all-official <keystore>` — re-signs every add-on listed in the registry with the supplied keystore; refuses to run if any addon directory is missing `manifest.json`. Used by the rotation runbook (docs/governance.md, ADR-0010) |
| Add-on SDK distribution | `pnpm build:addon-sdk` — copies the canonical `packages/addon-sdk/runtime/senn-addon-sdk.js` into every addon directory listed in the registry. CI fails if the working tree differs after running it (catches stale shipped copies) |
| HTTP-poll endpoint conformance | `pnpm verify:http-poll-endpoint <url>` — black-box probe that drives `@senn/signaling-http-poll` against any deployed Tier-1 endpoint and asserts the spec wire contract (publish/subscribe round-trip + 4xx for malformed roomId / unknown kind). Use after deploying a third-party reference (PHP, Python, Go, Workers, …) |
| Browser e2e | `pnpm --filter @senn/web e2e` (Playwright across Chromium / Firefox / WebKit; RTCPeerConnection handoff + text + tampered URL + echo add-on round-trip + add-on storage persist/reload + namespace + whiteboard P2P stroke + whiteboard snapshot + avatar-presence state-only + manifest signing verify modes + local-vault file pick/save/persist + shipped echo verify=required against official trustedKeys + local-vault P2P binary file transfer + chunked 200 KiB file round-trip across multi-frame reassembly + voice-meter audio.level subscription with synthetic levels) |

When the spec intentionally changes, regenerate the fixture with
`pnpm validate:invite <payload> --update` and include both the payload and
the regenerated `encoded.txt` / `url.txt` in the PR.

## Add-on level

```sh
pnpm validate:addon <path-to-manifest.json>     # one manifest
pnpm validate:all-manifests                     # walk addons/ + examples/
```

| Check | Guards |
|-------|--------|
| Manifest validator | `id`, `version`, `network`, permission strings, capability tags |
| Forbidden API grep | `pnpm check:addon-forbidden` — add-ons MUST NOT include `fetch`, `WebSocket`, `RTCPeerConnection`, raw `localStorage`, `eval`, etc. |

Forbidden API grep:

```sh
grep -RInE "(^|[^.])(fetch|WebSocket|EventSource|RTCPeerConnection|RTCDataChannel|MediaStream)\b" \
  <addon-path> --exclude-dir=node_modules
```

This MUST return zero matches in add-on-owned files. Hits in `@senn/*`
imports are fine; hits in your own `addon.js` are not.

## Spec level (for SDD reviewers)

When editing `docs/`:

- Run a final pass with the `sdd-expert` subagent before merge.
- Ensure every JSON example in the spec validates.
- Ensure every normative clause has a positive and a negative example.

## Release level

- Tag matches the version in every workspace `package.json`.
- `THIRD_PARTY_LICENSES.md` regenerated.
- `docs/roadmap.md` reflects the new state.
- ADRs touched by the release are `Accepted`, not `Proposed`.

## CI

CI runs in `.github/workflows/conformance.yml` on push and PR to
`develop` and `main`. Two jobs:

1. **static** — `pnpm install --frozen-lockfile`, `pnpm typecheck`,
   `pnpm lint`, `pnpm validate:all-manifests`,
   `pnpm check:addon-forbidden`, `pnpm verify:official`,
   `pnpm validate:invite` + `pnpm validate:bundle` against committed
   fixtures, `pnpm test` (vitest), and `pnpm --filter @senn/web build`.
2. **e2e** — `pnpm --filter @senn/web e2e --project=<browser>` runs as a matrix across Chromium, Firefox, and WebKit so WebRTC compatibility regressions show up before merge. Browsers are cached per engine.

Contributors should still run the same checks locally before opening
a PR. PRs without conformance evidence will be sent back.
