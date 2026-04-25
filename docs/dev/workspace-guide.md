# Workspace Guide

## Intent

Tell every contributor (human or AI) where each kind of code lives, what
each package owns, and how packages depend on each other. If a change does
not fit the rules below, it belongs in a new package — propose one in an
ADR before adding it.

## Layout

```
senn/
  apps/
    web/                  Reference SENN web app (Vite + TS PoC)
    addon-gallery/        (planned) Add-on discovery UI
  packages/
    core/                 SENN Core runtime — rooms, transport, message router, add-on host
    protocol/             Wire protocol — envelopes, capability negotiation, SignalingTransport
    addon-sdk/            Developer SDK for static add-ons
    addon-runtime/        Sandboxed iframe host that runs add-ons inside the host app
    storage/              Local-first storage (IndexedDB / OPFS) per-add-on namespaces
    ui/                   Lightweight UI primitives shared across apps
  addons/
    official/             Add-ons maintained by the SENN project (Local Profile, Vault, …)
  examples/
    minimal-addon/        Smallest valid add-on; runtime fixture
    file-transfer/        (planned)
    whiteboard/           (planned)
    avatar-presence/      (planned)
  docs/                   Specs, ADRs, dev docs
  scripts/                Repo-level tooling (validators, license checks)
  .claude/agents/         Project-local Claude Code subagents (e.g. sdd-expert)
```

## Dependency rules (MUST follow)

```
@senn/protocol         depends on: nothing in this repo
@senn/storage          depends on: nothing in this repo
@senn/ui               depends on: nothing in this repo
@senn/addon-sdk        depends on: @senn/protocol
@senn/addon-runtime    depends on: @senn/protocol
@senn/core             depends on: @senn/protocol, @senn/storage, @senn/addon-runtime
apps/web               depends on: @senn/core, @senn/protocol, @senn/storage, @senn/ui
addons/official/*      depends on: @senn/addon-sdk only (must run as static add-ons)
examples/*             depends on: @senn/addon-sdk only
```

- `@senn/protocol` MUST stay free of runtime concerns (no DOM, no IndexedDB).
  It declares schemas and types only.
- `@senn/core` MUST NOT import from `apps/*` or `addons/*`.
- `addons/official/*` MUST NOT import from `@senn/core`. Add-ons see Core
  only through the SDK and the postMessage bridge.
- Cyclic dependencies are forbidden. CI will reject them.

## Versioning

- All workspace packages are private and share a single version line during
  pre-alpha. Version bumps happen at release time in lock-step.
- Public protocol identifiers (envelope `kind`, capability tags, permission
  strings) MUST evolve via ADR, not via package version bumps alone.

## Adding a new package

1. Open an issue describing the boundary the new package owns.
2. If the boundary is non-obvious, file an ADR.
3. Add `packages/<name>/package.json`, `tsconfig.json`, `src/index.ts`.
4. Add the new package to `tsconfig.json` references at the repo root.
5. Update this document and the [README](../../README.md) layout section.

## Conformance

- `pnpm typecheck` MUST pass.
- `pnpm lint` MUST pass.
- New packages MUST be referenced from the root `tsconfig.json`.

## Negative example

Adding a chat history sync feature directly inside `@senn/core` violates the
charter (no server-side storage of dynamic data) and the layering rule above
(Core MUST stay transport-only). Such a feature must live as an add-on under
`addons/official/` or a third-party add-on, talking to peers through the Core
add-on API.
