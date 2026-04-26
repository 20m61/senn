#!/usr/bin/env bash
# Regression tests for .claude/hooks/guard-bash.sh.
#
# Each case is a JSON tool-call payload paired with the expected
# verdict (deny|allow). Run with: bash .claude/hooks/guard-bash.test.sh

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/guard-bash.sh"
pass=0
fail=0

run_case() {
  local label=$1 payload=$2 expected=$3
  local out
  out=$(printf '%s' "$payload" | bash "$HOOK" 2>&1)
  local got=allow
  if printf '%s' "$out" | grep -q '"deny"'; then got=deny; fi
  if [[ "$got" == "$expected" ]]; then
    printf "  ✅ %-58s [%s]\n" "$label" "$got"
    pass=$((pass+1))
  else
    printf "  ❌ %-58s expected=%s got=%s\n" "$label" "$expected" "$got"
    printf "       payload: %s\n" "$payload"
    printf "       output:  %s\n" "$out"
    fail=$((fail+1))
  fi
}

echo "== Push to main =="
run_case "push origin main"           '{"tool_input":{"command":"git push origin main"}}'                deny
run_case "push -u origin main"        '{"tool_input":{"command":"git push -u origin main"}}'             deny
run_case "push origin HEAD:main"      '{"tool_input":{"command":"git push origin HEAD:main"}}'           deny
run_case "push origin main:main"      '{"tool_input":{"command":"git push origin main:main"}}'           deny
run_case "push origin :main"          '{"tool_input":{"command":"git push origin :main"}}'               deny
run_case "false-pos: push mainline"   '{"tool_input":{"command":"git push origin mainline"}}'             allow
run_case "false-pos: push main-fix"   '{"tool_input":{"command":"git push origin main-fix"}}'             allow
run_case "false-pos: push develop"    '{"tool_input":{"command":"git push origin develop"}}'              allow
run_case "compound: && push main"     '{"tool_input":{"command":"git fetch && git push origin main"}}'    deny
run_case "false-pos: && push develop" '{"tool_input":{"command":"git fetch && git push origin develop"}}' allow

echo ""
echo "== Force push =="
run_case "push --force"               '{"tool_input":{"command":"git push --force origin develop"}}'         deny
run_case "push -f"                    '{"tool_input":{"command":"git push -f origin develop"}}'              deny
run_case "push --force-with-lease OK" '{"tool_input":{"command":"git push --force-with-lease origin develop"}}' allow

echo ""
echo "== --no-verify =="
run_case "commit --no-verify"         '{"tool_input":{"command":"git commit --no-verify -m msg"}}'            deny
run_case "merge --no-verify"          '{"tool_input":{"command":"git merge --no-verify branch"}}'             deny

echo ""
echo "== publish =="
run_case "pnpm publish"               '{"tool_input":{"command":"pnpm publish"}}'                  deny
run_case "npm publish"                '{"tool_input":{"command":"npm publish"}}'                   deny
run_case "false-pos: pnpm publish-foo" '{"tool_input":{"command":"pnpm run publish-foo"}}'        allow

echo ""
echo "== protected credential paths via bash =="
run_case "cat keys/x.key.json"        '{"tool_input":{"command":"cat keys/senn-official.key.json"}}'   deny
run_case "rm keys/x.key.json"         '{"tool_input":{"command":"rm keys/senn-official.key.json"}}'    deny
run_case "cp keys -> /tmp"            '{"tool_input":{"command":"cp keys/senn-official.key.json /tmp/x"}}' deny
run_case "mv keys -> /tmp"            '{"tool_input":{"command":"mv keys/senn-official.key.json /tmp/x"}}' deny
run_case "base64 keys"                '{"tool_input":{"command":"base64 keys/senn-official.key.json"}}' deny
run_case "carve-out: cat .env.example" '{"tool_input":{"command":"cat .env.example"}}'                allow

echo ""
echo "== rm broad target =="
run_case "rm -rf /"                   '{"tool_input":{"command":"rm -rf /"}}'                    deny
run_case "rm -fr /"                   '{"tool_input":{"command":"rm -fr /"}}'                    deny
run_case "rm --recursive --force /"   '{"tool_input":{"command":"rm --recursive --force /"}}'    deny
run_case "rm -rf ."                   '{"tool_input":{"command":"rm -rf ."}}'                    deny
run_case "rm -rf packages/foo/dist OK" '{"tool_input":{"command":"rm -rf packages/foo/dist"}}'   allow

echo ""
echo "== regression: prose inside quoted commit message body =="
# The case that bit us: a commit whose message body documents the
# guardrails, mentioning "git push", "main", "--no-verify",
# "pnpm publish", "rm -rf" as prose. Must NOT trip any rule.
run_case "commit with prose: pushes/main/--no-verify" \
  '{"tool_input":{"command":"git commit -m \"docs: explain pushes to main are forbidden and --no-verify is too\""}}' \
  allow
run_case "commit with prose: rm -rf in message" \
  '{"tool_input":{"command":"git commit -m \"chore: do not run rm -rf / in tests\""}}' \
  allow
run_case "commit with prose: pnpm publish in message" \
  '{"tool_input":{"command":"git commit -m \"chore: pnpm publish stays in CI workflow\""}}' \
  allow
run_case "compound: add then commit with prose" \
  '{"tool_input":{"command":"git add . && git commit -m \"docs: refuses pushes to main outright\""}}' \
  allow
run_case "compound: still catches real push to main" \
  '{"tool_input":{"command":"git add . && git commit -m msg && git push origin main"}}' \
  deny
run_case "git commit -F with msg containing keys/x" \
  '{"tool_input":{"command":"git commit -F /tmp/msg-mentioning-keys.txt"}}' \
  allow

echo ""
echo "== general regressions =="
run_case "pnpm test"                  '{"tool_input":{"command":"pnpm test"}}'             allow
run_case "pnpm conformance"           '{"tool_input":{"command":"pnpm conformance"}}'      allow
run_case "git push develop"           '{"tool_input":{"command":"git push -u origin develop"}}' allow
run_case "git status"                 '{"tool_input":{"command":"git status"}}'            allow

echo ""
echo "════════════════════════════════════════════════════════════════"
echo " result: $pass pass / $fail fail"
echo "════════════════════════════════════════════════════════════════"
[[ $fail -eq 0 ]]
