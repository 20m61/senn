#!/usr/bin/env bash
# Bash command guard for SENN.
#
# Blocks the most destructive footguns on top of `permissions.deny`:
#   - direct commits/pushes to main
#   - skipping commit hooks (--no-verify)
#   - publishing packages
#   - bash-side reads/writes/deletes on protected credential paths
#   - rm -rf on broad targets
#
# Detection is segment-aware: the command is split on shell separators
# (`&&`, `||`, `;`, newline) and each *segment* is evaluated against its
# leading command. This avoids false positives where the *prose* in a
# `git commit -m "…"` body or PR body contains words like "git push",
# "main", "--no-verify", "rm -rf", or "pnpm publish" while documenting
# these very rules.
#
# The harness-level deny rules in .claude/settings.json and the
# .githooks/pre-push hook are the other layers of defense — this is one
# layer of three.
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

# ────────────────────────────────────────────────────────────────────
# Segment extraction.
#
# Split $cmd on shell separators (&&, ||, ;, newline) into command
# segments. Each segment is independently checked against rules. This
# matters because:
#
#   git commit -F /tmp/msg  (where /tmp/msg contains "git push origin main")
#
# is NOT a push to main. The previous all-string regex would false-
# positive because "git push" and "main" both appear in $cmd.
#
# Quoting is handled coarsely: we strip single- and double-quoted
# substrings before splitting, so prose inside `git commit -m "…"`
# does not appear in any segment. This is intentional — quoted prose
# never executes. Heredoc bodies also disappear because they live
# between markers that contain no separators outside the body, and
# the body itself is then erased by the quote stripper if the user
# uses `<<'EOF'` (single-quoted heredoc) — common for commit messages.
#
# Edge cases:
#   - Shell-substitution like `$(cmd …)` is left intact: substitutions
#     can themselves contain dangerous calls. We treat the whole `$(…)`
#     as part of its surrounding segment, which is the safe choice.
#   - A heredoc body with separators inside it (rare in practice for
#     SENN commit messages) is left as part of the segment containing
#     the heredoc opener. Our rules anchor on the segment's leading
#     command, so a heredoc body's content does not satisfy the
#     "leading command is X" check.
# ────────────────────────────────────────────────────────────────────

# Strip single- and double-quoted regions (greedy minimal-pair matching
# in bash via parameter expansion + a small loop). Preserves length
# semantics enough that segment splitting works correctly.
strip_quotes() {
  local s=$1 out=""
  while [[ -n "$s" ]]; do
    case "$s" in
      \'*)
        # Strip up to the next single quote.
        s=${s#\'}
        s=${s#*\'}
        ;;
      \"*)
        # Strip up to the next double quote, accounting for \"
        # escapes.
        s=${s#\"}
        local rest=""
        while [[ -n "$s" ]]; do
          case "$s" in
            \\\"*) s=${s#\\\"} ;;
            \"*)   s=${s#\"}; break ;;
            *)     rest+=${s:0:1}; s=${s:1} ;;
          esac
        done
        ;;
      *)
        out+=${s:0:1}
        s=${s:1}
        ;;
    esac
  done
  printf '%s' "$out"
}

stripped=$(strip_quotes "$cmd")

# Replace separators with newlines for iteration. We keep this on the
# stripped form so quoted prose is already gone.
normalized=$(printf '%s\n' "$stripped" | tr ';' '\n')
normalized=${normalized//&&/$'\n'}
normalized=${normalized//||/$'\n'}

# Iterate segments. For each, derive its leading command (first word,
# trimmed) and apply rules.
while IFS= read -r segment; do
  # Trim leading whitespace.
  while [[ "$segment" =~ ^[[:space:]] ]]; do segment=${segment# }; segment=${segment#$'\t'}; done
  [[ -z "$segment" ]] && continue

  # ─── Rule: direct push to main (any remote) ──────────────────────
  # Trigger when this segment is a `git push` invocation AND its arg
  # list contains `main` as a refspec/branch token.
  if [[ "$segment" =~ ^git[[:space:]]+push([[:space:]]|$) ]] \
     && [[ "$segment" =~ ([[:space:]:])main([[:space:]:]|$) ]]; then
    deny "SENN guardrail: pushes to main are forbidden — releases only via PR from develop (CLAUDE.md, CONTRIBUTING.md)."
  fi

  # ─── Rule: hard force-push (--force / -f). --force-with-lease is OK ─
  if [[ "$segment" =~ ^git[[:space:]]+push([[:space:]]|$) ]] \
     && [[ "$segment" =~ (--force([[:space:]]|$)|-f([[:space:]]|$)) ]]; then
    deny "SENN guardrail: --force is blocked. Use --force-with-lease (rebases/feature branches) or ask the user to run --force manually."
  fi

  # ─── Rule: --no-verify on git commit/merge/rebase/cherry-pick ────
  # Anchored on the leading command so prose in a commit message body
  # mentioning "--no-verify" does not trip the rule.
  if [[ "$segment" =~ ^git[[:space:]]+(commit|merge|rebase|cherry-pick)([[:space:]]|$) ]] \
     && [[ "$segment" =~ ([[:space:]]|=)--no-verify([[:space:]]|=|$) ]]; then
    deny "SENN guardrail: --no-verify skips conformance hooks. Fix the underlying failure instead of bypassing it."
  fi

  # ─── Rule: package publishing (pnpm/npm/yarn publish) ────────────
  # Per ADR-0022, publishes go through the maintainer-only local script
  # `scripts/publish-addon-sdk.sh` (invoked via `pnpm release:addon-sdk
  # <tag>`). Direct `pnpm publish` from Claude is blocked because the
  # script wraps the publish in a tag/conformance gate the maintainer
  # confirms interactively.
  if [[ "$segment" =~ ^(pnpm|npm|yarn)[[:space:]]+publish([[:space:]]|$) ]]; then
    deny "SENN guardrail: package publishing is maintainer-only and runs through scripts/publish-addon-sdk.sh (ADR-0022). Do not invoke 'pnpm publish' directly — ask the user to run 'pnpm release:addon-sdk <tag>' instead."
  fi

  # ─── Rule: bash-side touch on protected credential paths ─────────
  # Match if the leading command is a sensitive cat/cp/mv/etc. AND the
  # segment names a protected path. .env.example is allowed.
  sensitive_cmd_re='^(cat|less|more|head|tail|bat|rm|mv|cp|tee|tar|zip|gzip|gpg|openssl|base64|xxd|od|hexdump|strings|file|stat)[[:space:]]'
  sensitive_path_re='(^|[[:space:]=/])(keys/|[^[:space:]]*\.key\.json|[^[:space:]]*\.pem|[^[:space:]]*id_rsa|[^[:space:]]*id_ed25519|[^[:space:]]*credentials\.json|[^[:space:]]*secrets\.json)'
  if [[ "$segment" =~ $sensitive_cmd_re ]] && [[ "$segment" =~ $sensitive_path_re ]]; then
    if [[ ! "$segment" =~ \.env\.example ]]; then
      deny "SENN guardrail: bash command targets a protected credential/key path (keys/, *.key.json, *.pem, id_rsa*, *credentials.json, *secrets.json). ADR-0009 forbids reading/moving/deleting signing keys via Claude. Ask the user to do it manually."
    fi
  fi

  # ─── Rule: reckless rm on broad targets ──────────────────────────
  # Leading command must be `rm`. Recursive flag must be present.
  # Target must be one of /, ~, $HOME, ., or their slashed/glob
  # variants. Specific paths (rm -rf packages/foo/dist) are allowed.
  broad_target_re='([[:space:]]|=)(/|/\*|~|~/|\$HOME|\.|\./)([[:space:]]|$|;|\|)'
  if [[ "$segment" =~ ^rm([[:space:]]+(-[a-zA-Z]+|--(recursive|force|no-preserve-root)))+ ]] \
     && { [[ "$segment" =~ -[a-zA-Z]*r[a-zA-Z]* ]] || [[ "$segment" =~ --recursive ]]; } \
     && [[ "$segment" =~ $broad_target_re ]]; then
    deny "SENN guardrail: recursive 'rm' on a broad target is blocked. Be specific or ask the user to run it manually."
  fi
done <<< "$normalized"

exit 0
