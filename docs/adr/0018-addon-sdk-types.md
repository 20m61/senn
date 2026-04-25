# ADR 0018: Add-on SDK type distribution

## Status

Accepted.

## Context

`@senn/addon-sdk` ships two assets that are conceptually separate but
historically lived in the same workspace package without a clean
distribution story:

1. **A classic-script runtime** — `runtime/senn-addon-sdk.js`, which is
   copied verbatim into every static add-on directory at build time
   ([`apps/web/public/addons/<id>/senn-addon-sdk.js`](../../apps/web/public/addons))
   and loaded with a plain `<script src="senn-addon-sdk.js">` tag from
   the add-on's `index.html`. It installs a single global,
   `window.senn`, and wraps the postMessage bridge documented in
   [`docs/addon-runtime-spec.md`](../addon-runtime-spec.md). It MUST
   stay a classic script: the addon iframe runs with
   `script-src 'self'` and one local script tag per page (ADR-0003,
   ADR-0006).

2. **The TypeScript surface that describes that global** —
   `src/index.ts`, which exports `SennAddonGlobal`, `SennAddonContext`,
   `SennAddonEventMap`, etc., and `declare global { interface Window
   { senn?: SennAddonGlobal } }`. Inside the monorepo this is consumed
   directly through `"main": "./src/index.ts"` because every workspace
   package goes through the same `tsc -b` build.

The current `package.json` mixes the two concerns:

```jsonc
{
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

That works for in-repo consumers but not for anyone outside this
workspace. Three concrete gaps:

- **External authors get no IDE help.** The
  [add-on cookbook](../dev/addon-cookbook.md) and
  [writing-an-addon](../dev/writing-an-addon.md) tutorials tell readers
  to call `window.senn.peer.send(...)` and `window.senn.storage.get(...)`,
  but a fresh project cloned from the cookbook has no way to load the
  ambient `Window.senn` declaration. Authors fall back to `// @ts-ignore`
  or hand-rolled local `.d.ts` shims that drift from the canonical
  shape.

- **No types-only entry point for build tools.** Tools that bundle an
  add-on (esbuild, tsup, vite, plain `tsc`) need the declarations
  without pulling in `@senn/protocol` source via `./src/index.ts`. The
  current `exports` map points at `.ts`, which non-TypeScript
  toolchains cannot read.

- **The runtime file is undiscoverable through package metadata.**
  Build scripts want to copy `runtime/senn-addon-sdk.js` to the addon's
  output directory. With `"private": true` and no `exports["./runtime/*"]`
  entry, scripts hard-code the workspace path
  (`packages/addon-sdk/runtime/senn-addon-sdk.js`) and break if the
  package is ever consumed from `node_modules`.

The package is `private: true` today because no public-npm publish
pipeline exists. This ADR does **not** unblock public publishing — that
is a separate decision (CI, release notes, version policy, code-signing
of the runtime). It only fixes the *shape* of the package so that, when
publish day arrives, both internal monorepo consumers and external
add-on authors get the right files at the right paths without further
restructuring.

## Decision

### 1. Two-part export surface

`@senn/addon-sdk` exposes two independent entry points:

| Subpath | Purpose | Format | Audience |
|---------|---------|--------|----------|
| `.` (default) | Type declarations + version constant | ESM `.d.ts` + `.js` from `tsc` | TypeScript projects authoring an add-on, monorepo consumers |
| `./runtime/senn-addon-sdk.js` | The classic-script runtime, copied into add-on packages at build time | Plain ES2020 IIFE classic script | Add-on packagers / build scripts |

The runtime `.js` file is **not** loaded by `import` from the default
entry. It is a side-effecting classic script that an add-on's HTML
includes via `<script src="senn-addon-sdk.js">`. Importing it through
ESM would defeat the addon-sandbox CSP model (ADR-0003).

### 2. Build emits dist/

`tsconfig.json` already inherits `declaration: true` and `composite:
true` from `tsconfig.base.json`. The package keeps `tsc -b` as its
build command and ships:

```
dist/
  index.d.ts
  index.d.ts.map
  index.js
  index.js.map
runtime/
  senn-addon-sdk.js     (hand-written, not generated)
  senn-addon-sdk.d.ts   (one-line ambient module declaration; new)
src/
  index.ts              (source of truth for types)
```

`package.json` switches its entry points to the built artefacts:

```jsonc
{
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./runtime/senn-addon-sdk.js": "./runtime/senn-addon-sdk.js",
    "./package.json": "./package.json"
  },
  "files": ["dist", "runtime", "src"]
}
```

`src/` ships in `files` so monorepo dependents that resolve through
TypeScript project references continue to work; published consumers
read `dist/`.

### 3. Ambient global activation

A single import from `@senn/addon-sdk` activates the
`Window.senn?: SennAddonGlobal` augmentation, because `src/index.ts`
already includes `declare global { ... }`. External add-on projects
that want the global without a runtime import can use:

```ts
/// <reference types="@senn/addon-sdk" />
```

at the top of any `.ts` file — the side-effect of the `declare global`
block applies without needing to write `import` statements. This is
documented in `docs/dev/writing-an-addon.md`.

### 4. Runtime classic-script shim

A new `runtime/senn-addon-sdk.d.ts` file exists solely so TypeScript
projects that copy the runtime file alongside their addon source
(common pattern: build script copies it as a peer of `addon.js`) can
reference it without `tsc` complaining about a missing declaration:

```ts
// runtime/senn-addon-sdk.d.ts
// The runtime is a classic script that installs window.senn as a
// side-effect; types live in `@senn/addon-sdk`. This file exists so
// projects copying the runtime alongside their addon get a declaration
// shim and TypeScript stops warning about the .js file.
export {};
```

It deliberately does NOT re-export the runtime types — those live in
the default entry. The shim only exists so the file path resolves.

### 5. No ESM module form for the runtime

We considered shipping `runtime/senn-addon-sdk.mjs` as an ESM module
with a `register()` function. Rejected because:

- The addon iframe loads exactly one `<script>` tag with
  `script-src 'self'` and no module support flags. Adding ESM means
  every addon's HTML grows a `<script type="module">` tag and the host
  has to relax CSP.
- The runtime is < 200 lines, has no imports, and runs once. There is
  no module graph to optimise.
- ADR-0003 §"Sandbox" pins the iframe to classic scripts. Diverging
  here would force a separate ADR.

### 6. Public npm publish stays out of scope

`private: true` stays for now. Publishing requires:

- A public-readable npm scope (`@senn`).
- A version policy aligned with the SDK's semver story
  (the SDK API is currently `0.0.0` and unstable).
- Decisions on whether the runtime file ships as a binary asset or
  whether we sign it.

A follow-up ADR will own publishing. This ADR is intentionally limited
to the package *shape*.

## Rationale

- **Why split types from runtime explicitly:** the two have different
  audiences (compiler vs. browser) and different mutation rates (types
  change with every API addition; the runtime is stable for months at
  a time). Mixing them under one entry forced anyone touching the
  package to understand both halves.
- **Why an ambient `Window.senn` rather than `import { senn }`:** the
  add-on iframe does not have access to ESM imports; the runtime
  *injects* the global. Mirroring that in the type system means the
  authoring experience matches the runtime experience: you write
  `window.senn.peer.send(...)`, period.
- **Why ship `src/` in `files`:** the monorepo's
  `moduleResolution: "Bundler"` plus project references resolves
  `@senn/addon-sdk` directly to its TypeScript source for fast
  incremental builds. Stripping `src/` would force a `dist/` build
  before any other workspace package could typecheck.
- **Why a runtime `.d.ts` shim with `export {}`:** it makes the file
  a declaration module so `allowJs: false` projects can still import
  the path through tooling without crashing. It deliberately exports
  nothing because the runtime exports nothing — it sets a global.

## Consequences

### Positive

- External add-on authors copy the cookbook example, run `pnpm add -D
  @senn/addon-sdk` (once published), get `window.senn` typed.
- Monorepo continues to work: `tsc -b` still produces `dist/`, project
  references still resolve through `src/`.
- The runtime path is now a documented export, so build scripts can
  resolve it via
  `require.resolve("@senn/addon-sdk/runtime/senn-addon-sdk.js")`
  instead of hard-coding workspace paths.

### Negative / accepted costs

- One more file to keep in sync (`runtime/senn-addon-sdk.d.ts`). Mitigated
  by the shim being one line.
- `dist/` is now a published artefact. We must ensure it is not stale
  in committed state — the existing `tsc -b` invocation in CI handles
  this, and `dist/` stays in `.gitignore`.
- Adds ≈ 2 KB of metadata to `package.json`. Trivial.

### Out of scope

- Public npm publishing pipeline (separate ADR).
- A higher-level "addon framework" wrapping `window.senn` with React /
  Vue bindings — those belong in user-space packages, not the SDK.
- Rewriting the runtime in TypeScript. The runtime is small enough
  that a hand-written classic script is more legible than a generated
  one and avoids polyfill churn.

## Implementation pointers

- `packages/addon-sdk/package.json`: switch `main`/`module`/`types`/
  `exports`/`files` per §2 above.
- `packages/addon-sdk/runtime/senn-addon-sdk.d.ts`: new one-line shim
  per §4.
- `docs/dev/writing-an-addon.md`: add a "TypeScript types" subsection
  showing the `/// <reference types="@senn/addon-sdk" />` form.
- No source changes to `src/index.ts` or
  `runtime/senn-addon-sdk.js` are required by this ADR.
