#!/usr/bin/env bash
# publish-addon-sdk.sh — local-first publish for @senn/addon-sdk.
#
# Replaces the prior .github/workflows/publish-addon-sdk.yml (removed by
# ADR-0022). The maintainer runs this script from a clean checkout of
# the tagged commit; the script enforces every gate the workflow used
# to enforce (tag <-> version equality, private-flag flip, conformance
# pass, pack-non-empty), then invokes `pnpm publish`.
#
# Vendor-neutral by construction: depends only on bash, git, node,
# pnpm, and the npm CLI. No CI vendor, no OIDC, no provenance — those
# are operator concerns and are documented in docs/dev/release.md.
#
# Usage:
#   pnpm release:addon-sdk addon-sdk-v0.1.0
#   pnpm release:addon-sdk addon-sdk-v0.2.0-rc.1 next
#
# The first arg is the git tag (must match `addon-sdk-v<semver>`). The
# optional second arg is the npm dist-tag (defaults to `latest`; use
# `next` for pre-releases per ADR-0019 §3).

set -euo pipefail

TAG="${1:-}"
DIST_TAG="${2:-latest}"

if [[ -z "$TAG" ]]; then
  echo "error: tag is required (e.g. addon-sdk-v0.1.0)" >&2
  exit 64
fi

case "$TAG" in
  addon-sdk-v*) ;;
  *)
    echo "error: tag '$TAG' does not match addon-sdk-v<semver>" >&2
    exit 65
    ;;
esac

VERSION="${TAG#addon-sdk-v}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# 1. Refuse if working tree is dirty.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree has uncommitted changes" >&2
  git status --short >&2
  exit 1
fi

# 2. Refuse if HEAD is not on the named tag.
HEAD_SHA="$(git rev-parse HEAD)"
TAG_SHA="$(git rev-parse "refs/tags/$TAG^{commit}" 2>/dev/null || true)"
if [[ -z "$TAG_SHA" ]]; then
  echo "error: tag '$TAG' does not exist locally — create it first with" >&2
  echo "       git tag -a '$TAG' -m '@senn/addon-sdk $VERSION'" >&2
  exit 1
fi
if [[ "$HEAD_SHA" != "$TAG_SHA" ]]; then
  echo "error: HEAD ($HEAD_SHA) is not the tag '$TAG' ($TAG_SHA)" >&2
  echo "       run: git checkout '$TAG'" >&2
  exit 1
fi

PKG_JSON="packages/addon-sdk/package.json"

# 3. Verify package.json#version matches the tag.
ACTUAL_VERSION="$(node -p "require('./$PKG_JSON').version")"
if [[ "$ACTUAL_VERSION" != "$VERSION" ]]; then
  echo "error: $PKG_JSON#version='$ACTUAL_VERSION' but tag asserts '$VERSION'" >&2
  exit 1
fi

# 4. Verify package is publishable (private must not be true).
PRIV="$(node -p "require('./$PKG_JSON').private===true")"
if [[ "$PRIV" == "true" ]]; then
  echo "error: $PKG_JSON still has private:true — flip per ADR-0019 before tagging" >&2
  exit 1
fi

# 5. Run the local conformance gate. This is the same contract that
#    every push satisfies; we re-run it here so a publish from an old
#    checkout is not silently accepted.
echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

echo "==> pnpm conformance"
pnpm conformance

# 6. Verify pack contents are non-empty.
echo "==> pnpm pack (verifying non-empty tarball)"
cd "$REPO_ROOT/packages/addon-sdk"
TARBALL="$(pnpm pack --silent)"
trap 'rm -f "$REPO_ROOT/packages/addon-sdk/$TARBALL"' EXIT
echo "tarball: $TARBALL"
tar -tzf "$TARBALL" | sort
if [[ ! -s "$TARBALL" ]]; then
  echo "error: pack produced an empty tarball" >&2
  exit 1
fi

# 7. Confirm with the operator before invoking npm publish. The
#    operator's npm credentials, npm 2FA prompt, and registry choice
#    live outside this script — `pnpm publish` reads ~/.npmrc.
echo
echo "About to publish:"
echo "  package:  @senn/addon-sdk@$VERSION"
echo "  dist-tag: $DIST_TAG"
echo "  registry: $(npm config get registry)"
echo "  user:     $(npm whoami 2>/dev/null || echo '<not logged in — npm publish will fail>')"
echo
read -r -p "Proceed? [y/N] " REPLY
case "$REPLY" in
  y|Y|yes|YES) ;;
  *) echo "aborted." >&2; exit 130 ;;
esac

# 8. Publish. `--no-git-checks` keeps pnpm from re-running its own git
#    state checks (we already enforced them in step 1).
echo "==> pnpm publish --tag $DIST_TAG --access public --no-git-checks"
pnpm publish --tag "$DIST_TAG" --access public --no-git-checks

echo
echo "published @senn/addon-sdk@$VERSION (dist-tag: $DIST_TAG)"
echo "next steps:"
echo "  - git push origin '$TAG'"
echo "  - update docs/dev/release.md changelog"
