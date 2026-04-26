---
description: Draft a new ADR in the SENN template via the adr-author agent. Auto-assigns the next zero-padded ID.
argument-hint: <short-title-or-decision-statement>
allowed-tools: Agent, Read, Write, Bash, Glob
---

User wants a new ADR. Their input is `$ARGUMENTS`.

1. Determine the next ADR ID:

   ```bash
   ls docs/adr/ | grep -E '^[0-9]{4}-' | sort | tail -1
   ```

   Increment by 1 and zero-pad to 4 digits.

2. Hand off to the **adr-author** subagent with:

   > Draft a new ADR `docs/adr/<NNNN>-<kebab-title>.md` for: `$ARGUMENTS`.
   >
   > Use the template in `docs/adr/README.md` exactly. Required sections:
   > **Status** (always start at `Proposed` — do not mark Accepted), **Context**
   > (tied to charter or an existing ADR), **Decision** (concrete statement,
   > not a question), **Consequences** (positive AND negative).
   >
   > Cross-reference relevant ADRs. If this ADR amends or supersedes another
   > ADR, say so explicitly in Status.
   >
   > Do not introduce vendor lock-in (ADR-0007). Do not weaken security or
   > privacy claims (`docs/security-model.md`, `docs/privacy.md`).

3. After the agent writes the file, append a one-line entry to
   `docs/adr/README.md` if that file maintains an index (check first; only
   amend if there is a list to amend).

4. Report to the user in 日本語: ADR 番号、タイトル、ファイルパス、Status は
   `Proposed` で残しているのでメンテナーに承認を依頼するよう案内。
