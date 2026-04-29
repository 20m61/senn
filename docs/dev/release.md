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

## `@senn/addon-sdk` releases (ADR-0019 + ADR-0022)

The SDK publishes to public npm under the `@senn` scope on its own
cadence, independent of the host-application release train. Tag namespace
is `addon-sdk-v<semver>` so future publishable packages can co-exist.

ADR-0022 supersedes ADR-0019 §5: the publish flow runs **locally** from a
maintainer machine, not from a CI vendor. The maintainer is the trust
boundary; their npm account, npm 2FA prompt, and `~/.npmrc` are the
only credentials in play.

### Pre-publish checklist

- `packages/addon-sdk/package.json#private` is `false` (or the field is
  removed). The first release MUST flip this; the publish script rejects
  a tagged build that still has `private: true`.
- Version bump landed on `develop` then merged to `main` in the same PR
  that adds the surface change.
- `pnpm conformance` passes locally on the tagged commit. The publish
  script re-runs it, so a stale checkout cannot publish.
- `npm whoami` shows an account that owns `@senn/addon-sdk` on npmjs.com,
  with 2FA enabled.

### Tag and publish

After the version-bump PR merges to `main`:

```sh
git switch main
git pull --ff-only
git tag -a "addon-sdk-v0.1.0" -m "@senn/addon-sdk 0.1.0"
git checkout "addon-sdk-v0.1.0"

# This runs the local publish gate end-to-end:
#   1. refuse if working tree is dirty
#   2. refuse if HEAD is not on the named tag
#   3. assert package.json#version matches the tag
#   4. assert private:true is removed
#   5. pnpm install --frozen-lockfile && pnpm conformance
#   6. pnpm pack and verify the tarball is non-empty
#   7. confirm with the operator before invoking npm publish
#   8. pnpm publish --tag <dist-tag> --access public --no-git-checks
pnpm release:addon-sdk addon-sdk-v0.1.0

# After successful publish, push the tag for archival reference.
git push origin "addon-sdk-v0.1.0"
```

The publish script (`scripts/publish-addon-sdk.sh`) is vendor-neutral:
it depends only on `bash`, `git`, `node`, `pnpm`, and the npm CLI. It
does not require GitHub Actions, OIDC, or any CI runner.

### Pre-releases

Pre-release versions (e.g., `0.2.0-rc.1`) MUST publish under the npm
`next` dist-tag, not `latest`. Pass the dist-tag as the second argument:

```sh
pnpm release:addon-sdk addon-sdk-v0.2.0-rc.1 next
```

### Hotfix

A patch version (`0.1.0 → 0.1.1`) follows the same path. There is no
separate hotfix branch; bump on `develop`, PR to `main`, tag, run
`pnpm release:addon-sdk addon-sdk-v0.1.1`.

### npm provenance

The local publish flow does **not** mint an npm provenance attestation
(provenance requires a CI runner with OIDC, which would re-introduce a
vendor dependency). The integrity claim that survives instead is:

- the git tag is annotated and `git tag -v` MUST verify against a
  maintainer's signed commit history;
- the published tarball MUST be reproducible by anyone running
  `pnpm release:addon-sdk <tag>` from a clean checkout of the same tag;
- every add-on that ships the runtime byte-equally
  (`pnpm verify:addon-sdk`) provides a second integrity surface via
  ADR-0008 manifest signatures.

This is a deliberate ADR-0022 trade: trust the maintainer + git +
manifest-signing, instead of trust the CI vendor.

### Vendor-neutral provenance (ADR-0023, opt-in)

A third integrity surface is **opt-in per release**: a detached
maintainer signature over the exact tarball bytes, published to the
GitHub Release for the tag (not to npm). The publish script stages
it under `dist/release/` (gitignored) when the maintainer toggles
the env vars below; uploading the artefacts to the Release page is a
manual step.

Activate by exporting these before running `pnpm release:addon-sdk`:

```sh
export SENN_SIGN_RELEASE=cosign       # or: minisign | gpg
export SENN_SIGN_KEY=/path/to/key     # cosign/minisign secret-key file,
                                      # or gpg key id/fingerprint
# minisign only — maintainer's public-key file, copied into .cert:
export SENN_SIGN_PUBKEY=/path/to/minisign.pub
```

Output (after a successful `pnpm publish`):

```
dist/release/senn-addon-sdk-<v>.tgz       # bytes identical to npm
dist/release/senn-addon-sdk-<v>.tgz.sig   # detached signature
dist/release/senn-addon-sdk-<v>.tgz.cert  # tool-specific verification material
```

Then upload all three files to the GitHub Release for the matching
`addon-sdk-v<v>` tag and confirm the signing identity against
[`docs/governance.md` "Release signing identities"](../governance.md#release-signing-identities-adr-0023).

If the env vars are unset, the script's behaviour is unchanged from
ADR-0022: no signing tool is invoked, no extra files are written.
Downstreams that did not opt into provenance verification still get
the two integrity surfaces from the previous section.

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
