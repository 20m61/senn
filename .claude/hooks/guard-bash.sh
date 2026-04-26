#!/usr/bin/env bash
# Bash command guard for SENN.
#
# Blocks the most destructive footguns on top of `permissions.deny`:
#   - direct commits/pushes to main
#   - skipping commit hooks (--no-verify)
#   - publishing packages
#   - rm -rf on broad targets
#
# Allows everything else. Permissions.allow / .ask still applies.

set -euo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')

if [[ -z "$cmd" ]]; then
  exit 0
fi

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# Block direct push to main (any remote).
if [[ "$cmd" =~ git[[:space:]]+push.*[[:space:]](origin[[:space:]]+)?main ]]; then
  deny "SENN guardrail: pushes to main are forbidden — releases only via PR from develop (CLAUDE.md, CONTRIBUTING.md)."
fi

# Block force-push outright.
if [[ "$cmd" =~ git[[:space:]]+push.*(--force|--force-with-lease|-f([[:space:]]|$)) ]]; then
  deny "SENN guardrail: force-push is blocked. Ask the user to confirm manually if a force-push is genuinely needed."
fi

# Block --no-verify on commits/merges (skips conformance pre-commit).
if [[ "$cmd" =~ (git[[:space:]]+(commit|merge|rebase|cherry-pick).*--no-verify) ]]; then
  deny "SENN guardrail: --no-verify skips conformance hooks. Fix the underlying failure instead of bypassing it."
fi

# Block package publishing — only the publish-addon-sdk.yml workflow is authorized.
if [[ "$cmd" =~ ((pnpm|npm|yarn)[[:space:]]+publish) ]]; then
  deny "SENN guardrail: package publishing is workflow-only (.github/workflows/publish-addon-sdk.yml). Do not publish from the local machine."
fi

# Block reckless rm.
if [[ "$cmd" =~ rm[[:space:]]+-rf?[[:space:]]+(/|/\*|~|~/|\$HOME|\.|\./)([[:space:]]|$) ]]; then
  deny "SENN guardrail: 'rm -rf' on a broad target is blocked. Be specific or ask the user to run it manually."
fi

exit 0
