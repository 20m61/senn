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

# Fail open if jq is unavailable (CI / fresh box); the deny rules in
# .claude/settings.json still apply at the harness level.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

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

# Block direct push to main (any remote). Word-anchored on both sides so
# branch names that merely start with "main" (mainline, main-fix) don't
# trip; refspecs (HEAD:main, main:main, :main) and -u/-f flag forms do.
if [[ "$cmd" =~ git[[:space:]]+push([[:space:]]|$) ]] \
   && [[ "$cmd" =~ ([[:space:]:])main([[:space:]:]|$) ]]; then
  deny "SENN guardrail: pushes to main are forbidden — releases only via PR from develop (CLAUDE.md, CONTRIBUTING.md)."
fi

# Block hard force-push. --force-with-lease is the recommended safer
# alternative (refuses to overwrite remote work) and is intentionally
# allowed here; a separate ask rule in settings.json gates it.
if [[ "$cmd" =~ git[[:space:]]+push.*(--force([[:space:]]|$)|-f([[:space:]]|$)) ]]; then
  deny "SENN guardrail: --force is blocked. Use --force-with-lease (rebases/feature branches) or ask the user to run --force manually."
fi

# Block --no-verify on commits/merges (skips conformance pre-commit).
if [[ "$cmd" =~ (git[[:space:]]+(commit|merge|rebase|cherry-pick).*--no-verify) ]]; then
  deny "SENN guardrail: --no-verify skips conformance hooks. Fix the underlying failure instead of bypassing it."
fi

# Block package publishing — only the publish-addon-sdk.yml workflow is
# authorized. Word-bounded so substrings like "publish-foo" don't match.
if [[ "$cmd" =~ (^|[[:space:]])(pnpm|npm|yarn)[[:space:]]+publish([[:space:]]|$) ]]; then
  deny "SENN guardrail: package publishing is workflow-only (.github/workflows/publish-addon-sdk.yml). Do not publish from the local machine."
fi

# Block bash-side reads/writes/deletes on protected credential paths.
# Hook guard-protected-paths.sh covers Write|Edit; this catches the bash
# vector (cat keys/x.key.json, rm keys/x, mv keys/ /tmp, …) which would
# otherwise leak content into the transcript or destroy the trust root.
# Pattern mirrors guard-protected-paths.sh:39.
sensitive_cmd_re='(^|[[:space:]/])(cat|less|more|head|tail|bat|rm|mv|cp|tee|tar|zip|gzip|gpg|openssl|base64|xxd|od|hexdump|strings|file|stat)([[:space:]]|$)'
sensitive_path_re='(^|[[:space:]=/])(keys/|[^[:space:]]*\.key\.json|[^[:space:]]*\.pem|[^[:space:]]*id_rsa|[^[:space:]]*id_ed25519|[^[:space:]]*credentials\.json|[^[:space:]]*secrets\.json)'
if [[ "$cmd" =~ $sensitive_cmd_re ]] && [[ "$cmd" =~ $sensitive_path_re ]]; then
  # Allow .env.example explicitly (the only .env* contributors edit).
  if [[ ! "$cmd" =~ \.env\.example ]]; then
    deny "SENN guardrail: bash command targets a protected credential/key path (keys/, *.key.json, *.pem, id_rsa*, *credentials.json, *secrets.json). ADR-0009 forbids reading/moving/deleting signing keys via Claude. Ask the user to do it manually."
  fi
fi

# Block reckless rm. Catches both -rf / -fr (any flag order) and the
# long forms --recursive / --force.
broad_target_re='([[:space:]]|=)(/|/\*|~|~/|\$HOME|\.|\./)([[:space:]]|$|;|\|)'
if [[ "$cmd" =~ (^|[[:space:]])rm([[:space:]]+(-[a-zA-Z]+|--(recursive|force|no-preserve-root)))+ ]] \
   && [[ "$cmd" =~ -[a-zA-Z]*r[a-zA-Z]* || "$cmd" =~ --recursive ]] \
   && [[ "$cmd" =~ $broad_target_re ]]; then
  deny "SENN guardrail: recursive 'rm' on a broad target is blocked. Be specific or ask the user to run it manually."
fi

exit 0
