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

## 0.1.1 — TBD _(unpublished; staged for first signed release)_

The package public surface is **unchanged from 0.1.0**. This patch
exists to activate the vendor-neutral provenance flow defined by
[ADR-0023](../../docs/adr/0023-vendor-neutral-provenance.md) and the
default-tool choice in
[ADR-0025](../../docs/adr/0025-release-signing-tool-default.md): once
the maintainer ships this version with `SENN_SIGN_RELEASE=minisign`,
both ADRs flip from Proposed/Accepted to Implemented.

### What's in 0.1.1

- No source change. `dist/`, `runtime/`, `src/`, the `exports` map,
  every type, every constant, and every public surface bullet under
  the 0.1.0 release notes below are byte-identical aside from the
  version field bump.
- `package.json#version`: 0.1.0 → 0.1.1.
- This CHANGELOG entry.

### Why a no-source-change release

ADR-0023 §"Implementation status" and ADR-0025 §"Status" both gate
their next status transition on the **first** release that ships a
signed `.sig` + `.cert` artefact attached to its GitHub Release plus
a filled-in `docs/governance.md` "Release signing identities" row.
The current 0.1.0 release tarball is already on npm and cannot be
re-released; it can only be signed-after-the-fact out-of-band, which
would not exercise the publish-script provenance path the ADRs are
validating. A 0.1.1 patch with no source change is the smallest
reviewable unit that exercises the path end-to-end.

### Maintainer activation steps (must complete before tagging)

1. Generate a minisign keypair (one-time):
   ```sh
   minisign -G \
     -p docs/release-keys/sennjs-addon-sdk.pub \
     -s ~/.minisign/sennjs-addon-sdk.key
   ```
   The public key is committed to the repo (small text file). The
   private key MUST stay outside the repo (covered by the existing
   `keys/**` ignore rule, but the `~/.minisign/` location keeps it
   well outside the working tree regardless).
2. Add a row to `docs/governance.md` "Release signing identities"
   (currently `_none yet_`) with the public-key fingerprint and an
   `Active from` date matching the planned release date.
3. Land both files in a small follow-up PR before tagging.

### Maintainer release procedure

```sh
# from a clean checkout of the merge commit that lands this CHANGELOG
git tag -a addon-sdk-v0.1.1 -m "@sennjs/addon-sdk 0.1.1"
git checkout addon-sdk-v0.1.1

SENN_SIGN_RELEASE=minisign \
SENN_SIGN_KEY=~/.minisign/sennjs-addon-sdk.key \
SENN_SIGN_PUBKEY=docs/release-keys/sennjs-addon-sdk.pub \
pnpm release:addon-sdk addon-sdk-v0.1.1
```

After `pnpm publish` succeeds, the script stages
`dist/release/senn-addon-sdk-0.1.1.{tgz,tgz.sig,tgz.cert}` (gitignored).
Upload all three to the GitHub Release for `addon-sdk-v0.1.1` and
cross-check the cert against the governance.md row.

### Status-flip PR

After the signed release is live, open
`docs(adr): promote ADR-0023 / ADR-0025 to Implemented` citing the
merge commit of this 0.1.1 prep PR + the GitHub Release URL.

## 0.1.0 — 2026-04-27 _(published 2026-04-30T00:16:19Z)_

Initial public release. Establishes the package shape pinned by
ADR-0018 and the version policy of ADR-0019. Renamed to
`@sennjs/addon-sdk` before first publish (see scope note above).
Tag: `addon-sdk-v0.1.0` (commit 295c87b).

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
