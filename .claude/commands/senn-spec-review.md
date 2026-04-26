---
description: Run the sdd-expert agent against changed spec files (docs/core-spec.md, docs/addon-spec.md, docs/addon-manifest.md, docs/adr/**). Reports findings as numbered, file-anchored items.
allowed-tools: Agent, Bash, Read, Grep
---

# Goal

Surface spec drift, RFC-2119 violations, and untestable clauses in the
currently changed spec files **before** they reach a maintainer.

1. Identify the changed spec files relative to `develop`:

   ```bash
   git diff --name-only origin/develop...HEAD -- 'docs/core-spec.md' 'docs/addon-spec.md' 'docs/addon-manifest.md' 'docs/adr/**' 'docs/*-spec.md' 2>/dev/null \
     || git diff --name-only develop...HEAD -- 'docs/core-spec.md' 'docs/addon-spec.md' 'docs/addon-manifest.md' 'docs/adr/**' 'docs/*-spec.md' 2>/dev/null \
     || git diff --name-only HEAD~1 -- 'docs/core-spec.md' 'docs/addon-spec.md' 'docs/addon-manifest.md' 'docs/adr/**' 'docs/*-spec.md'
   ```

   If nothing changed, also include any unstaged/staged changes:
   `git status --porcelain docs/`.

2. If still empty, ask the user which spec they want reviewed and stop.

3. Otherwise hand off to the **sdd-expert** subagent with:

   > Review the changed spec files: `<list>`.
   >
   > Use the workflow in `.claude/agents/sdd-expert.md` (Workflow A, "Reviewing
   > a spec change"). Report findings in the standard output format
   > (`## Findings`, `## Recommended changes`, `## Open questions for the
   > maintainer`). Be file-anchored: every item must cite `<file>:<line>`.

4. Relay the agent's findings to the user verbatim. Add a short 日本語 lead
   line summarizing the overall verdict (例: "✅ 重大な逸脱なし、軽微3件" /
   "⚠️ ADR-XXXX と矛盾あり、要修正").
