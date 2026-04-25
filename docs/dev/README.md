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

## Cross-cutting documents

| Document | Audience | Status |
|----------|----------|--------|
| [/docs/charter.md](../charter.md) | everyone | normative |
| [/docs/architecture.md](../architecture.md) | everyone | normative |
| [/docs/core-spec.md](../core-spec.md) | core + add-on devs | normative |
| [/docs/addon-spec.md](../addon-spec.md) | add-on devs | normative |
| [/docs/addon-manifest.md](../addon-manifest.md) | add-on devs, AI coders | normative schema |
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
