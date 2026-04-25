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

## Negative example

Do **not** publish a release if any check in the pre-flight failed, or if
any ADR touched in the release is still `Proposed`. Ship-blocking checks
exist for a reason; if you think one is wrong, change the check, do not
skip it.
