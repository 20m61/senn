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

## In flight (deferred items the next phase will pick up)

These are accepted in an ADR but not shipped yet. The order is
indicative, not committed:

- ⬜ **`@senn/addon-sdk` initial npm publish** — ADR-0019 / ADR-0022
  toolchain is in place. Pending: npm `@senn` scope acquisition,
  npm 2FA on the maintainer account, `private:false` flip, and
  `version: 0.1.0` bump on `packages/addon-sdk/package.json`.
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
- 📌 **Encrypted Nostr signaling** (ADR-0014 §"Out of scope") —
  follow-up ADR will pick the wire format (NIP-44 candidate).

## Versioning

The repository ships at `0.0.0` workspace-wide during pre-alpha.
`@senn/addon-sdk` is the first package to graduate (target
`0.1.0`, per ADR-0019 §3); other packages stay `private: true` at
`0.0.0` until they are individually elected for publication via an
additive ADR.

For the operational release runbook, see
[`docs/dev/release.md`](dev/release.md).
