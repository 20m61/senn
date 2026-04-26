---
description: Scaffold a new SENN add-on end-to-end via the addon-builder agent. Produces a manifest, sandboxed iframe skeleton, and runs the spec-derived validators.
argument-hint: <addon-id-or-short-name> [- one-line description]
allowed-tools: Agent, Read, Write, Edit, Bash, Glob, Grep
---

User wants to scaffold a new add-on. Their input is `$ARGUMENTS`.

Pass control to the **addon-builder** subagent. Brief it as follows (fill in
the placeholders from `$ARGUMENTS` and the surrounding conversation):

> Scaffold a new SENN add-on under `examples/` (or `addons/official/` only if
> the user said "official"). Identifier: `<reverse-DNS or kebab-case from
> $ARGUMENTS>`. One-line purpose: `<from $ARGUMENTS or ask once if missing>`.
>
> Follow `docs/dev/writing-an-addon.md` and `docs/dev/addon-cookbook.md`.
> Required outputs:
> 1. `manifest.json` with a minimum, fully-justified permissions list.
> 2. `index.html` + entry script using **only browser standard APIs** plus
>    `senn.<namespace>.<method>(...)` calls allowed by the manifest.
> 3. README with a 1-paragraph description and the conformance command.
> 4. A passing `pnpm validate:addon <path>` and clean `pnpm
>    check:addon-forbidden`.
>
> Do NOT add npm dependencies. Do NOT call `fetch`, `WebSocket`, `RTCPeer*`,
> or `navigator.mediaDevices` directly — go through `senn.peer.*` /
> `senn.media.*`. Do NOT write into `addons/official/index.json` — that
> requires a signing pass and a maintainer key.
>
> When done, report: file tree, every permission and why it's required, and
> the validator output.

After the agent returns, summarize for the user in 日本語:
- 作成されたファイル
- `pnpm validate:addon <path>` の結果
- 次の手順 (`pnpm dev` で確認、署名は別途)
