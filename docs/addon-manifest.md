# SENN Add-on Manifest Schema

The manifest is a JSON file (`manifest.json`) that ships at the root of every
SENN add-on package. SENN Core refuses to load add-ons whose manifest fails
schema validation.

## Top-level fields

| Field          | Type       | Required | Description |
|----------------|------------|----------|-------------|
| `id`           | string     | yes      | Reverse-DNS identifier, e.g. `com.example.whiteboard`. Must match `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`. |
| `name`         | string     | yes      | Human-readable display name (1–60 chars). |
| `version`      | string     | yes      | SemVer 2.0.0 string. |
| `description` | string     | no       | Short description (≤ 280 chars). |
| `entry`        | string     | yes      | Relative path to the entry HTML, default `index.html`. |
| `license`      | string     | yes      | SPDX identifier. Must be on the [allowed license list](license-policy.md). |
| `author`       | string \| object | no | Author display name or `{ name, url }`. |
| `network`      | boolean    | yes      | Must be `false` for SENN-conformant add-ons in the current spec. |
| `permissions` | string[]   | yes      | Subset of declared permissions (see [addon-spec.md](addon-spec.md#permissions)). |
| `capabilities` | string[]   | yes      | Capability tags negotiated between peers (e.g. `whiteboard-v1`). |
| `icon`         | string     | no       | Relative path to a square PNG/SVG. |
| `homepage`     | string     | no       | URL to project page. |
| `senn`         | object     | no       | SENN runtime constraints (see below). |

## `senn` object

| Field          | Type       | Description |
|----------------|------------|-------------|
| `coreVersion` | string     | SemVer range of compatible SENN Core versions. |
| `sandbox`      | string[]   | Sandbox flags allowed beyond defaults. Currently only `allow-scripts` is permitted. |
| `csp`          | object     | Optional CSP overrides. Cannot relax `connect-src`. |

## Validation rules

- `id` is unique across the registry.
- `version` strictly increases over previously published versions.
- `permissions` only contain known permission strings.
- `network` must be `false`.
- `entry` must be a relative path that resolves inside the package.
- The manifest is no larger than 16 KiB.

## Tooling

`scripts/validate-addon-manifest.ts` runs in CI and locally:

```sh
pnpm tsx scripts/validate-addon-manifest.ts addons/official/whiteboard/manifest.json
```

## Future extensions (non-normative)

- Translated `name` / `description` per locale.
- Optional signature block (`signature`, `publicKey`, `signedAt`) once the SENN Verified Registry ships.
