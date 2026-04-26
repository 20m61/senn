# SENN

SENN is an open-source browser-native P2P runtime for static add-ons and direct peer data flow.

SENN lets users connect directly from their browsers and exchange messages, files, presence, voice, and add-on events without storing dynamic communication data on application servers.

## Concept

線でつながる。サーバに預けない。

SENN provides a lightweight communication core where:

- Static add-ons create experiences.
- The Core manages secure data flow.
- Dynamic data moves directly between peers.
- Local storage is user-controlled.
- Servers only distribute static assets, metadata, and trusted registries.

## What is SENN?

SENN is not just a chat app.
It is a P2P experience runtime that enables third-party developers to create static add-ons such as:

- Whiteboards
- Avatar presence
- XR rooms
- File vaults
- Local-first notes
- Event tools
- Games
- Learning tools
- Creative communication spaces

Add-ons do not create their own network connections.
All dynamic data flow is handled by SENN Core through permission-controlled P2P APIs.

## Principles

- Open core
- Browser-first
- P2P by default
- No server-side storage of dynamic communication data
- Static add-ons
- Core-managed data flow
- Sandboxed add-on execution
- Permission-based APIs
- Local-first persistence
- Local-first development and release (no CI/CD vendor dependency)
- Community-driven ecosystem

## Local-first development

SENN does not depend on any specific CI/CD vendor or hosted-pages
provider. The project's correctness contract is enforced **locally**:

- **Conformance**: `pnpm conformance` (`scripts/conformance.sh`) is the
  authoritative gate — typecheck, lint, manifest validators,
  forbidden-API grep, signature verifier, registry schema, addon-sdk
  shape, drift checks, and workspace tests. The pre-push git hook
  under `.githooks/` runs it automatically. (See
  [ADR-0021](docs/adr/0021-local-first-conformance.md) and
  [docs/dev/conformance.md](docs/dev/conformance.md).)
- **Release**: `pnpm release:addon-sdk <tag>`
  (`scripts/publish-addon-sdk.sh`) publishes `@senn/addon-sdk` from a
  maintainer machine — no GitHub Actions workflow, no `NPM_TOKEN`
  secret on the repository. (See
  [ADR-0022](docs/adr/0022-local-first-publish-pipeline.md) and
  [docs/dev/release.md](docs/dev/release.md).)
- **Static deploy**: `pnpm build` + `pnpm stage:gallery-static`
  produces a self-contained `dist/` directory deployable to any static
  host (object storage, shared rental host, IPFS, intranet file
  server, …). The web app and gallery name no specific host.

Forks MAY add a CI vendor mirror in their fork, but the canonical
repository ships no `.github/workflows/` or equivalent vendor-specific
configuration. A fork without any CI is fully capable of producing a
conformant release.

## Repository Layout

```
packages/      core libraries (@senn/core, protocol, addon-sdk, ...)
apps/          web app and add-on gallery
addons/        official add-ons
examples/      example add-ons and PoCs
docs/          charter, specifications, ADRs
scripts/       repo tooling (manifest validation, license checks, ...)
```

See [docs/overview.md](docs/overview.md) and [docs/architecture.md](docs/architecture.md) for details.

## Developer Docs

- [docs/dev/](docs/dev/) — entry point for contributors and AI coders
  - [Getting started](docs/dev/getting-started.md)
  - [Workspace guide](docs/dev/workspace-guide.md)
  - [Writing an add-on](docs/dev/writing-an-addon.md) · [Hands-on tutorial](docs/dev/getting-started-addon.md) · [Cookbook](docs/dev/addon-cookbook.md)
  - [AI-driven add-on development](docs/dev/ai-driven-addon-development.md)
  - [Signaling adapter guide](docs/dev/signaling-adapter.md) · [Deployment tiers](docs/deployment.md)
  - [Conformance](docs/dev/conformance.md) · [Spec authoring](docs/dev/spec-authoring.md) · [Release](docs/dev/release.md)

## Try it locally

```sh
git clone https://github.com/20m61/senn.git
cd senn
pnpm install
pnpm dev
```

Open the URL Vite prints (default `http://localhost:5173`) in two
browser windows, copy the invite link from one to the other, and you
have a peer-to-peer SENN session — no relay server, no account.

For a deeper walkthrough see
[docs/dev/getting-started.md](docs/dev/getting-started.md).

## Status

[**v0.1.0**](https://github.com/20m61/senn/releases/tag/v0.1.0) — initial
public release. The wire layer is implemented end-to-end:

- 7 packages (`@senn/protocol`, `@senn/core`, `@senn/manifest`,
  `@senn/storage`, `@senn/addon-runtime`, `@senn/addon-sdk`,
  `@senn/signaling-{url-fragment,http-poll,nostr}`).
- 7 official add-ons (echo, whiteboard, avatar-presence, local-vault,
  voice-meter, voice-call, minimal) signed under the official trust
  root and shipped through `addons/official/index.json`.
- 15 ADRs Accepted (incl. ADR-0014 federated Nostr signaling and
  ADR-0015 cross-peer audio + video tracks), 12 normative spec pages,
  public privacy.md.
- Conformance gates: typecheck + biome lint + vitest (93 tests across
  the 7 packages) + Playwright e2e on Chromium / Firefox / WebKit +
  manifest validator + forbidden-API grep + sig verifier — all wired
  to local git hooks (`.githooks/{pre-commit,commit-msg,pre-push}`),
  no CI vendor required.
- A static `pnpm --filter @senn/web build` produces a ~76 KB
  (gzip 24 KB) JS bundle plus addon assets, deployable to any static
  host (see `docs/deployment.md`).

API surface and the wire format are still subject to change before
1.0; ADR amendments will be additive when possible (see ADR-0010 / 0012).

## License

Apache License 2.0. See [LICENSE](LICENSE).
