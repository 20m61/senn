---
description: Audit add-on signatures without touching keys. Verifies the official trust root, every shipped add-on's signature, and the registry index.
allowed-tools: Bash, Read
---

# Goal

Confirm that what is in `addons/official/` is consistent with the signed
registry **without** invoking any signing operation. Useful before review.

This command is **read-only with respect to keys**. It does not call
`pnpm sign:*` and the project hooks block it from doing so anyway.

```bash
pnpm verify:official
pnpm validate:registry addons/official/index.json
pnpm test:registry-schema
```

Then summarize:

```
## Add-on signature audit

- Trust root: <fingerprint from addons/official/meta.json>
- Verified: <count> / <total>
- Failed: <list with reason>
- Registry index schema: ✅ / ❌
```

If anything fails, do **not** propose `pnpm sign:all-official` as the fix —
that requires the maintainer key and is outside Claude's authority. Instead
explain which add-on diverged and which file (`manifest.json` /
`index.json`) is the likely culprit.
