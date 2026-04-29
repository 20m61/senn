# SENN Add-on Manifest Schema

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
in this document are to be interpreted as described in [RFC 2119][rfc2119]
when, and only when, they appear in all capitals.

[rfc2119]: https://www.rfc-editor.org/rfc/rfc2119

The manifest is a JSON file (`manifest.json`) that ships at the root of every
SENN add-on package. SENN Core **MUST** refuse to load add-ons whose manifest
fails schema validation.

## Top-level fields

| Field          | Type       | Required | Description |
|----------------|------------|----------|-------------|
| `id`           | string     | yes      | Reverse-DNS identifier, e.g. `com.example.whiteboard`. **MUST** match `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`. |
| `name`         | string     | yes      | Human-readable display name (1–60 chars). |
| `version`      | string     | yes      | SemVer 2.0.0 string. |
| `description` | string     | no       | Short description (≤ 280 chars). |
| `entry`        | string     | yes      | Relative path to the entry HTML, default `index.html`. |
| `license`      | string     | yes      | SPDX identifier. **MUST** be on the [allowed license list](license-policy.md). |
| `author`       | string \| object | no | Author display name or `{ name, url }`. |
| `network`      | boolean    | yes      | **MUST** be `false` for SENN-conformant add-ons in the current spec. |
| `permissions` | string[]   | yes      | Subset of declared permissions (see [addon-spec.md](addon-spec.md#permissions)). |
| `capabilities` | string[]   | yes      | Capability tags negotiated between peers (e.g. `whiteboard-v1`). |
| `icon`         | string     | no       | Relative path to a square PNG/SVG. |
| `homepage`     | string     | no       | URL to project page. |
| `senn`         | object     | no       | SENN runtime constraints (see below). |

## `senn` object

| Field          | Type       | Description |
|----------------|------------|-------------|
| `coreVersion` | string     | SemVer range of compatible SENN Core versions. |
| `sandbox`      | string[]   | Sandbox flags allowed beyond defaults. Hosts **MUST** reject any value other than `allow-scripts`. |
| `csp`          | object     | Optional CSP overrides. **MUST NOT** relax `connect-src`. |

## Validation rules

- `id` **MUST** be unique across the registry.
- `version` **MUST** strictly increase over previously published versions.
- `permissions` **MUST** only contain known permission strings.
- `network` **MUST** be `false`.
- `entry` **MUST** be a relative path that resolves inside the package.
- The manifest **MUST NOT** exceed 16 KiB.

## Tooling

`scripts/validate-addon-manifest.ts` runs in CI and locally. Either invocation works:

```sh
# canonical short form (package.json script alias)
pnpm validate:addon addons/official/whiteboard/manifest.json

# long form
pnpm tsx scripts/validate-addon-manifest.ts addons/official/whiteboard/manifest.json
```

To revalidate every shipped manifest at once: `pnpm validate:all-manifests`.

## Signing

Manifest signing is **detached**, not inline. A signed publisher ships
`manifest.sig.json` adjacent to `manifest.json`; this manifest schema is
not extended with a `signature` / `publicKey` / `signedAt` block. The
detached form is the normative contract — see
[addon-signing-spec.md](addon-signing-spec.md) (wire format) and
[ADR-0008](adr/0008-manifest-signing.md) (decision).

## Future extensions (non-normative)

- Translated `name` / `description` per locale.
