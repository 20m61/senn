# ADR 0016: Add-on gallery — discovery, trust display, install hand-off

## Status

Accepted (design only; implementation lands as `apps/addon-gallery`
under task D following this ADR).

## Context

The [Charter](../charter.md) Mission and
[ecosystem-business-model](../ecosystem-business-model.md) call out a
"Verified Add-on Registry" + "Gallery" as part of the open trust layer.
[Roadmap](../roadmap.md) Phase 5 lists *Gallery* and *Community
submission flow*.

What exists today (v0.1.0):

- A signed publisher index at `addons/official/index.json` listing 7
  add-ons under one Ed25519 trust root (`pnpm verify:official` enforces
  signature integrity in CI; ADR-0008 / 0009 / 0010 define the signing
  scheme and key rotation).
- The web app `apps/web` already has a *registry-driven launcher*: it
  fetches the official registry, renders a button per add-on, and loads
  each add-on with `verify=required` against the registry's trusted
  keys.
- The directory `apps/addon-gallery/` exists as an empty scaffold (no
  `package.json`, only `src/`).

What is missing:

- A standalone **discovery surface** users can land on without already
  having a SENN host running. Today the only way to discover add-ons is
  to clone the repo or to open a host that has hard-coded the official
  registry URL.
- A **trust-display contract** so a visitor can read *who signed what*
  before deciding whether to use a given add-on.
- A documented **install hand-off** from the gallery to a SENN host so
  add-ons authored by third parties (under different trust roots) can
  flow into a host without that host needing to hard-code their URLs.

This ADR fixes the design before code lands so the implementation has
clear contracts.

## Decision

### 1. Scope and shape

The add-on gallery is a **static browser app** at `apps/addon-gallery/`.
It is itself a SENN deliverable: built from the same monorepo, served
from any static host, no backend, no account, no server-side state.

It is **read-only in v1**. Discovery, trust display, and a deep-link
hand-off into a SENN host are in scope. Add-on submission, moderation,
and reviews are explicitly out of scope (see §7).

### 2. Trust model

The gallery does **NOT** mint or hold any signing key. It does not sign
anything. Its only role with respect to trust is to:

- Fetch one or more publisher registries (default: the official
  `addons/official/index.json` shipped from the SENN project repo).
- Display each registry's `publisher` and `trustedKeys` *prominently*
  next to every add-on it lists, along with the version and the
  `signedAt` timestamp from the served `manifest.sig.json`.
- Re-verify the served `manifest.sig.json` against the served
  `manifest.json` *in the browser* using the same `@senn/manifest`
  verification routine the web app uses (`verifyManifest`). A registry
  whose entries fail verification renders with a red "verification
  failed" badge — the gallery does not silently downgrade.

The gallery never embeds a trust root of its own. The user's trust
decision is always against the *publisher* of the registry, never
against the gallery operator.

### 3. Multi-registry aggregation

The gallery accepts a **list of registry URLs** (each pointing at a
publisher index in the schema documented at
`addons/official/README.md`). Default list: the project's official
registry. The user may add additional registry URLs through the UI;
those additions persist in `localStorage` only and never leave the
device.

Aggregation is purely client-side. Each registry is fetched
independently; failures isolate per-registry. The gallery does **not**
de-duplicate addons across registries by `id` — instead it shows each
hit grouped under its registry's publisher banner so users can see
*who* publishes a given id and decide which one they want.

### 4. Install hand-off

Hand-off from the gallery to a SENN host happens through a **standard
deep-link query string** the host application understands:

```
<host_origin>/?addon=<manifest_url>&publisher=<registry_url>
```

- `addon` is the absolute URL of the add-on's `manifest.json`.
- `publisher` is the absolute URL of the registry whose `trustedKeys`
  the host should consult during `verify=required` load.

The host treats the `publisher` parameter as a **proposal**, not a
command: it MUST display the publisher's name and trustedKeys to the
user and require a one-click confirmation before loading the add-on
under that trust root. (This mirrors the existing UX: the official
launcher already shows the publisher name and trusts only its keys.)

The web app `apps/web` will gain support for these query params in a
follow-up; until then the gallery emits the same URL form so existing
hosts can pre-implement support.

A host that does not implement the hand-off still gets a working
fall-back: the gallery shows a copyable manifest URL so a power user
can paste it into the host they trust.

### 5. UI surface (informative)

The gallery presents:

1. A **registry list** along the left with the publisher name and the
   trustedKey fingerprint.
2. A **search/filter bar** across the union of all listed add-ons. At
   minimum: free-text on `name` and `description`, filter by
   `capabilities`, filter by registry.
3. An **add-on card** per hit, showing: id, name, version, description,
   capabilities, declared permissions (read from the manifest), the
   signing key fingerprint, the `signedAt` timestamp, a verification
   status badge, and an **"Open in SENN host"** button that takes the
   user's preferred host origin (last-used host saved in
   `localStorage`, default empty) and emits the hand-off URL described
   in §4.

### 6. Forbidden behaviours (normative)

The gallery MUST NOT:

- Run the add-on's code itself. The gallery is a discovery surface,
  not a SENN host.
- Re-host or proxy add-on bytes. Cards link directly to the publisher's
  origin so the user's browser establishes its own connection.
- Emit telemetry, analytics, or any third-party requests. (The gallery
  participates in the same `connect-src 'none'` posture as
  `apps/web`'s addons.)
- Persist anything beyond the user's own configuration (registry list,
  preferred host) in `localStorage`.
- Require an account or login.

### 7. Out of scope (explicitly deferred)

The following are **not** in this ADR. They will be addressed by
follow-up ADRs when the need is concrete:

- **Add-on submission flow.** For now, contributing to the official
  registry is "open a PR against `addons/official/index.json` in this
  repo". Community registries do their own thing — outside SENN's
  scope.
- **Moderation / reviews / ratings.** A trust layer based on community
  reputation is a substantial design space; this ADR avoids
  half-doing it.
- **Curated cross-publisher meta-registries.** If they emerge, they
  describe themselves as "publishers" in the same schema and slot in
  through §3.
- **Paid add-ons / payment rails.** Out of scope of the open core (see
  ecosystem-business-model.md "Trust Layer / Enterprise Layer").

### 8. Conformance

The gallery MUST pass the same conformance gates as the rest of the
monorepo: `pnpm typecheck`, `pnpm lint`, `pnpm validate:all-manifests`,
and (where applicable) `pnpm verify:official`. The implementation under
task D adds the gallery to those gates without weakening any.

## Consequences

- A new `apps/addon-gallery` workspace with its own `package.json`,
  Vite config, TypeScript project, and Playwright e2e (smoke).
- A **deep-link query-string spec** that becomes part of the SENN host
  contract (`apps/web` follow-up). Once specified here, this is a
  vendor-neutral hand-off any third-party SENN host can implement;
  ADR-0007's vendor-neutrality principle continues to hold because the
  gallery is *just one* discovery surface among many a user might use.
- The gallery can be deployed independently of the main web app (e.g.
  to GitHub Pages under a different path) without splitting the
  publisher trust root: the trust still resides in the registry's
  `trustedKeys`, and the gallery only re-renders that trust.

## Alternatives considered

- **Bake the gallery into `apps/web`.** Rejected: the gallery is a
  discovery surface that benefits from being usable *without* booting
  a peer session. Conflating the two muddies both UX and the security
  story (the gallery's `connect-src` constraints differ from the
  host's).
- **Server-backed catalogue.** Rejected: violates the "no server-side
  storage of dynamic communication data" principle and would
  reintroduce a vendor SENN cannot avoid.
- **Submission flow inside the gallery (web form posts to a service).**
  Rejected for v1: requires a backend and moderation policy. PR-based
  contributions to publisher registries already work and stay
  vendor-neutral.

## References

- ADR-0007 — vendor-neutral signaling and relay
- ADR-0008 / ADR-0009 / ADR-0010 — add-on signing, keystore, key
  rotation
- `addons/official/README.md` — registry schema
- `apps/web/src/main.ts` — existing registry-driven launcher
  (reference implementation of host-side hand-off)
