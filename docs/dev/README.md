# SENN Developer Documentation

This directory is the entry point for everyone — humans and AI coders — who
build on SENN. It is written as a contract: every page begins with intent,
states normative rules with MUST/SHOULD/MAY, and includes positive and
negative examples that can be validated mechanically.

If you are an AI agent generating code for SENN, treat each page here as a
machine-readable specification. Run the conformance commands listed at the
bottom of each page before declaring your work done.

## Maps

### I want to set up the repo and run the PoC

→ [getting-started.md](getting-started.md)

### I want to understand the workspace layout

→ [workspace-guide.md](workspace-guide.md)

### I want to write an add-on

→ [writing-an-addon.md](writing-an-addon.md)
→ [addon-cookbook.md](addon-cookbook.md) for ready-to-adapt patterns
→ [ai-driven-addon-development.md](ai-driven-addon-development.md) if an AI agent will drive the work

### I want to plug in a signaling backend

→ [signaling-adapter.md](signaling-adapter.md)
→ [/docs/deployment.md](../deployment.md) for choosing a tier

### I want to run conformance checks

→ [conformance.md](conformance.md)

### I am drafting a spec or ADR change

→ [spec-authoring.md](spec-authoring.md)

### I want to cut a release

→ [release.md](release.md)

### I am driving SENN development with an AI coder (Claude Code, etc.)

The repository ships project-scoped Claude Code configuration so AI agents
operate against the same SDD guardrails as a human contributor:

- **Project memory** — [`/CLAUDE.md`](../../CLAUDE.md) is loaded into every
  Claude Code session and codifies the file map, branch policy, SDD loop,
  and security guardrails.
- **Slash commands** ([`.claude/commands/`](../../.claude/commands/)) —
  invoke them with `/senn-<name>` from inside Claude Code:

  | Command              | Purpose                                                 |
  |----------------------|---------------------------------------------------------|
  | `/senn-conformance`  | Run the authoritative local gate (`pnpm conformance`).  |
  | `/senn-validate`     | Run manifest + registry + addon-sdk shape validators.   |
  | `/senn-addon-new`    | Scaffold a new add-on via the `addon-builder` agent.    |
  | `/senn-adr-new`      | Draft a new ADR via the `adr-author` agent.             |
  | `/senn-spec-review`  | Run the `sdd-expert` agent on changed spec files.       |
  | `/senn-sign-check`   | Read-only signature audit (no key access).              |
  | `/senn-pr`           | Open a PR from the current topic branch into `develop`. |

- **Specialized subagents** ([`.claude/agents/`](../../.claude/agents/)) —
  delegate scoped work to one of:

  | Agent                | Use when                                                  |
  |----------------------|-----------------------------------------------------------|
  | `sdd-expert`         | Reviewing/editing normative specs or ADRs.                |
  | `addon-builder`      | Scaffolding a new add-on end-to-end (manifest + iframe).  |
  | `conformance-runner` | Triaging a CI / local gate failure (read-only).           |
  | `adr-author`         | Drafting a new ADR with the next monotonic ID.            |

- **Guardrail hooks** ([`.claude/hooks/`](../../.claude/hooks/)) — block
  edits or shell commands that would touch `keys/`, `*.key.json`, `.env*`
  (except `.env.example`), push to `main`, force-push, skip commit hooks
  with `--no-verify`, or publish packages locally. The hooks require `jq`
  on `PATH` (`apt install jq` / `brew install jq`); without `jq` they fail
  open and the harness-level deny rules in
  [`.claude/settings.json`](../../.claude/settings.json) still apply.

For background on AI-driven add-on development specifically (prompts,
review loop, conformance commands), see
[ai-driven-addon-development.md](ai-driven-addon-development.md).

## Cross-cutting documents

| Document | Audience | Status |
|----------|----------|--------|
| [/docs/charter.md](../charter.md) | everyone | normative |
| [/docs/architecture.md](../architecture.md) | everyone | normative |
| [/docs/core-spec.md](../core-spec.md) | core + add-on devs | normative |
| [/docs/addon-spec.md](../addon-spec.md) | add-on devs | normative |
| [/docs/addon-manifest.md](../addon-manifest.md) | add-on devs, AI coders | normative schema |
| [/docs/room-and-invite-spec.md](../room-and-invite-spec.md) | core + signaling adapter devs | normative schema |
| [/docs/signaling-url-fragment-spec.md](../signaling-url-fragment-spec.md) | signaling adapter devs | normative schema |
| [/docs/signaling-http-poll-spec.md](../signaling-http-poll-spec.md) | signaling adapter devs, ops | normative schema |
| [/docs/peer-session-spec.md](../peer-session-spec.md) | core devs | normative |
| [/docs/addon-runtime-spec.md](../addon-runtime-spec.md) | core devs, add-on devs, AI coders | normative |
| [/docs/addon-storage-spec.md](../addon-storage-spec.md) | core devs, add-on devs, AI coders | normative |
| [/docs/addon-signing-spec.md](../addon-signing-spec.md) | core devs, registry ops, AI coders | normative |
| [/docs/addon-file-transfer-spec.md](../addon-file-transfer-spec.md) | core devs, add-on devs, AI coders | normative |
| [/docs/security-model.md](../security-model.md) | everyone | normative |
| [/docs/license-policy.md](../license-policy.md) | dependency reviewers | normative |
| [/docs/adr/](../adr/) | maintainers | source of decisions |

## Conventions enforced project-wide

- Permission strings are kebab-case dotted: `peer.send`, `storage.local.write`.
- Capability tags are kebab-case versioned: `whiteboard-v1`.
- Add-on IDs are reverse-DNS: `com.example.thing`.
- ADRs are zero-padded 4-digit, monotonically increasing.
- Examples in spec text MUST validate against the toolchain. See
  [conformance.md](conformance.md).
