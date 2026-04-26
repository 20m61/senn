---
description: Validate manifests, registry index, and the @senn/addon-sdk package shape. Lighter than /senn-conformance — runs only the validator scripts.
argument-hint: [optional path/to/manifest.json]
allowed-tools: Bash, Read
---

# Goal

Quickly verify the spec-derived contracts without paying for typecheck or
build steps.

If the user passed `$ARGUMENTS` (a manifest path), validate that one first:

```bash
pnpm validate:addon "$ARGUMENTS"
```

Then run the full set:

```bash
pnpm validate:all-manifests
pnpm check:addon-forbidden
pnpm verify:official
pnpm test:registry-schema
pnpm validate:registry addons/official/index.json
SENN_VERIFY_SDK_OFFLINE=1 pnpm verify:addon-sdk
```

Report a compact table. If the manifest argument was given, lead with its
result — that is what the user is iterating on.
