#!/usr/bin/env bash
# Block Write/Edit on paths SENN considers off-limits to Claude:
#   - signing keys (ADR-0009: keys/, *.key.json)
#   - dotenv files (.env, .env.* except .env.example)
#   - common credential filenames
#
# Reads the tool-call payload on stdin and emits a JSON decision per
# Claude Code hook protocol. Exit 0 with `permissionDecision: "deny"`
# blocks the call without crashing the session.

set -euo pipefail

# Fail open if jq is unavailable; the deny rules in
# .claude/settings.json still apply at the harness level.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

payload=$(cat)

# Pull the file path from either tool input shape (Write.file_path / Edit.file_path).
path=$(printf '%s' "$payload" | jq -r '
  .tool_input.file_path
  // .tool_input.path
  // .tool_input.notebook_path
  // empty
')

if [[ -z "${path}" ]]; then
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

case "$path" in
  */keys/*|keys/*|*/.env|.env|*/.env.[!e]*|.env.[!e]*|*.key.json|*.pem|*.key|*id_rsa*|*id_ed25519*|*credentials.json|*secrets.json)
    # Allow .env.example explicitly.
    case "$path" in
      *.env.example|.env.example) exit 0 ;;
    esac
    deny "SENN guardrail: '$path' is a protected credential/key file. ADR-0009 forbids committing signing keys; CLAUDE.md forbids editing .env*/credentials. Ask the user to make this change manually."
    ;;
esac

exit 0
