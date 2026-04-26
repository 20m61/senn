#!/usr/bin/env bash
# SENN local conformance gate.
#
# Authoritative — the project does not depend on GitHub Actions or any
# other CI vendor to enforce its contract. The repository ships no
# `.github/workflows/` (see ADR-0021 + ADR-0022). A fork MAY add a CI
# vendor mirror if it wants one, but MUST keep the mirror aligned with
# this script and never treat the mirror as authoritative.
#
# Skipped here (run on demand):
#   - Playwright e2e (slow; ~25min per browser).
#     -> pnpm --filter @senn/web e2e --project=chromium
#     -> pnpm --filter @senn/addon-gallery exec playwright test --project=chromium
#
# Usage: pnpm conformance
# Env:   SENN_CONFORMANCE_QUIET=1   suppress per-step banners
#        SENN_CONFORMANCE_FAST=1    stop on first failure (default: collect all)

set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

quiet="${SENN_CONFORMANCE_QUIET:-}"
fast="${SENN_CONFORMANCE_FAST:-}"

declare -a results=()
declare -a names=()
overall=0

run() {
  local name=$1; shift
  if [[ -z "$quiet" ]]; then
    printf "\n\033[1;36m▶ %s\033[0m\n" "$name"
  fi
  if "$@"; then
    results+=("PASS")
    names+=("$name")
  else
    results+=("FAIL")
    names+=("$name")
    overall=1
    if [[ -n "$fast" ]]; then
      summarize
      exit 1
    fi
  fi
}

# Drift step: build the artefact, then check the working tree is clean
# under the watched paths. Used for build:addon-sdk and build:web-registry.
run_drift() {
  local name=$1
  local build_cmd=$2
  shift 2
  local watch_paths=("$@")

  if [[ -z "$quiet" ]]; then
    printf "\n\033[1;36m▶ %s\033[0m\n" "$name"
  fi

  if ! eval "$build_cmd"; then
    results+=("FAIL")
    names+=("$name (build)")
    overall=1
    [[ -n "$fast" ]] && { summarize; exit 1; }
    return
  fi

  if [[ -n "$(git status --porcelain -- "${watch_paths[@]}" 2>/dev/null)" ]]; then
    echo "::error:: $name produced drift; run the build and commit the diff" >&2
    git --no-pager diff --stat -- "${watch_paths[@]}" >&2 || true
    results+=("FAIL")
    names+=("$name (drift)")
    overall=1
    [[ -n "$fast" ]] && { summarize; exit 1; }
    return
  fi

  results+=("PASS")
  names+=("$name")
}

summarize() {
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo " SENN conformance summary"
  echo "════════════════════════════════════════════════════════════════"
  local i
  for i in "${!names[@]}"; do
    local mark
    if [[ "${results[$i]}" == "PASS" ]]; then
      mark="\033[1;32m✅\033[0m"
    else
      mark="\033[1;31m❌\033[0m"
    fi
    printf " %b %s\n" "$mark" "${names[$i]}"
  done
  echo "════════════════════════════════════════════════════════════════"
  if [[ $overall -eq 0 ]]; then
    printf " \033[1;32mall green\033[0m\n"
  else
    printf " \033[1;31mfailures present — see above\033[0m\n"
  fi
}

trap summarize EXIT

run "typecheck"               pnpm typecheck
run "lint (biome)"            pnpm lint
run "validate:all-manifests"  pnpm validate:all-manifests
run "check:addon-forbidden"   pnpm check:addon-forbidden
run "verify:official"         pnpm verify:official
run "verify:http-poll-self-test"  pnpm verify:http-poll-self-test
run "test:registry-schema"    pnpm test:registry-schema
run "validate:registry"       pnpm validate:registry addons/official/index.json
SENN_VERIFY_SDK_OFFLINE=1 \
  run "verify:addon-sdk"      pnpm verify:addon-sdk
run_drift "build:addon-sdk drift"   "pnpm build:addon-sdk"   apps/web/public/addons examples
run_drift "build:web-registry drift" "pnpm build:web-registry" apps/web/public addons/official
run "workspace tests"         pnpm test

exit $overall
