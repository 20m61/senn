# Conformance

## Intent

A single page listing every check that defines the SENN contract, what
each check guards, and how to interpret a failure. AI coders MUST run
the relevant blocks and paste the output into their PR description.

## Local-first: `pnpm conformance` is the authority

The full gate is one command:

```sh
pnpm conformance
```

That runs `scripts/conformance.sh`, which sequences every static check
(typecheck → lint → manifest validators → forbidden-API grep → official
add-on signatures → registry schema → addon-sdk shape → drift checks →
workspace tests) and prints a single PASS/FAIL summary at the end. A
green run is the ship contract. **The repo does not depend on GitHub
Actions to enforce its contract.**

Every check the project enforces is wired to a git hook. `pnpm install`
sets `git config core.hooksPath .githooks` via the `prepare` script,
so the hooks fire automatically once dependencies are installed.

| Hook | Triggers | Sequence |
|------|----------|----------|
| `.githooks/pre-commit` | every `git commit` | (a) protected-path guard (`keys/`, `*.key.json`, `.env*` except `.env.example`, `*.pem`, `*.key`, `id_*`); (b) `biome check` on staged `.ts/.tsx/.js/.json/.css/...` files; (c) `pnpm typecheck` if any `.ts/.tsx` is staged; (d) `pnpm validate:addon` on each staged `addons/*/manifest.json` or `examples/*/manifest.json`; (e) `pnpm check:addon-forbidden` if any add-on file is staged; (f) `pnpm validate:registry` if `addons/official/index.json` is staged |
| `.githooks/commit-msg` | every `git commit` | Conventional Commits subject (`feat\|fix\|docs\|refactor\|test\|chore\|ci\|style\|perf\|build\|revert`, optional `(scope)`, optional `!`, ≤72 chars); skips merge / fixup / squash / WIP commits |
| `.githooks/pre-push` | every `git push` | `pnpm conformance` (the full gate above); refuses pushes targeting `refs/heads/main` |
| `.githooks/post-merge` | after `git pull` / `git merge` | informational only — warns if `pnpm-lock.yaml` or any `package.json` changed, suggesting `pnpm install --frozen-lockfile` |

Bypass (emergency only — surfaces in `git log`):

```sh
git commit --no-verify             # skip pre-commit + commit-msg
SENN_SKIP_PRECOMMIT=1 git commit   # one-time, env form
SENN_SKIP_COMMITMSG=1 git commit   # one-time, env form
git push --no-verify               # skip pre-push
SENN_SKIP_PREPUSH=1 git push       # one-time, env form
SENN_SKIP_POSTMERGE=1 git pull     # silence post-merge nudge
git config --unset core.hooksPath  # repo-wide opt-out (discouraged)
```

Browser e2e (Playwright) is **not** part of `pnpm conformance` — it
takes ~25 minutes per browser. Run on demand:

```sh
pnpm --filter @senn/web e2e --project=chromium    # or firefox / webkit
pnpm --filter @senn/addon-gallery exec playwright test --project=chromium
```

## Step-by-step (what `pnpm conformance` runs)

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
| PeerSession media surface (ADR-0015 stage 1) | `pnpm --filter @senn/core test` — addLocalTrack on inviter calls `pc.addTrack` and triggers a fresh offer; addLocalTrack on joiner is rejected; `pc.ontrack` emits `remote-track`; `sender.remove()` calls `pc.removeTrack` |
| AddonHost media bridge (ADR-0015 stage 2) | `pnpm --filter @senn/addon-runtime test` — media.send.* / media.receive.* permission gates, mediaCapture provider hook, mediaSink attaches incoming tracks only after subscribe |
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

## No CI vendor dependency

SENN does not ship a CI vendor configuration. The repo does not contain
`.github/workflows/`, `.gitlab-ci.yml`, or any equivalent: the contract
is `pnpm conformance` plus the `.githooks/pre-push` hook (ADR-0021).

Forks MAY add a CI vendor of their choice, but they MUST keep that
configuration as a *mirror* of `scripts/conformance.sh` — never as the
authority. A fork without any CI is fully capable of producing a
conformant release: contributors run `pnpm conformance` locally and the
pre-push hook gates merges.

Browser e2e is on-demand only — `pnpm --filter @senn/web e2e --project=<browser>`
across Chromium / Firefox / WebKit. Run locally when touching code that
crosses the WebRTC / DataChannel boundary; one browser project is
usually enough for inner-loop iteration.

PRs without local conformance evidence will be sent back.
