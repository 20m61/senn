# Release Process

## Intent

Cut a SENN release reproducibly. Pre-alpha releases are tagged from
`develop`; once `main` is opened for releases, releases are merged from
`develop` to `main` via PR (per CLAUDE.md branch policy).

## Pre-flight (MUST pass)

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm validate:addon examples/minimal-addon/manifest.json
# Once present:
pnpm validate:addon addons/official/local-profile/manifest.json
pnpm validate:addon addons/official/local-vault/manifest.json
pnpm validate:addon addons/official/whiteboard/manifest.json
pnpm validate:addon addons/official/avatar-presence/manifest.json
```

## Versioning

- Pre-alpha: `0.0.x`. Bump `x` for any user-visible change.
- Alpha: `0.<minor>.<patch>` once the protocol envelope, manifest schema,
  and permission set are first stabilized.
- Beta / 1.0.0: gated on an ADR that explicitly opens stability.

All workspace packages share a single version line during pre-alpha and
alpha.

## Steps

1. Create a release branch off `develop`:

   ```sh
   git switch develop
   git pull --ff-only
   git switch -c release/0.0.x
   ```

2. Bump versions across the workspace:

   ```sh
   pnpm -r exec npm version 0.0.x --no-git-tag-version
   ```

3. Regenerate `THIRD_PARTY_LICENSES.md`:

   ```sh
   pnpm tsx scripts/generate-third-party-licenses.ts > THIRD_PARTY_LICENSES.md
   ```

4. Update `docs/roadmap.md` to reflect what shipped.

5. Update ADR statuses if any moved from `Proposed` → `Accepted`.

6. Commit:

   ```
   chore(release): 0.0.x
   ```

7. Open a PR `release/0.0.x` → `develop` (or `develop` → `main` once `main`
   is open). Reviewers run pre-flight again.

8. After merge, tag from the merge commit:

   ```sh
   git tag -a v0.0.x -m "SENN v0.0.x"
   git push origin v0.0.x
   ```

## Add-on releases

Each add-on under `addons/official/*` releases independently with its own
SemVer. The release process is the same pre-flight + manifest validator,
but no workspace-wide version bump is involved.

## `@senn/addon-sdk` releases (ADR-0019)

The SDK publishes to public npm under the `@senn` scope on its own
cadence, independent of the host-application release train. Tag namespace
is `addon-sdk-v<semver>` so future publishable packages can co-exist.

### Pre-publish checklist

- `packages/addon-sdk/package.json#private` is `false` (or the field is
  removed). The first release MUST flip this; CI rejects a tagged build
  that still has `private: true`.
- Version bump landed on `develop` then merged to `main` in the same PR
  that adds the surface change.
- `pnpm verify:addon-sdk` passes locally (CI runs it again on tag
  push). Both ADR-0018 shape and ADR-0019 §6 guards are checked.
- `npm whoami` shows an account that owns `@senn/addon-sdk` on npmjs.com,
  with 2FA enabled.

### Tag and publish

After the version-bump PR merges to `main`:

```sh
git switch main
git pull --ff-only
git tag -a "addon-sdk-v0.1.0" -m "@senn/addon-sdk 0.1.0"
git push origin "addon-sdk-v0.1.0"
```

The tag push triggers `.github/workflows/publish-addon-sdk.yml`, which:

1. checks out the tagged ref,
2. asserts `packages/addon-sdk/package.json#version` matches the tag,
3. runs `pnpm typecheck`, `pnpm verify:addon-sdk`, `pnpm lint`, `pnpm test`,
4. `pnpm pack`s the package and prints the tarball contents,
5. runs `pnpm publish --no-git-checks` with `provenance: true` (set in
   `publishConfig`), using `secrets.NPM_TOKEN`.

The workflow has `id-token: write` so npm provenance can mint a Sigstore
certificate attesting the tarball came from this workflow run.

### Pre-releases

Pre-release versions (e.g., `0.2.0-rc.1`) MUST publish under the npm
`next` dist-tag, not `latest`. To do so manually after a successful CI
build, override the tag with:

```sh
pnpm --filter @senn/addon-sdk publish --tag next --no-git-checks
```

For now this is a one-off command; if pre-releases become routine, fold
the dist-tag selection into the workflow.

### Hotfix

A patch version (`0.1.0 → 0.1.1`) follows the same path. There is no
separate hotfix branch; bump on `develop`, PR to `main`, tag.

### Rollback

`npm` does not support unpublishing a published version after 72 hours.
For accidental or broken releases, use `npm deprecate`:

```sh
npm deprecate "@senn/addon-sdk@0.1.0" "broken release; use 0.1.1"
```

This keeps the tarball resolvable (so existing lockfiles still install)
but warns new consumers. Hard removal is not in the trust model — yanking
goes via the registry, not via the SDK.

## Negative example

Do **not** publish a release if any check in the pre-flight failed, or if
any ADR touched in the release is still `Proposed`. Ship-blocking checks
exist for a reason; if you think one is wrong, change the check, do not
skip it.
