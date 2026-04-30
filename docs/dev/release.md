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

## `@sennjs/addon-sdk` releases (ADR-0019 + ADR-0022)

The SDK publishes to public npm under the `@sennjs` scope (renamed
from `@senn/addon-sdk` on 2026-04-30; ADR-0019 §2 amendment records
the rename rationale). Releases run on their own cadence, independent
of the host-application release train. Tag namespace is
`addon-sdk-v<semver>` so future publishable packages can co-exist.

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
- `npm whoami` shows an account that owns `@sennjs/addon-sdk` on
  npmjs.com (i.e., is a member of the `sennjs` org), with 2FA enabled.

### Tag and publish

After the version-bump PR merges to `main`:

```sh
git switch main
git pull --ff-only
git tag -a "addon-sdk-v0.1.0" -m "@sennjs/addon-sdk 0.1.0"
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
npm deprecate "@sennjs/addon-sdk@0.1.0" "broken release; use 0.1.1"
```

This keeps the tarball resolvable (so existing lockfiles still install)
but warns new consumers. Hard removal is not in the trust model — yanking
goes via the registry, not via the SDK.

### Troubleshooting (publish-time pitfalls captured during 0.1.0 prep)

The first publish surfaced several gotchas worth recording so future
maintainers — or anyone setting up `@sennjs/addon-sdk` from a fresh
maintainer machine — do not have to rediscover them.

#### `npm login` fails on WSL2 with `sensible-browser` error

```
npm error command sh -c sensible-browser '...'
npm error code 1
```

Cause: npm v9+ defaults to `auth-type=web`. WSL2 has no
`sensible-browser`. Setting `BROWSER=...` does NOT help — npm v11
ignores the env var. Setting `npm config set browser /mnt/c/...` does
NOT help either (a known npm v11 regression: the config value is not
passed through to the spawn).

Fix: switch to legacy auth-type for the login step:

```sh
npm login --auth-type=legacy
# or persistently:
npm config set auth-type legacy
```

#### `npm publish` triggers `web auth flow` even with a token in `~/.npmrc`

Symptom: publish prints
`Authenticate your account at: https://www.npmjs.com/auth/cli/...` and
fails with `404 Not Found - GET .../v1/done?authId=***`.

Cause: with `auth-type=web`, `npm publish` triggers the same web flow
as `npm login` for the 2FA challenge — even when a token is set.

Fix: `npm config set auth-type legacy`. Combined with a Granular
Access Token that has "Allow this token to bypass two-factor
authentication" enabled, publish becomes non-interactive.

#### `npm publish` requests an OTP that the maintainer cannot provide

Symptom: `npm` prompts for a 6-digit OTP after `Proceed?`.

Cause: the maintainer's 2FA method is **passkey only** (no TOTP), and
the Granular Access Token does NOT have "Allow this token to bypass
two-factor authentication" enabled. The CLI cannot satisfy the OTP
prompt with a passkey.

Fix: revoke the token, generate a new Granular Access Token, and
**explicitly check** the "Allow this token to bypass two-factor
authentication" box. Update `~/.npmrc` with the new token.

#### `pnpm publish` returns `404 PUT https://registry.npmjs.org/@sennjs%2faddon-sdk`

Symptom:

```
npm error 404 The requested resource '@sennjs/addon-sdk@0.1.0' could
not be found or you do not have permission to access it.
```

Most likely causes (in order of frequency):

1. **Granular token's "Selection mode" is "Specific Packages and
   Scopes"** instead of "All packages and scopes". Specific-mode
   tokens cannot **create** new packages, only modify existing ones.
   Re-issue the token with **"All packages and scopes"** + "Read and
   write".
2. **The `@senn` org does not exist (yet) on npm.** A new maintainer
   account is subject to a ~7-day anti-fraud hold before npm allows
   org creation; the response to `npm org create senn` is `creation
   denied. Please contact support`. Fix: open a support ticket at
   https://npmjs.com/support requesting that org creation be unlocked
   for the account, citing the open-source project context. Wait for
   the response (typically 1–3 business days). Until then, publish is
   blocked at the registry side.
3. **The token has insufficient permission for the org's scope.** Owners
   of the org can re-issue the token with broader permissions; check
   that "Permissions → Packages and scopes → All packages and scopes"
   covers the org membership.

Diagnostic: run

```sh
mkdir /tmp/canary && cd /tmp/canary
echo '{"name":"@<your-username>/perm-canary","version":"0.0.1","license":"MIT"}' \
  > package.json
npm publish --access public
```

If the canary publishes successfully under the **personal scope**
(e.g., `@20m61/perm-canary`) but fails under `@senn`, the org side is
the issue (cause #2 above). If both fail, the token is the issue
(cause #1).

After diagnosis, `npm unpublish @<your-username>/perm-canary --force`
within 72 hours to clean up.

#### `repository.url` warning on publish

```
npm warn publish "repository.url" was normalized to "git+https://..."
```

Cause: npm prefers the canonical `git+https://...` form. Auto-corrects
at publish time but the published tarball's `package.json` then
diverges byte-for-byte from the committed one, complicating
reproducibility checks against the git ref.

Fix: pre-apply the canonical form in `package.json#repository.url`.
The 0.1.0 release prep landed this fix in commit `21c9807`.

#### Token cannot be retrieved with `npm config get`

```
npm error The //registry.npmjs.org/:_authToken option is protected,
and cannot be retrieved in this way
```

Cause: npm v11 deliberately masks token reads to prevent accidental
exfiltration via `npm config`. This is intentional behaviour, not a
bug.

Fix: read `~/.npmrc` directly if you need to inspect the token. To
test write permission, prefer canary-publish over `curl` probes —
`curl` requires the token in a Bearer header, which means extracting
it, which the npm CLI now resists.

## Token rotation

The `~/.npmrc` Granular Access Token used to publish `@sennjs/addon-sdk`
is the **only non-interactive publish path** because the maintainer's
npm 2FA is passkey-only — a passkey cannot satisfy npm's TOTP prompt
during automated publish. The token MUST therefore have
"bypass two-factor authentication" enabled.

The active token's name and expiry are recorded out-of-band (the
maintainer's local notes / password manager). _Example (subject to
rotation; this section describes the procedure, not the current
token-of-record)_: the `senn-local-publish-2026-04-v3` token issued
for the 0.1.0 release expires **2026-07-26**. After the expiry of
whatever token is currently in `~/.npmrc`, every `pnpm
release:addon-sdk <tag>` invocation will fail at the registry side
with `403`. Rotate **before** the expiry, not after — there is no
fallback path while the token is dead.

### Rotation steps

1. Visit https://www.npmjs.com/settings/<account>/tokens (logged in as
   the maintainer who owns `@sennjs/addon-sdk`).
2. Generate a **Granular Access Token** with the following settings —
   any deviation has been observed to break publish:
   - **Permissions → Packages and scopes** = "All packages and scopes"
     + "Read and write". (Specific-mode tokens cannot create new
     packages and have failed mid-publish on package version bumps;
     see Troubleshooting §"npm 404 on publish".)
   - **Bypass two-factor authentication** = enabled. (Passkey-only
     2FA accounts have no TOTP path; the bypass is mandatory.)
   - **Expiration** = at most 90 days. The token name SHOULD encode
     the expiry month for grep-ability
     (`senn-local-publish-YYYY-MM-vN`).
3. Replace the token line in `~/.npmrc` (look for
   `//registry.npmjs.org/:_authToken=...`). Do not commit the file.
4. Verify with a canary publish to a personal scope (see
   Troubleshooting §"npm 404 on publish" for the exact recipe) — this
   confirms the new token can both create and update packages without
   touching `@sennjs`.
5. Update the maintainer's local notes / password manager with the
   new token's name + expiry. The repo MUST NOT track this.
6. Delete (revoke) the old token from
   https://www.npmjs.com/settings/<account>/tokens once the canary
   succeeds.

### Why this is not automated

A scheduled rotation routine would need access to npm's account
settings (an interactive web flow protected by passkey). Scripted
rotation is therefore out of scope for SENN. The mitigation is the
calendar reminder above plus this section.

## Negative example

Do **not** publish a release if any check in the pre-flight failed, or if
any ADR touched in the release is still `Proposed`. Ship-blocking checks
exist for a reason; if you think one is wrong, change the check, do not
skip it.
