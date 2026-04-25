# Spec Authoring Guide

## Intent

How to write or change a SENN specification document so that it remains
machine-checkable, AI-readable, and consistent with the rest of the spec
set. Applies to anything under `docs/`.

## Mandatory page shape

Every spec page MUST contain, in order:

1. **Intent** — a single short paragraph stating what the page is for.
2. **Normative checklist** — bullet list of MUST/SHOULD/MAY rules.
3. **Positive example** — fenced code, validates against the toolchain.
4. **Negative example** — fenced code, with a one-line reason it is wrong.
5. **Conformance** — copy-pasteable command(s) that prove the spec.

Pages that describe an interface MUST also contain a TypeScript signature
block.

## Vocabulary

- Use RFC 2119 keywords (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY) for
  normative statements. UPPERCASE.
- Avoid soft language in normative text: "should probably", "ideally",
  "we recommend" — replace with SHOULD / SHOULD NOT or rephrase.
- Define every term on first use within the page, even if defined elsewhere.

## Examples must be runnable

- JSON examples in `docs/addon-manifest.md` and `docs/addon-spec.md` MUST
  pass `pnpm tsx scripts/validate-addon-manifest.ts` when written to disk.
- TypeScript snippets MUST compile against the actual `@senn/*` types.
- HTML snippets MUST not relax the default CSP.

If your example fails the toolchain, fix the example. The toolchain is the
referee.

## ADRs

ADRs go in `docs/adr/` and use the template in
[`docs/adr/README.md`](../adr/README.md):

```
# ADR NNNN: <title>

## Status
Proposed | Accepted | Superseded by ADR-XXXX | Deprecated

## Context
## Decision
## Rationale
## Consequences
```

- IDs are zero-padded 4 digits, monotonically increasing.
- `Status` starts as `Proposed`. A maintainer flips it to `Accepted`.
- Reference prior ADRs by number when relevant.
- After acceptance, update [`docs/adr/README.md`](../adr/README.md) index.

## Cross-document hygiene

- New permission strings: declare in `docs/addon-spec.md` AND mirror in
  `scripts/validate-addon-manifest.ts`.
- New capability tags: declare in the relevant spec page; bump the
  capability version (`-v2`) rather than mutating an existing one.
- New message envelope kinds: add to `docs/core-spec.md` and to
  `@senn/protocol`.

## Workflow

1. Open a `docs/<topic>` branch.
2. Draft the change with the page shape above.
3. Validate every example with the toolchain.
4. Run the `sdd-expert` subagent for review.
5. Open a PR. Include a short rationale and a link to any related ADR.

## Negative example

Do **not** introduce a new permission like `peer.broadcast` only in a code
PR. Permission strings are part of the public protocol; they MUST appear in
`docs/addon-spec.md`, in the manifest validator, and in an ADR if the
semantics are non-obvious. A code-only addition will be rejected.
