# SENN Roadmap

This file tracks **what shipped** and **what is in flight** at the
phase level. The authoritative source for *individual* decisions is
the ADR set under [`docs/adr/`](adr/); this document compresses them
into a phase-by-phase narrative for new contributors.

Legend:

- ✅ Shipped — landed on `develop` and covered by `pnpm conformance`.
- 🟡 In flight — partially shipped, deferred parts listed inline.
- ⬜ Not started — accepted in an ADR but no implementation yet.
- 📌 Out of scope here — explicitly deferred by the named ADR.

## Phase 0: Foundation ✅

- ✅ 名前決定 ("SENN")
- ✅ リポジトリ作成
- ✅ ライセンス決定 (Apache-2.0; ADR-0002)
- ✅ 憲章作成 (`docs/charter.md`)
- ✅ 基本仕様作成 (`docs/core-spec.md`, `docs/addon-spec.md`,
  `docs/addon-manifest.md` — RFC-2119 normalised)
- ✅ アーキテクチャ作成 (`docs/architecture.md`)
- ✅ アドオン仕様作成 (`docs/addon-spec.md`,
  `docs/addon-runtime-spec.md`)

## Phase 1: P2P MVP ✅

- ✅ ルーム作成
- ✅ 招待 URL (`docs/room-and-invite-spec.md`)
- ✅ QR コード
- ✅ WebRTC 接続 (`@senn/core` PeerSession)
- ✅ DataChannel
- ✅ テキスト送信 (`core.text`)
- ✅ 接続状態 UI (reference web app)
- ✅ Binary peer transfer (ADR-0011) + chunked reassembly (ADR-0012)
- ✅ Cross-peer media tracks — audio + video (ADR-0015)

## Phase 2: Add-on Runtime MVP ✅

- ✅ manifest (`docs/addon-manifest.md` + validator)
- ✅ sandboxed iframe (ADR-0003)
- ✅ postMessage bridge (`docs/addon-runtime-spec.md`)
- ✅ 権限チェック (kebab-case dotted permissions)
- ✅ add-on message routing
- ✅ Local-first persistence (ADR-0005)
- ✅ Static add-on policy enforced (ADR-0006 + `pnpm
  check:addon-forbidden`)

## Phase 3: Official Add-ons ✅

Shipped through `addons/official/index.json` (registry v3,
ADR-0020) and signed under the official trust root:

- ✅ echo (`dev.senn.echo`) — reference bridge demo
- ✅ whiteboard (`dev.senn.whiteboard`)
- ✅ avatar-presence (`dev.senn.avatar-presence`)
- ✅ local-vault (`dev.senn.local-vault`)
- ✅ voice-meter (`dev.senn.voice-meter`)
- ✅ voice-call (`dev.senn.voice-call`) — ADR-0015 bidirectional A/V
- ✅ minimal (`dev.senn.minimal`) — boilerplate
- 📌 local-profile — listed in early roadmap; not in v3 registry
  (replaced by per-addon profile data via `storage.local.*`). Revisit
  if a concrete user-profile use case appears.

## Phase 4: Trust Layer ✅

- ✅ manifest validator (`pnpm validate:addon` /
  `pnpm validate:all-manifests`)
- ✅ license check (`pnpm check:licenses` + `docs/license-policy.md`)
- ✅ add-on signing design (ADR-0008 manifest signing — Ed25519,
  detached `manifest.sig.json`)
- ✅ verified add-on policy (`docs/security-model.md`,
  `docs/governance.md`)
- ✅ registry prototype → schema v2 (ADR-0017) → schema v3
  (ADR-0020) with version histories, audits, and submission
  envelopes
- ✅ keystore minimum (ADR-0009) + key rotation (ADR-0010)
- ✅ Tier-2 TURN strategy (vendor-neutral; ADR-0013)
- ✅ Federated Nostr signaling (ADR-0014)

## Phase 5: Ecosystem ✅

- ✅ Add-on SDK (`@senn/addon-sdk`) — typed `window.senn` surface,
  package shape pinned by ADR-0018
- ✅ Developer docs — `docs/dev/getting-started-addon.md`,
  `docs/dev/writing-an-addon.md`, `docs/dev/addon-cookbook.md`,
  `docs/dev/ai-driven-addon-development.md`
- ✅ Templates — `examples/minimal-addon`, addon-builder agent
  scaffolding
- ✅ Gallery — `apps/addon-gallery/` (ADR-0016) with v3 registry
  surfaces, host-neutral static deploy
- ✅ Community submission flow — registry v3 schema (ADR-0020 §2)
  defines the submission envelope; the gallery's
  `<section id="submissions">` renders any configured URL whose body
  parses as a `senn-publisher-submissions` document, with status
  badge, contact, statusReason, notes, and manifest/signature anchors

## Phase 6: Local-first operations ✅

The phase that emerged after v0.1.0: collapse every "is this branch
shippable / publishable?" decision onto a single local command, and
remove every CI/CD vendor dependency from the canonical repo.

- ✅ Local-first conformance gate (ADR-0021) — `pnpm conformance` +
  `.githooks/pre-push`
- ✅ Local-first publish pipeline (ADR-0022) — supersedes ADR-0019
  §5; `pnpm release:addon-sdk <tag>`; no Actions, no `NPM_TOKEN`
- ✅ Tiered git hooks (`.githooks/{pre-commit,commit-msg,pre-push,post-merge}`)
  wire every audit / lint / validator / test to a hook so a developer
  cannot land code that fails the contract
- ✅ Static deploy is host-neutral (`pnpm stage:gallery-static`,
  `GALLERY_BASE` env) — no GitHub Pages dependency
- 🟡 Vendor-neutral provenance (ADR-0023) — Proposed; the opt-in
  scaffold ships in `scripts/publish-addon-sdk.sh` (env-gated
  cosign / minisign / GPG), `docs/governance.md` (Release signing
  identities table), and `docs/dev/release.md` (env contract).
  Activates per release once the maintainer picks a tool, fills the
  governance table, and runs `SENN_SIGN_RELEASE=<tool>
  pnpm release:addon-sdk <tag>`. ADR stays Proposed until the
  first signed release demonstrates the verify path end-to-end.
  ADR-0025 (Proposed) selects **minisign** as the project default
  for that first signed release, with cosign keypair / GPG retained
  as documented alternatives recorded per release window in the
  governance table.
- 🟡 Capability tag naming and v1 registry (ADR-0026) — Proposed;
  pins the `<feature>-v<major>` kebab-case convention already in
  informal use (`text-v1`, `whiteboard-v1`) and registers the
  previously-unnamed peer-binary and media tags
  (`peer-bin-v1`, `media-audio-v1`, `media-video-v1`).
  `voice-v1` is superseded by `media-audio-v1`. `docs/core-spec.md`
  ships the registry table inline alongside the ADR.

## In flight (deferred items the next phase will pick up)

These are accepted in an ADR but not shipped yet. The order is
indicative, not committed:

- ✅ ~~**`@sennjs/addon-sdk` initial npm publish**~~ — shipped 2026-04-30
  (`@sennjs/addon-sdk@0.1.0`, tag `addon-sdk-v0.1.0`, commit 295c87b)
  via the ADR-0022 local-first flow. Original `@senn` scope was found
  unavailable on 2026-04-29; project moved to `@sennjs` per ADR-0019
  §2 amendment 2026-04-30. Install with `pnpm add -D @sennjs/addon-sdk`.
  Registry: <https://www.npmjs.com/package/@sennjs/addon-sdk>.
- ✅ ~~**Node-side PeerSession tests**~~ — shipped in
  `packages/core/test/peer-session.test.ts`; covers every MUST in
  `docs/peer-session-spec.md` against in-process fakes. Playwright
  remains the real-stack harness on demand.
- ✅ ~~**`pnpm verify:http-poll-endpoint` self-test**~~ — shipped as
  `pnpm verify:http-poll-self-test` (in `pnpm conformance`); spawns
  the Node reference server in-process and runs the same probe
  operators run against deployed endpoints.
- ✅ ~~**Nostr-side smoke-script**~~ — shipped as
  `pnpm verify:nostr-self-test` (in `pnpm conformance`); injects an
  in-process NIP-01 mock relay via the adapter's `wsCtor` and runs
  each MUST clause from `docs/signaling-nostr-spec.md` as a named
  CLI check. A real-relay variant is intentionally out of scope to
  preserve vendor-neutrality (ADR-0007).
- 📌 **N>2 multi-party media** (ADR-0015 §"Out of scope") — explicit
  deferral; revisit when a concrete use case lands.
- 📌 **Backpressure / flow control on binary transfer** (ADR-0011 §6)
  — explicit deferral; v1 keeps the simple framing.
- 🟡 **Encrypted Nostr signaling** — ADR-0024 (Proposed) closes the
  ADR-0014 §"Out of scope" deferral by locking in NIP-44 v2 over a
  room-derived symmetric key as the OPTIONAL v2 content cipher for
  kind-25556 events. Mandatory v1 fallback for mixed-version rooms.
  Implementation in `@senn/signaling-nostr` follows once the ADR is
  Accepted; threat model unchanged from ADR-0014 (invite link is
  the trust boundary).

## Versioning

The repository ships at `0.0.0` workspace-wide during pre-alpha.
`@senn/addon-sdk` is the first package to graduate (target
`0.1.0`, per ADR-0019 §3); other packages stay `private: true` at
`0.0.0` until they are individually elected for publication via an
additive ADR.

For the operational release runbook, see
[`docs/dev/release.md`](dev/release.md).
