# SENN — Claude Code Project Guide

This file is loaded into every Claude Code session in this repository.
It complements `CONTRIBUTING.md`, `GOVERNANCE.md`, and the specs in `docs/`.
Keep it concise — it is **prompt context**, not documentation.

---

## What this project is

SENN is an open-source browser-native P2P runtime for static add-ons.
"線でつながる。サーバに預けない。"

- **Source of truth = specs.** `docs/core-spec.md`, `docs/addon-spec.md`,
  `docs/addon-manifest.md`, and the ADRs under `docs/adr/`. Code derives from
  these — never the other way around.
- **Vendor neutral.** ADR-0007. Reject anything that names a specific signaling
  vendor or TURN provider as required.
- **Static add-ons only.** Add-ons run sandboxed and use Core APIs. They do not
  open network sockets, do not import server SDKs, and ship as static assets.

## Repository layout

```
packages/      core libraries (@senn/core, protocol, manifest, storage,
               addon-runtime, addon-sdk, signaling-{url-fragment,http-poll,nostr},
               ui)
apps/web/             reference web client (Vite + Playwright)
apps/addon-gallery/   ADR-0016/0020 gallery (Vite + Playwright)
addons/official/      signed official add-ons (avatar-presence, local-vault,
                      local-profile, whiteboard) + index.json + meta.json
examples/             example add-ons / PoCs (also workspace packages)
docs/adr/             ADRs (zero-padded 4-digit IDs, monotonic)
docs/dev/             contributor + AI-coder onboarding
scripts/              repo tooling (validators, signers, builders)
keys/                 *** signing keys — read/write FORBIDDEN by Claude ***
```

## Toolchain (pinned)

- Node **22 LTS** (`.nvmrc`)
- pnpm **9.12.0** (`package.json` → `packageManager`)
- TypeScript **5.6+** strict (`tsconfig.base.json`: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `composite`)
- Biome **1.9** for lint + format (no ESLint, no Prettier)
- Vitest for unit/integration; Playwright for e2e on Chromium / Firefox / WebKit

## Common commands

| Goal                           | Command                                        |
|--------------------------------|------------------------------------------------|
| Install                        | `pnpm install --frozen-lockfile`               |
| Dev (web app)                  | `pnpm dev` *(filters `@senn/web`)*             |
| Dev (gallery)                  | `pnpm --filter @senn/addon-gallery dev`        |
| Typecheck (project refs)       | `pnpm typecheck`                               |
| Lint                           | `pnpm lint`                                    |
| Format                         | `pnpm format`                                  |
| Unit/integration tests         | `pnpm test`                                    |
| Build all                      | `pnpm build`                                   |
| Validate one manifest          | `pnpm validate:addon <path/to/manifest.json>`  |
| Validate **all** manifests     | `pnpm validate:all-manifests`                  |
| Forbidden-API grep on add-ons  | `pnpm check:addon-forbidden`                   |
| Verify official-addon sigs     | `pnpm verify:official`                         |
| Verify @senn/addon-sdk shape   | `SENN_VERIFY_SDK_OFFLINE=1 pnpm verify:addon-sdk` |
| Validate registry index        | `pnpm validate:registry addons/official/index.json` |
| Test registry schema           | `pnpm test:registry-schema`                    |
| Build addon-sdk runtime        | `pnpm build:addon-sdk`                         |
| Build web-shipped registry     | `pnpm build:web-registry`                      |
| License check                  | `pnpm check:licenses`                          |

The **conformance gate** (CI: `.github/workflows/conformance.yml`) runs:
typecheck → lint → `validate:all-manifests` → `check:addon-forbidden` →
`verify:official` → `test:registry-schema` → `validate:registry` →
`verify:addon-sdk` → `build:addon-sdk` (no diff) → `build:web-registry` (no diff)
→ Playwright web e2e (chromium/firefox/webkit) → Playwright gallery e2e.

Run `/senn-conformance` to mirror this locally before opening a PR.

## Branch policy

- **Never** commit or push to `main`. Releases only via PR from `develop`.
- Topic branches: `feature/*`, `fix/*`, `refactor/*`, `docs/*`, `chore/*`,
  `test/*`, `ci/*`.
- Conventional Commits in English: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`, `ci:`.

## Spec-Driven Development (SDD)

This is the heart of SENN. Follow this loop:

1. **Read the spec.** Before changing behavior, find the normative clause.
2. **Drift = ADR.** If code and spec disagree, surface the gap. Do not silently
   align one to the other.
3. **MUST/SHOULD/MAY have RFC-2119 meaning** in normative text.
4. **Schemas are normative.** Manifest fields, message envelopes, permission
   strings, capability tags. TypeScript types are *derived*.
5. **Conventions** (enforced):
   - Permissions: kebab-case dotted — `peer.send`, `storage.local.read`.
   - Capabilities: kebab-case versioned — `whiteboard-v1`.
   - Add-on IDs: reverse-DNS — `com.example.thing`.
   - ADR IDs: 4-digit zero-padded, monotonically increasing.
6. **Every observable behavior is testable.** If you cannot sketch the
   conformance test, the clause is under-specified.

Use the `sdd-expert` agent before writing or merging changes to
`docs/core-spec.md`, `docs/addon-spec.md`, `docs/addon-manifest.md`, or
`docs/adr/`.

## Security & privacy guardrails

- **Never** modify, read into context, or commit:
  - `keys/**`, `**/*.key.json` (ADR-0009: signing keys MUST NOT be committed).
  - `.env`, `.env.*` (except `.env.example` — that one is fine to read/edit),
    `credentials.json`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, etc.
- The guardrail hooks (`.claude/hooks/guard-*.sh`) require `jq` on `PATH`
  (`apt install jq` / `brew install jq`). If `jq` is missing, the hooks
  fail open and the `permissions.deny` rules in `.claude/settings.json`
  remain in force.
- **Do not weaken** privacy or security claims to make implementation easier
  (see `docs/privacy.md`, `docs/security-model.md`).
- **No new dependencies** without the license-policy check
  (`docs/license-policy.md`). Prefer browser standard APIs.
- **Add-ons must not** import network SDKs, open WebSockets/`fetch` to
  third parties, or call APIs outside `senn.<namespace>.<method>(...)`.
  `pnpm check:addon-forbidden` enforces this — keep it green.

## When working on add-ons

Read `docs/dev/writing-an-addon.md` and `docs/dev/addon-cookbook.md`. Pipeline:

1. Author `manifest.json` — every permission must be **used and justified**.
2. Build the sandboxed iframe HTML/JS skeleton — browser standards only.
3. Validate: `pnpm validate:addon <manifest>`.
4. Forbidden-API grep: `pnpm check:addon-forbidden`.
5. If touching official: `pnpm verify:official` after `pnpm sign:all-official`
   (signing requires the maintainer key — do not attempt automated signing).

The `addon-builder` agent automates this pipeline for AI coders.

## When working on ADRs

Use `docs/adr/README.md` as the template. Leave `Status: Proposed` — only a
maintainer transitions to `Accepted`. The `adr-author` agent drafts ADRs in
the correct shape.

## When working on specs

The `sdd-expert` agent is the authority. Specs require:
- One-paragraph intent.
- Normative checklist with RFC-2119 vocabulary.
- A positive example.
- A negative example **with the reason it is wrong** (AI coders rely on this).

## Working with Claude Code in this repo

- **Communicate in 日本語**, write code/commits/PRs/specs in **English**.
- **Trust the conformance gate.** When unsure if a change is safe, run
  `/senn-conformance` (or the individual `pnpm` commands) and report results
  rather than guessing.
- **Prefer `pnpm --filter <pkg>`** over `cd packages/x && pnpm`. The workspace
  is the unit of build; project references in `tsconfig.json` rely on it.
- **Edit the spec when behavior changes.** Code-only PRs that change observable
  behavior should be rejected at review — even by you, when reviewing.
- **Don't auto-format unrelated files.** Biome is configured to leave
  generated bundles, `dist/`, and Playwright artefacts alone — keep it that way.
- **Plan-first for non-trivial work.** Use `EnterPlanMode` for any change that
  touches more than one package, modifies a normative spec, or alters the
  conformance gate.

## Available specialized agents

| Agent              | Use when                                                  |
|--------------------|-----------------------------------------------------------|
| `sdd-expert`       | Reviewing/editing `docs/core-spec.md`, `docs/addon-spec.md`, `docs/addon-manifest.md`, `docs/adr/**`. |
| `addon-builder`    | Generating a new add-on end-to-end (manifest + skeleton + validators). |
| `conformance-runner` | Reproducing CI failures locally; running the gate; summarizing failures. |
| `adr-author`       | Drafting a new ADR in the project template.               |

## Available slash commands (project)

| Command                | Purpose                                                |
|------------------------|--------------------------------------------------------|
| `/senn-conformance`    | Run the full local conformance gate.                   |
| `/senn-validate`       | Validate manifests + registry + addon-sdk shape.       |
| `/senn-addon-new`      | Scaffold a new add-on via the `addon-builder` agent.   |
| `/senn-adr-new`        | Scaffold a new ADR via the `adr-author` agent.         |
| `/senn-spec-review`    | Run the `sdd-expert` agent against changed spec files. |
| `/senn-sign-check`     | Audit add-on signatures without writing keys.          |
| `/senn-pr`             | Open a PR from current branch into `develop`.          |
