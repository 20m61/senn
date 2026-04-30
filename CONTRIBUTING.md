# Contributing to SENN

Thank you for your interest in SENN. This project is in pre-alpha and the core
specifications are still evolving — feedback on the design documents in `docs/`
is as valuable as code contributions.

## Ground Rules

- Read [docs/charter.md](docs/charter.md) and [docs/adr/0001-project-principles.md](docs/adr/0001-project-principles.md) before proposing changes.
- Open an issue or discussion before starting non-trivial work.
- Follow [docs/license-policy.md](docs/license-policy.md) for any new dependency.
- All contributions are licensed under Apache-2.0 (see [LICENSE](LICENSE)).
- Be kind. We follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Branch Strategy

- `main` is release-only. Do not commit or push directly.
- Active work happens on `develop` and topic branches: `feature/*`, `fix/*`, `refactor/*`, `docs/*`, `chore/*`.
- Releases are merged into `main` via pull request from `develop`.

## Commit Messages

Use Conventional Commits style:

```
feat: <subject>
fix: <subject>
docs: <subject>
refactor: <subject>
test: <subject>
chore: <subject>
```

Keep subjects short and write the body in English.

## Pull Requests

- Reference related issues.
- Keep PRs focused; split large changes.
- Update relevant docs and ADRs when you change behavior or architecture.
- Run `pnpm conformance` locally before pushing (the pre-push git hook
  runs it automatically — `pnpm install` wires the hook up via the
  `prepare` script). The hook's pass is the ship contract; the
  repository ships no CI vendor configuration (ADR-0021), so the local
  run is the only authoritative gate.
- Ensure manifest validators, license checks, and tests pass.

## End-to-end tests (on demand)

Playwright e2e is intentionally **not** part of `pnpm conformance` —
it takes ~25 minutes per browser and would dominate the gate. PRs
that touch the reference web app (`apps/web/`) or the add-on gallery
(`apps/addon-gallery/`) MUST be exercised by the author and reviewer
locally before merge:

```sh
pnpm --filter @senn/web e2e --project=chromium
pnpm --filter @senn/addon-gallery exec playwright test --project=chromium
```

Run on `firefox` / `webkit` projects when the change touches platform-
specific surfaces (`getUserMedia`, file pickers, ICE behaviour). The
project does not pay for cloud CI minutes (ADR-0022 trust boundary), so
e2e coverage on UI-touching PRs is an explicit reviewer responsibility.

## Code Style

- TypeScript over JavaScript. `const` > `let`, no `var`.
- Prefer browser standard APIs over dependencies (see license policy).
- Format with biome (TS/JS) and ruff (Python tooling).

## Add-on Contributions

If you are submitting an add-on for the official registry, see
[docs/addon-spec.md](docs/addon-spec.md) for manifest and permission rules,
and run `scripts/validate-addon-manifest.ts` against your manifest.

## AI-Assisted Contributions

This repository ships project-scoped Claude Code configuration. If you
contribute via Claude Code (or another agent that respects `CLAUDE.md`),
your session loads the SENN-specific guardrails automatically:

- The slash commands `/senn-conformance`, `/senn-validate`, `/senn-addon-new`,
  `/senn-adr-new`, `/senn-spec-review`, `/senn-sign-check`, and `/senn-pr`.
- Subagents `sdd-expert`, `addon-builder`, `conformance-runner`, `adr-author`.
- PreToolUse hooks that block edits to `keys/`, `*.key.json`, `.env*`
  (except `.env.example`), pushes to `main`, force-push, `--no-verify`, and
  package publishing.

See [docs/dev/README.md §AI-driven](docs/dev/README.md) for the full surface
and [docs/dev/ai-driven-addon-development.md](docs/dev/ai-driven-addon-development.md)
for the add-on workflow.
