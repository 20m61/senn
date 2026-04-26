---
description: Run the local mirror of the CI conformance gate (typecheck → lint → manifest validators → forbidden-API → registry → addon-sdk shape → drift checks). Reports a punch list of failures.
allowed-tools: Bash, Read, Grep
---

You are running the **local conformance gate** for SENN. This mirrors
`.github/workflows/conformance.yml` (the `static` job) so the user finds
failures before pushing.

Run these in order, capturing output. **Do not stop on the first failure** —
continue and collect every result so the user gets the full picture.

```bash
pnpm typecheck
pnpm lint
pnpm validate:all-manifests
pnpm check:addon-forbidden
pnpm verify:official
pnpm test:registry-schema
pnpm validate:registry addons/official/index.json
SENN_VERIFY_SDK_OFFLINE=1 pnpm verify:addon-sdk
pnpm build:addon-sdk
git status --porcelain apps/web/public/addons examples
pnpm build:web-registry
git status --porcelain apps/web/public addons/official
pnpm test
```

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
