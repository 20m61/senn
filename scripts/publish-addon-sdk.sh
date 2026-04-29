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

# 7. Preflight the optional ADR-0023 provenance configuration BEFORE
#    `pnpm publish`. Validation MUST run pre-publish: once npm has
#    accepted the tarball, exiting non-zero leaves an irreversible
#    partial release (npm version published, no provenance artefacts).
#    All env / binary / key-existence checks happen here; the actual
#    signing step (10) only handles invocation against an already-
#    pack'd tarball.
SIGN_TOOL="${SENN_SIGN_RELEASE:-}"
SIGN_KEY="${SENN_SIGN_KEY:-}"
SIGN_PUBKEY="${SENN_SIGN_PUBKEY:-}"
if [[ -n "$SIGN_TOOL" ]]; then
  case "$SIGN_TOOL" in
    cosign|minisign|gpg) ;;
    *)
      echo "error: SENN_SIGN_RELEASE='$SIGN_TOOL' must be one of cosign|minisign|gpg" >&2
      exit 1
      ;;
  esac
  if [[ -z "$SIGN_KEY" ]]; then
    echo "error: SENN_SIGN_RELEASE='$SIGN_TOOL' set but SENN_SIGN_KEY is empty" >&2
    exit 1
  fi
  if ! command -v "$SIGN_TOOL" >/dev/null; then
    echo "error: '$SIGN_TOOL' not on PATH (required by SENN_SIGN_RELEASE)" >&2
    exit 1
  fi
  case "$SIGN_TOOL" in
    cosign|minisign)
      if [[ ! -f "$SIGN_KEY" ]]; then
        echo "error: SENN_SIGN_KEY='$SIGN_KEY' is not a regular file" >&2
        exit 1
      fi
      ;;
    gpg)
      if ! gpg --list-secret-keys --with-colons "$SIGN_KEY" >/dev/null 2>&1; then
        echo "error: gpg keyring has no secret key matching SENN_SIGN_KEY='$SIGN_KEY'" >&2
        exit 1
      fi
      ;;
  esac
  if [[ "$SIGN_TOOL" == "minisign" && -n "$SIGN_PUBKEY" && ! -f "$SIGN_PUBKEY" ]]; then
    echo "error: SENN_SIGN_PUBKEY='$SIGN_PUBKEY' is not a regular file" >&2
    exit 1
  fi
fi

# 8. Confirm with the operator before invoking npm publish. The
#    operator's npm credentials, npm 2FA prompt, and registry choice
#    live outside this script — `pnpm publish` reads ~/.npmrc.
echo
echo "About to publish:"
echo "  package:  @senn/addon-sdk@$VERSION"
echo "  dist-tag: $DIST_TAG"
echo "  registry: $(npm config get registry)"
echo "  user:     $(npm whoami 2>/dev/null || echo '<not logged in — npm publish will fail>')"
if [[ -n "$SIGN_TOOL" ]]; then
  echo "  provenance: $SIGN_TOOL (key: $SIGN_KEY)"
fi
echo
read -r -p "Proceed? [y/N] " REPLY
case "$REPLY" in
  y|Y|yes|YES) ;;
  *) echo "aborted." >&2; exit 130 ;;
esac

# 9. Publish. `--no-git-checks` keeps pnpm from re-running its own git
#    state checks (we already enforced them in step 1).
echo "==> pnpm publish --tag $DIST_TAG --access public --no-git-checks"
pnpm publish --tag "$DIST_TAG" --access public --no-git-checks

echo
echo "published @senn/addon-sdk@$VERSION (dist-tag: $DIST_TAG)"

# 10. Optional: vendor-neutral provenance (ADR-0023).
#    Off by default — the publish flow stays vendor-neutral and
#    zero-dependency. Activated per release by:
#
#      SENN_SIGN_RELEASE = cosign | minisign | gpg
#      SENN_SIGN_KEY     = path to the signing key (cosign / minisign)
#                          OR gpg key id / fingerprint
#      SENN_SIGN_PUBKEY  = (minisign only) path to the maintainer's
#                          public-key file, copied into the .cert slot
#                          so the artefact set has the same shape
#                          across tools
#
#    The script stages three files under dist/release/ (gitignored):
#      senn-addon-sdk-<v>.tgz   identical bytes to the npm tarball
#      senn-addon-sdk-<v>.tgz.sig   detached signature
#      senn-addon-sdk-<v>.tgz.cert  cosign cert / minisign pubkey / gpg public key
#    The maintainer uploads them to the GitHub Release for $TAG and
#    confirms the fingerprint against
#    docs/governance.md "Release signing identities".
#
#    Step 7's preflight already validated env vars, the signer binary,
#    and key-material existence. This block only invokes the signer.
#    A signer-side error here is recoverable: the npm package is
#    already published, but the operator can re-pack the same
#    `pnpm pack` output (tarballs are byte-reproducible from the same
#    git tag) and re-run the signing commands manually against the
#    GitHub Release.
if [[ -n "$SIGN_TOOL" ]]; then
  STAGE="$REPO_ROOT/dist/release"
  mkdir -p "$STAGE"
  ARTEFACT="$STAGE/senn-addon-sdk-$VERSION.tgz"
  SIG="$ARTEFACT.sig"
  CERT="$ARTEFACT.cert"
  cp "$REPO_ROOT/packages/addon-sdk/$TARBALL" "$ARTEFACT"

  case "$SIGN_TOOL" in
    cosign)
      echo "==> cosign sign-blob (key: $SIGN_KEY)"
      cosign sign-blob --yes \
        --key "$SIGN_KEY" \
        --output-signature "$SIG" \
        --output-certificate "$CERT" \
        "$ARTEFACT"
      ;;
    minisign)
      echo "==> minisign -S (secret: $SIGN_KEY)"
      minisign -S -s "$SIGN_KEY" -m "$ARTEFACT" -x "$SIG"
      if [[ -n "$SIGN_PUBKEY" ]]; then
        cp "$SIGN_PUBKEY" "$CERT"
      else
        echo "warn: SENN_SIGN_PUBKEY not set; .cert slot left empty." >&2
        echo "      Upload the maintainer's minisign public key alongside the .sig" >&2
        echo "      manually so verifiers have a complete artefact set." >&2
      fi
      ;;
    gpg)
      echo "==> gpg --detach-sign --armor (signer: $SIGN_KEY)"
      gpg --batch --yes --local-user "$SIGN_KEY" \
        --detach-sign --armor --output "$SIG" "$ARTEFACT"
      gpg --batch --yes --export --armor "$SIGN_KEY" >"$CERT"
      ;;
  esac

  echo
  echo "ADR-0023 provenance artefacts staged at $STAGE/:"
  ls -la "$STAGE/"
  echo
  echo "next (provenance):"
  echo "  - upload $(basename "$ARTEFACT"), $(basename "$SIG"), and $(basename "$CERT")"
  echo "    to the GitHub Release for tag '$TAG'"
  echo "  - cross-check the signing identity against"
  echo "    docs/governance.md 'Release signing identities'"
fi

echo
echo "next steps:"
echo "  - git push origin '$TAG'"
echo "  - update docs/dev/release.md changelog"
