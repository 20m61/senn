#!/usr/bin/env tsx
/**
 * pnpm verify:addon-sdk
 *
 * Regression guard for the @senn/addon-sdk package shape pinned by
 * ADR-0018 and the publish contract pinned by ADR-0019. Checks that:
 *
 *   1. dist/index.{js,d.ts} exist and are non-empty.
 *   2. package.json exports map exposes the documented entry points.
 *   3. The "." entry resolves to dist/index.js with types pointing at
 *      dist/index.d.ts.
 *   4. The "./runtime/senn-addon-sdk.js" subpath export resolves to
 *      the actual classic-script runtime file.
 *   5. dist/index.d.ts re-exports the named types and declares the
 *      `Window.senn?` ambient global.
 *   6. (ADR-0019 §6a) When the package is public on npm, the local
 *      package.json#version differs from the npm `latest` dist-tag if
 *      any of the surface enumerated in ADR-0018 has changed since
 *      that version. No-op when the package is not yet published or
 *      when the network is unavailable.
 *   7. (ADR-0019 §6b) The runtime classic-script bytes match every
 *      shipped copy under apps/web/public/addons and examples/.
 *   8. Publish-time metadata that must not regress:
 *        - `repository.url` is in canonical npm form (`git+https://...`)
 *          so the published tarball's package.json is byte-identical
 *          to the committed one (matters for ADR-0023 §3 verification).
 *        - `bugs.url` is set so the npm package page shows a working
 *          "Report a bug" link.
 *        - `keywords` is a non-empty array so the package is
 *          discoverable on npm search.
 *        - `homepage` is set so consumers can find the project from
 *          the npm package page.
 *        - `license` is "Apache-2.0" (charter principle).
 *      These were caught by hand during the 0.1.0 prep; codified here
 *      so future publishable packages do not re-introduce the same
 *      gaps. (See `docs/dev/release.md` §"Troubleshooting".)
 *
 * Run after `pnpm --filter @senn/addon-sdk build` (or after a full
 * `pnpm typecheck`, which builds dist as a side-effect via project
 * references).
 */
import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_DIR = resolve(REPO_ROOT, "packages/addon-sdk");

const DIST_JS = resolve(SDK_DIR, "dist/index.js");
const DIST_DTS = resolve(SDK_DIR, "dist/index.d.ts");
const RUNTIME_JS = resolve(SDK_DIR, "runtime/senn-addon-sdk.js");
const RUNTIME_DTS = resolve(SDK_DIR, "runtime/senn-addon-sdk.d.ts");
const PACKAGE_JSON = resolve(SDK_DIR, "package.json");

const STATIC_ADDONS_DIR = resolve(REPO_ROOT, "apps/web/public/addons");
const EXAMPLES_DIR = resolve(REPO_ROOT, "examples");

interface PackageExportsMap {
  readonly [key: string]:
    | string
    | {
        readonly types?: string;
        readonly import?: string;
        readonly default?: string;
      };
}

interface PackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly private?: unknown;
  readonly main?: unknown;
  readonly module?: unknown;
  readonly types?: unknown;
  readonly exports?: PackageExportsMap;
  readonly files?: unknown;
  readonly license?: unknown;
  readonly homepage?: unknown;
  readonly repository?: unknown;
  readonly bugs?: unknown;
  readonly keywords?: unknown;
}

const failures: string[] = [];

function fail(msg: string): void {
  failures.push(msg);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function nonEmpty(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function checkArtefacts(): Promise<void> {
  for (const [label, p] of [
    ["dist/index.js", DIST_JS],
    ["dist/index.d.ts", DIST_DTS],
    ["runtime/senn-addon-sdk.js", RUNTIME_JS],
    ["runtime/senn-addon-sdk.d.ts", RUNTIME_DTS],
  ] as const) {
    if (!(await exists(p))) {
      fail(`${label} missing — run \`pnpm --filter @senn/addon-sdk build\``);
      continue;
    }
    if (!(await nonEmpty(p))) {
      fail(`${label} is empty`);
    }
  }
}

function expectExportEntry(
  exports: PackageExportsMap,
  key: string,
  expectedFile: string | { types: string; import: string; default: string },
): void {
  const entry = exports[key];
  if (entry === undefined) {
    fail(`exports[${JSON.stringify(key)}] missing`);
    return;
  }
  if (typeof expectedFile === "string") {
    if (entry !== expectedFile) {
      fail(
        `exports[${JSON.stringify(key)}] = ${JSON.stringify(entry)}, expected ${JSON.stringify(expectedFile)}`,
      );
    }
    return;
  }
  if (typeof entry !== "object" || entry === null) {
    fail(`exports[${JSON.stringify(key)}]: expected conditional object, got ${typeof entry}`);
    return;
  }
  for (const [cond, expected] of Object.entries(expectedFile)) {
    if (entry[cond as "types" | "import" | "default"] !== expected) {
      fail(
        `exports[${JSON.stringify(key)}].${cond} = ${JSON.stringify(entry[cond as "types" | "import" | "default"])}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
}

async function checkPackageJson(): Promise<void> {
  const pkg = JSON.parse(await readFile(PACKAGE_JSON, "utf8")) as PackageJson;
  if (pkg.name !== "@sennjs/addon-sdk") {
    fail(`package.json name = ${JSON.stringify(pkg.name)}, expected "@sennjs/addon-sdk"`);
  }
  if (pkg.main !== "./dist/index.js") {
    fail(`package.json main = ${JSON.stringify(pkg.main)}, expected "./dist/index.js"`);
  }
  if (pkg.module !== "./dist/index.js") {
    fail(`package.json module = ${JSON.stringify(pkg.module)}, expected "./dist/index.js"`);
  }
  if (pkg.types !== "./dist/index.d.ts") {
    fail(`package.json types = ${JSON.stringify(pkg.types)}, expected "./dist/index.d.ts"`);
  }
  if (!Array.isArray(pkg.files)) {
    fail("package.json files: must be an array");
  } else {
    for (const required of ["dist", "runtime", "src"]) {
      if (!pkg.files.includes(required)) {
        fail(`package.json files: missing ${JSON.stringify(required)}`);
      }
    }
  }
  if (typeof pkg.exports !== "object" || pkg.exports === null) {
    fail("package.json exports: missing");
    return;
  }
  expectExportEntry(pkg.exports, ".", {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  });
  expectExportEntry(pkg.exports, "./runtime/senn-addon-sdk.js", "./runtime/senn-addon-sdk.js");
  expectExportEntry(pkg.exports, "./package.json", "./package.json");

  checkPublishMetadata(pkg);
}

function checkPublishMetadata(pkg: PackageJson): void {
  // license: charter principle is Apache-2.0; deviation is a release blocker.
  if (pkg.license !== "Apache-2.0") {
    fail(`package.json license = ${JSON.stringify(pkg.license)}, expected "Apache-2.0"`);
  }

  // homepage: npm package landing page links here. A missing field
  // produces a page with no project link, which hurts discoverability.
  if (typeof pkg.homepage !== "string" || pkg.homepage.length === 0) {
    fail("package.json homepage: must be a non-empty string");
  }

  // repository.url: must be in npm-canonical form (`git+https://...`).
  // Without the `git+` prefix npm auto-corrects at publish time and the
  // published tarball's package.json then diverges byte-for-byte from
  // the committed one — see docs/dev/release.md §"Troubleshooting" and
  // commit 21c9807 for the original incident.
  const repo = pkg.repository as { type?: unknown; url?: unknown } | unknown;
  if (typeof repo !== "object" || repo === null) {
    fail("package.json repository: must be an object with type+url");
  } else {
    const url = (repo as { url?: unknown }).url;
    if (typeof url !== "string" || url.length === 0) {
      fail("package.json repository.url: must be a non-empty string");
    } else if (!url.startsWith("git+")) {
      fail(
        `package.json repository.url = ${JSON.stringify(url)}: must start with "git+" (npm canonical form). Without the prefix, npm auto-corrects at publish time and the tarball's package.json drifts byte-for-byte from the committed one.`,
      );
    }
  }

  // bugs.url: drives the "Report a bug" link on the npm package page.
  // String form is also accepted by npm; we require the object form so
  // a future addition (e.g., bugs.email) has a stable container.
  const bugs = pkg.bugs as { url?: unknown } | unknown;
  if (typeof bugs !== "object" || bugs === null) {
    fail("package.json bugs: must be an object with a url field");
  } else {
    const url = (bugs as { url?: unknown }).url;
    if (typeof url !== "string" || url.length === 0) {
      fail("package.json bugs.url: must be a non-empty string");
    }
  }

  // keywords: drives npm search ranking. Empty arrays produce no
  // discoverability boost. We require ≥3 entries to discourage
  // single-word stubs that do not actually help users find the
  // package.
  if (!Array.isArray(pkg.keywords)) {
    fail("package.json keywords: must be an array");
  } else {
    if (pkg.keywords.length < 3) {
      fail(
        `package.json keywords: only ${pkg.keywords.length} entr${pkg.keywords.length === 1 ? "y" : "ies"} — provide at least 3 for npm search discoverability`,
      );
    }
    for (const kw of pkg.keywords) {
      if (typeof kw !== "string" || kw.length === 0) {
        fail("package.json keywords: every entry must be a non-empty string");
        break;
      }
    }
  }
}

async function checkAmbientGlobal(): Promise<void> {
  const dts = await readFile(DIST_DTS, "utf8");
  const probes = [
    /interface\s+SennAddonGlobal\b/,
    /interface\s+SennAddonContext\b/,
    /interface\s+Window\s*{[\s\S]*?senn\??:\s*SennAddonGlobal/,
  ];
  for (const re of probes) {
    if (!re.test(dts)) {
      fail(`dist/index.d.ts: missing pattern ${re}`);
    }
  }
}

async function checkRuntimeByteEquality(): Promise<void> {
  // ADR-0019 §6b: every shipped copy of senn-addon-sdk.js MUST equal
  // the canonical runtime/ source. Drift means an addon would carry a
  // different bridge from the one the SDK package claims to ship.
  let canonical: Buffer;
  try {
    canonical = await readFile(RUNTIME_JS);
  } catch {
    fail("runtime/senn-addon-sdk.js missing — cannot byte-check shipped copies");
    return;
  }

  const targets: string[] = [];
  try {
    for (const entry of await readdir(STATIC_ADDONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      targets.push(resolve(STATIC_ADDONS_DIR, entry.name, "senn-addon-sdk.js"));
    }
  } catch {
    /* directory may not exist in pruned checkouts; skip silently */
  }
  try {
    for (const entry of await readdir(EXAMPLES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      targets.push(resolve(EXAMPLES_DIR, entry.name, "senn-addon-sdk.js"));
    }
  } catch {
    /* same — examples may be pruned */
  }

  let checked = 0;
  for (const t of targets) {
    if (!(await exists(t))) continue; // not every dir ships the runtime
    checked += 1;
    const buf = await readFile(t);
    if (buf.length !== canonical.length || !buf.equals(canonical)) {
      fail(
        `runtime drift: ${relative(REPO_ROOT, t)} differs from runtime/senn-addon-sdk.js — run \`pnpm build:addon-sdk\` and commit`,
      );
    }
  }
  if (checked === 0) {
    fail(
      "runtime byte-equality check found no shipped copies — has the static-addons layout moved?",
    );
  }
}

interface NpmPackument {
  readonly "dist-tags"?: { readonly latest?: string };
  readonly versions?: Record<string, unknown>;
}

async function fetchNpmLatest(name: string): Promise<string | null> {
  // ADR-0019 §6a: probe npm for the package's latest dist-tag. If the
  // package is not yet published (404) or the network is unavailable,
  // return null and treat the version-bump guard as a no-op.
  if (process.env.SENN_VERIFY_SDK_OFFLINE === "1") return null;
  const url = `https://registry.npmjs.org/${name.replace(/\//g, "%2F")}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as NpmPackument;
    return body["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  }
}

async function checkVersionBump(pkg: PackageJson): Promise<void> {
  // ADR-0019 §6a: if the package is publishable (private !== true) and
  // the package.json#version equals the latest published version, then
  // the SDK surface MUST NOT have changed since that version was cut.
  // This is a coarse check — we trust the maintainer's bump rather than
  // diff dist/index.d.ts against the registry tarball — but it catches
  // the most common drift: forgetting to bump after editing the SDK.
  if (pkg.private === true) return; // not publishable yet → guard is a no-op
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return;

  const latest = await fetchNpmLatest(pkg.name);
  if (latest === null) return; // package not on npm yet, or offline → no-op

  if (pkg.version !== latest) return; // version was bumped → guard satisfied

  // Same version as published. The dist/ output present here MUST be
  // byte-identical to what is on npm; we cannot verify that cheaply
  // without downloading the tarball, so we surface the guidance and
  // let CI fail if any SDK source actually changed in the same PR.
  // The runtime byte-equality check above already enforces the runtime
  // half; this check addresses the type-surface half.
  fail(
    `package.json version "${pkg.version}" matches the npm "latest" dist-tag — bump version per ADR-0019 §3 if any SDK surface changed`,
  );
}

async function main(): Promise<void> {
  console.log(`addon-sdk  ${SDK_DIR}`);
  await checkArtefacts();
  const pkgRaw = await readFile(PACKAGE_JSON, "utf8");
  const pkg = JSON.parse(pkgRaw) as PackageJson;
  await checkPackageJson();
  if (await exists(DIST_DTS)) await checkAmbientGlobal();
  await checkRuntimeByteEquality();
  await checkVersionBump(pkg);

  if (failures.length === 0) {
    console.log("verify-addon-sdk: ADR-0018 + ADR-0019 contract holds.");
    return;
  }
  console.error("");
  console.error(`verify-addon-sdk: ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`verify-addon-sdk: ${(err as Error).message}`);
  process.exit(1);
});
