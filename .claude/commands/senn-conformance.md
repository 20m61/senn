---
description: Run the local-first SENN conformance gate (`pnpm conformance` — typecheck → lint → manifest validators → forbidden-API → registry → addon-sdk shape → drift checks → workspace tests). Reports a punch list of failures. This is the authoritative gate; GitHub Actions is an optional mirror.
allowed-tools: Bash, Read, Grep
---

You are running the **authoritative SENN conformance gate**. The repo is
local-first — `pnpm conformance` (script: `scripts/conformance.sh`) is
the source of truth, not GitHub Actions.

The single command is:

```bash
pnpm conformance
```

The script collects every step's result (it does NOT stop on first
failure unless `SENN_CONFORMANCE_FAST=1` is set) and prints a green/red
summary at the end.

After all steps run, report exactly:

```
## Conformance gate — local

| Step                        | Result                |
|-----------------------------|-----------------------|
| typecheck                   | ✅ / ❌ <one-line>     |
| lint                        | ✅ / ❌ <one-line>     |
| validate:all-manifests      | …                     |
| check:addon-forbidden       | …                     |
| verify:official             | …                     |
| test:registry-schema        | …                     |
| validate:registry           | …                     |
| verify:addon-sdk (offline)  | …                     |
| build:addon-sdk drift       | …                     |
| build:web-registry drift    | …                     |
| test (workspace)            | …                     |

## Failures
- <step>: <first failing line, file:line if known>
- ...

## Next actions
- <bulleted minimal fixes>
```

If everything is green, say so in one line — do not pad the report. If any
drift step shows a non-empty `git status --porcelain`, treat it as a failure
("`shipped X is stale; run pnpm build:X and commit`") even though the build
itself exited 0.

Do **not** run Playwright e2e here — it is handled in CI on Chromium / Firefox
/ WebKit and takes ~25 minutes per browser. If the user explicitly asks for
e2e, run `pnpm --filter @senn/web e2e --project=chromium` only.
