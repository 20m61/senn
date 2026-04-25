#!/usr/bin/env tsx
/**
 * pnpm verify:addon-sdk
 *
 * Regression guard for the @senn/addon-sdk package shape pinned by
 * ADR-0018. Checks that:
 *
 *   1. dist/index.{js,d.ts} exist and are non-empty.
 *   2. package.json exports map exposes the documented entry points.
 *   3. The "." entry resolves to dist/index.js with types pointing at
 *      dist/index.d.ts.
 *   4. The "./runtime/senn-addon-sdk.js" subpath export resolves to
 *      the actual classic-script runtime file.
 *   5. dist/index.d.ts re-exports the named types and declares the
 *      `Window.senn?` ambient global.
 *
 * Run after `pnpm --filter @senn/addon-sdk build` (or after a full
 * `pnpm typecheck`, which builds dist as a side-effect via project
 * references).
 */
import { access, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_DIR = resolve(REPO_ROOT, "packages/addon-sdk");

const DIST_JS = resolve(SDK_DIR, "dist/index.js");
const DIST_DTS = resolve(SDK_DIR, "dist/index.d.ts");
const RUNTIME_JS = resolve(SDK_DIR, "runtime/senn-addon-sdk.js");
const RUNTIME_DTS = resolve(SDK_DIR, "runtime/senn-addon-sdk.d.ts");
const PACKAGE_JSON = resolve(SDK_DIR, "package.json");

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
  readonly main?: unknown;
  readonly module?: unknown;
  readonly types?: unknown;
  readonly exports?: PackageExportsMap;
  readonly files?: unknown;
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
  if (pkg.name !== "@senn/addon-sdk") {
    fail(`package.json name = ${JSON.stringify(pkg.name)}, expected "@senn/addon-sdk"`);
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

async function main(): Promise<void> {
  console.log(`addon-sdk  ${SDK_DIR}`);
  await checkArtefacts();
  await checkPackageJson();
  if (await exists(DIST_DTS)) await checkAmbientGlobal();

  if (failures.length === 0) {
    console.log("verify-addon-sdk: ADR-0018 contract holds.");
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
