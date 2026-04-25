# Getting Started

## Intent

Bring up the SENN monorepo locally, run the PoC web app, and verify that
typecheck, lint, and the manifest validator all pass. Required before any
development work.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 22 | LTS recommended |
| pnpm | ≥ 9 | `corepack enable && corepack prepare pnpm@9 --activate` |
| git | any recent | for branching and commits |
| A modern browser | Chrome / Firefox / Safari current | required for WebRTC PoC |

## Steps

```sh
git clone https://github.com/20m61/senn.git
cd senn
pnpm install
pnpm typecheck
pnpm lint
pnpm validate:addon examples/minimal-addon/manifest.json
pnpm dev
```

Open the URL printed by Vite (default `http://localhost:5173`).

You should see the SENN tagline and a line reading
`Core <version> · Protocol <version>`. That confirms the workspace and the
TypeScript module graph are wired correctly.

## Branching

- Do not commit directly to `main`. Use `develop` or a topic branch:
  - `feature/<short-name>` for new functionality
  - `fix/<short-name>` for bug fixes
  - `docs/<short-name>` for spec / docs work
  - `refactor/<short-name>` for non-behavioral changes

## Conformance

Before opening a PR, all of the following MUST pass:

```sh
pnpm typecheck
pnpm lint
pnpm validate:addon <each manifest you touched>
pnpm test    # noop today; do not skip when tests land
```

## Negative example

Do **not** start work without `pnpm install`. Editors and AI coders will
hallucinate imports for packages that the lockfile would have flagged as
missing. If your first PR introduces an undeclared dependency, the license
check will reject it (see [/docs/license-policy.md](../license-policy.md)).
