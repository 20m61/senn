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
| Adapter unit tests | `pnpm --filter @senn/signaling-url-fragment test` (round-trip, isolation, close, negatives) |

When the spec intentionally changes, regenerate the fixture with
`pnpm validate:invite <payload> --update` and include both the payload and
the regenerated `encoded.txt` / `url.txt` in the PR.

## Add-on level

```sh
pnpm tsx scripts/validate-addon-manifest.ts <path-to-manifest.json>
```

| Check | Guards |
|-------|--------|
| Manifest validator | `id`, `version`, `network`, permission strings, capability tags |
| Forbidden API grep | Add-ons MUST NOT include `fetch`, `WebSocket`, `RTCPeerConnection`, … |

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

CI does not yet exist in the repo. When it lands, it MUST:

1. Run `pnpm install --frozen-lockfile`.
2. Run `pnpm typecheck` and `pnpm lint`.
3. Run `pnpm validate:addon` against every manifest under `addons/` and
   `examples/`.
4. Run the forbidden-API grep against every add-on directory.

Until CI exists, contributors are responsible for running these locally.
PRs without conformance evidence will be sent back.
