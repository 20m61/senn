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
- Community-driven ecosystem

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
  - [Writing an add-on](docs/dev/writing-an-addon.md) · [Cookbook](docs/dev/addon-cookbook.md)
  - [AI-driven add-on development](docs/dev/ai-driven-addon-development.md)
  - [Signaling adapter guide](docs/dev/signaling-adapter.md) · [Deployment tiers](docs/deployment.md)
  - [Conformance](docs/dev/conformance.md) · [Spec authoring](docs/dev/spec-authoring.md) · [Release](docs/dev/release.md)

## Status

Pre-alpha / concept stage.

## License

Apache License 2.0. See [LICENSE](LICENSE).
