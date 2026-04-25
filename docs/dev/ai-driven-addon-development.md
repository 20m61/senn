# AI-Driven Add-on Development

## Intent

Rules for AI agents (Claude, Cursor, Copilot, others) generating SENN
add-ons end-to-end. SENN is designed so that rich, feature-full add-ons can
be safely AI-generated: the spec is precise, the manifest is the contract,
and Core enforces the security model regardless of what the AI produces.

This page is a normative checklist. An add-on that fails any item below MUST
NOT ship.

## Mental model the AI must hold

1. The **manifest** is the contract. Every observable behavior must reduce to a
   declared permission and a declared capability.
2. The **iframe sandbox + CSP** is the perimeter. The AI cannot make Core
   trust code by clever wording.
3. **Add-ons MUST NOT touch the network.** Anything peer-shaped goes through
   `addon.peer.*`. Anything storage-shaped goes through `addon.storage.*` or
   `addon.files.*`. There is no escape hatch.
4. The **SDD agent** ([.claude/agents/sdd-expert.md](../../.claude/agents/sdd-expert.md))
   is the authority on spec questions. When in doubt, defer.

## Workflow the AI MUST follow

1. **Read these specs first**, in order:
   - [/docs/charter.md](../charter.md)
   - [/docs/security-model.md](../security-model.md)
   - [/docs/addon-spec.md](../addon-spec.md)
   - [/docs/addon-manifest.md](../addon-manifest.md)
   - [writing-an-addon.md](writing-an-addon.md)
   - [addon-cookbook.md](addon-cookbook.md)
2. **Restate the goal** of the add-on in 3 bullet points and the **list of
   user-observable behaviors**. Do not start coding before this.
3. **Pick the closest cookbook recipe** as a starting skeleton. If none
   matches, justify why and propose the new pattern to the SDD agent.
4. **Write the manifest first.** Permissions are a budget; spend the
   minimum needed for the listed behaviors. Justify each permission inline
   in the README.
5. **Generate `index.html`, `addon.js`, `style.css`** using only browser
   standards plus `@senn/addon-sdk`. No external runtime dependencies.
6. **Self-audit** with the audit checklist below.
7. **Run conformance commands** ([conformance.md](conformance.md)).
8. **Hand off to the SDD agent for review.** Do not declare the add-on
   complete on your own authority.

## Hard constraints (the AI MUST NOT)

- MUST NOT add any of: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `navigator.sendBeacon`, `RTCPeerConnection`, `RTCDataChannel`,
  `MediaStream`, `localStorage`, `sessionStorage`, raw `indexedDB.open`,
  inline `<script>`, remote `<script src>`, `eval`, `new Function`,
  `import("https://...")`.
- MUST NOT relax the default CSP, especially `connect-src 'none'`.
- MUST NOT grant the iframe `allow-same-origin` unless an SDD-agent-approved
  exception is documented in the add-on README.
- MUST NOT add new permission strings, capability tags, or message kinds
  without first proposing a spec change.
- MUST NOT introduce a runtime dependency outside the
  [allow list](../license-policy.md). Prefer browser standards and inline
  utilities.
- MUST NOT exfiltrate peer data — including under the guise of analytics,
  error reporting, or "telemetry".
- MUST NOT spoof Core UI (no overlays that mimic permission prompts, no
  reusing Core glyphs).

## Self-audit checklist (the AI MUST run before handing off)

```
[ ] Goal restated in 3 bullets at the top of the add-on README.
[ ] Each manifest permission has a one-line justification in README.
[ ] Each capability tag is versioned (`-vN`).
[ ] No forbidden API anywhere in sources (grep for the list above).
[ ] Manifest validates: `pnpm tsx scripts/validate-addon-manifest.ts <path>`.
[ ] No new dependencies in `package.json` (or each is on the allow list).
[ ] No add-on file is larger than necessary; no embedded large blobs.
[ ] Add-on works when Core delivers messages out of order (no implicit ordering assumed).
[ ] Add-on degrades gracefully when a permission is denied at runtime.
[ ] Add-on includes a negative example in its README ("what this add-on does not do, and why").
```

## Tone for AI-generated READMEs

Add-on READMEs MUST include:

1. **What it does** — 3 bullets.
2. **Permissions and why** — table.
3. **Data flow** — one paragraph naming what stays local and what crosses peers.
4. **Out of scope** — explicit list (e.g. "no server backup", "no cross-room sync").
5. **Conformance command** — copy-pasteable.

Avoid marketing language. Avoid claims of perfect security or anonymity.
The security model document forbids them.

## When the AI should stop and ask

- A behavior cannot be expressed with the current permission set. → Propose
  a new permission via the SDD agent; do **not** simulate it client-side
  with forbidden APIs.
- A capability tag does not yet exist for the experience. → Propose `-v1`
  and document the message kinds it owns.
- The user requests cross-device sync, server backup, or analytics. → Refuse
  and explain that these are out of scope for an add-on; offer local
  export/import or opt-in P2P sync as alternatives.

## Escalation

When uncertain, dispatch a Claude Code task to the
[`sdd-expert`](../../.claude/agents/sdd-expert.md) subagent with:

- the manifest you intend to publish,
- the list of user-observable behaviors,
- the questions you are unsure about.

Do not proceed until the SDD agent's "For AI coders" output is satisfied.
