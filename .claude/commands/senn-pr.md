---
description: Open a PR from the current branch into develop. Runs the local conformance gate first and refuses if it fails.
allowed-tools: Bash, Read, Grep
---

# Goal

Ship the current branch by opening a PR into `develop` (never into `main`).
Do this safely:

1. Confirm we are NOT on `main` or `develop`:

   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

   If on `main` or `develop`, refuse and ask the user to switch to a topic
   branch.

2. Run a fast subset of the conformance gate (skip Playwright):

   ```bash
   pnpm typecheck && pnpm lint && pnpm validate:all-manifests \
     && pnpm check:addon-forbidden && pnpm verify:official \
     && pnpm test:registry-schema \
     && pnpm validate:registry addons/official/index.json \
     && SENN_VERIFY_SDK_OFFLINE=1 pnpm verify:addon-sdk \
     && pnpm test
   ```

   If any step fails, stop and report which one. Do NOT bypass with
   `--no-verify`.

3. Inspect the diff vs `develop`:

   ```bash
   git fetch origin develop --quiet
   git log --oneline origin/develop..HEAD
   git diff --stat origin/develop...HEAD
   ```

4. Push the branch (the `git push:*` permission is in `ask`, so the user
   confirms):

   ```bash
   git push -u origin HEAD
   ```

5. Draft a PR title and body. Title format: `<type>: <subject>` where type is
   one of feat / fix / docs / refactor / test / chore / ci. Keep title
   ≤ 70 chars.

   Body template (HEREDOC):

   ```
   ## Summary
   - <what changed, 1-3 bullets>

   ## Why
   - <link to spec/ADR/issue if applicable>

   ## Conformance
   - typecheck / lint / validators / tests: ✅ (local run)
   - Playwright e2e: defer to CI

   ## Test plan
   - [ ] Reviewer: confirm `pnpm <relevant>` passes
   - [ ] Reviewer: read changed spec/ADR section if applicable

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```

6. Open the PR into `develop`:

   ```bash
   gh pr create --base develop --title "<title>" --body "$(cat <<'EOF'
   <body>
   EOF
   )"
   ```

7. Report the PR URL to the user in 日本語 with the title and base branch.
