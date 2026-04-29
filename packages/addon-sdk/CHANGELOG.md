# `@sennjs/addon-sdk` Changelog

All notable changes to the `@sennjs/addon-sdk` npm package are recorded
here. The package follows [SemVer 2.0.0](https://semver.org/) per
[ADR-0019 §3](../../docs/adr/0019-publish-pipeline.md).

> **Scope note (2026-04-30):** the package is published as
> `@sennjs/addon-sdk`, not `@senn/addon-sdk`. The `@senn` npm
> organisation is registered to an unrelated account and cannot be
> reassigned without a trademark dispute, so the project moved to
> `@sennjs` per ADR-0019 §2.

The release flow itself is documented in
[`docs/dev/release.md`](../../docs/dev/release.md) and is governed by
[ADR-0022](../../docs/adr/0022-local-first-publish-pipeline.md) (local-
first, no CI vendor dependency).

## 0.1.0 — 2026-04-27

Initial public release. Establishes the package shape pinned by
ADR-0018 and the version policy of ADR-0019. Renamed to
`@sennjs/addon-sdk` before first publish (see scope note above).

### Public surface

- The classic-script runtime (`runtime/senn-addon-sdk.js`) ships
  alongside the typed ESM entry point (`dist/index.js`,
  `dist/index.d.ts`). Both are pinned to the same SemVer line; see
  [ADR-0018 §"Two-part export surface"](../../docs/adr/0018-addon-sdk-types.md).
- `SennAddonContext`, `SennDeliverEvent`, `SennDeliverBinEvent`,
  `SennAddonGlobal`, and `SENN_ADDON_SDK_VERSION` are exported as
  the v1 type surface.
- `exports` map locks the file paths consumers may import; nothing
  else in the package is part of the supported surface.

### Packaging

- `private: true` removed; `version` bumped from `0.0.0` to `0.1.0`.
- Stale `@senn/protocol` `workspace:*` dependency removed — the SDK
  source has not imported from `@senn/protocol` (a workspace-internal
  package, unrelated to the published scope rename) since the type
  surface was self-contained in ADR-0018, and shipping the
  `workspace:*` reference would have produced a tarball that could
  not resolve its dependencies on registry consumers.
- `publishConfig.provenance` is intentionally NOT set — see
  [ADR-0022 §"npm provenance"](../../docs/adr/0022-local-first-publish-pipeline.md)
  for the vendor-neutral rationale, and
  [ADR-0023](../../docs/adr/0023-vendor-neutral-provenance.md) for
  the optional maintainer-signed provenance follow-up.

### Install

```sh
pnpm add -D @sennjs/addon-sdk
# or
npm install --save-dev @sennjs/addon-sdk
```

### Release procedure

This release follows the gate sequence defined in
[`docs/dev/release.md`](../../docs/dev/release.md): `pnpm conformance`
on the tagged commit, then `pnpm release:addon-sdk addon-sdk-v0.1.0`
re-runs the same gate from a clean checkout before invoking
`npm publish` (ADR-0022 §2).
