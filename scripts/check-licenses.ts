#!/usr/bin/env tsx
/**
 * pnpm check:licenses — license gate per docs/license-policy.md.
 *
 * Walks production transitive dependencies via
 *   `pnpm list -r --prod --json --depth Infinity`
 * locates each package's installed package.json on disk, evaluates its
 * declared license against the allow-list, and applies entries from
 * `LICENSE_OVERRIDES.json` when present.
 *
 * Scope (docs/license-policy.md §Scope) is production-only. Pure
 * devDependencies are intentionally not gated; they do not flow into
 * shipped artefacts.
 *
 * SPDX expression handling (v1):
 *   - bare identifier              — must be in ALLOWED
 *   - `(X OR Y)` / `X OR Y`        — at least one clause must be in ALLOWED
 *   - `X AND Y`                    — every clause must be in ALLOWED
 *   - WITH / + / nested / mixed    — fail-closed; require an override.
 *
 * Override schema is enforced strictly at load time:
 *   - required: name, version, license, tier, rationale, approvedBy, approvedAt
 *   - optional: expiresAt (ISO-8601; SHOULD be within 12 months)
 *   - additionalProperties: false
 *   - tier ∈ {"allowed", "review-required"}
 *   - disallowed-tier licenses (GPL/AGPL/SSPL/BUSL) MUST NOT be overridden.
 *
 * Emits one FAIL line per violation in
 *   `<pkg>@<ver>: <reason> (docs/license-policy.md)`
 * format and exits non-zero if any violation surfaces. The shape is
 * deliberately greppable so an AI coder PR can act on it without
 * re-reading the script.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED: ReadonlySet<string> = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
]);

const DISALLOWED_PREFIXES: readonly string[] = ["GPL", "AGPL", "SSPL", "BUSL"];

const OVERRIDE_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "version",
  "license",
  "tier",
  "rationale",
  "approvedBy",
  "approvedAt",
  "expiresAt",
]);

const REQUIRED_FIELDS: readonly string[] = [
  "name",
  "version",
  "license",
  "tier",
  "rationale",
  "approvedBy",
  "approvedAt",
];

interface Override {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly tier: "allowed" | "review-required";
  readonly rationale: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly expiresAt?: string;
}

interface PnpmDepNode {
  readonly from?: string;
  readonly version?: string;
  readonly path?: string;
  readonly dependencies?: Record<string, PnpmDepNode>;
}

interface PnpmWorkspaceNode {
  readonly name?: string;
  readonly version?: string;
  readonly path?: string;
  readonly private?: boolean;
  readonly dependencies?: Record<string, PnpmDepNode>;
}

interface PackageJsonLike {
  readonly name?: string;
  readonly version?: string;
  readonly license?: string | { readonly type?: string };
  readonly licenses?: ReadonlyArray<{ readonly type?: string }>;
}

function isIso8601Date(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function loadOverrides(): readonly Override[] {
  const path = "LICENSE_OVERRIDES.json";
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`LICENSE_OVERRIDES.json is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("LICENSE_OVERRIDES.json must be a JSON array of override objects");
  }
  return parsed.map((entry, i) => validateOverride(entry, i));
}

function validateOverride(entry: unknown, idx: number): Override {
  const where = `LICENSE_OVERRIDES.json[${idx}]`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`${where} must be an object`);
  }
  const obj = entry as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!OVERRIDE_FIELDS.has(k)) {
      throw new Error(
        `${where}: unknown field "${k}" — allowed: ${[...OVERRIDE_FIELDS].join(", ")}`,
      );
    }
  }
  for (const k of REQUIRED_FIELDS) {
    const v = obj[k];
    if (typeof v !== "string" || v === "") {
      throw new Error(`${where}: missing or empty required field "${k}"`);
    }
  }
  if (obj.tier !== "allowed" && obj.tier !== "review-required") {
    throw new Error(
      `${where}: tier must be "allowed" or "review-required", got ${JSON.stringify(obj.tier)}`,
    );
  }
  const approvedAt = obj.approvedAt as string;
  if (!isIso8601Date(approvedAt)) {
    throw new Error(`${where}: approvedAt must be ISO-8601 date (YYYY-MM-DD), got "${approvedAt}"`);
  }
  if ("expiresAt" in obj) {
    if (typeof obj.expiresAt !== "string" || !isIso8601Date(obj.expiresAt)) {
      throw new Error(
        `${where}: expiresAt must be ISO-8601 date (YYYY-MM-DD) if present, got ${JSON.stringify(obj.expiresAt)}`,
      );
    }
  }
  const lic = obj.license as string;
  // The override `license` field MUST be a bare SPDX identifier — no
  // expressions (no `OR`, `AND`, `WITH`, `+`, parentheses, whitespace).
  // This closes a defense-in-depth gap where a smuggled expression like
  // `(BUSL-1.1 OR MIT)` could slip past `isDisallowedSimple` (which
  // matches family prefixes only) and silently grant a disallowed
  // license cover via the override path.
  if (!/^[A-Za-z0-9.-]+$/.test(lic)) {
    throw new Error(
      `${where}: license "${lic}" must be a bare SPDX identifier (no expressions, no whitespace); split into per-license override entries if multiple are needed`,
    );
  }
  if (isDisallowedSimple(lic)) {
    const matched = DISALLOWED_PREFIXES.find((t) => lic === t || lic.startsWith(`${t}-`));
    throw new Error(
      `${where}: cannot override disallowed license "${lic}" — the ${matched ?? lic} family is unconditionally rejected per docs/license-policy.md §Overrides`,
    );
  }
  return obj as unknown as Override;
}

function isOverrideActive(o: Override, today: string): boolean {
  if (o.expiresAt === undefined) return true;
  // ISO-8601 YYYY-MM-DD compares lexicographically.
  return today <= o.expiresAt;
}

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function collectProdDeps(workspaces: readonly PnpmWorkspaceNode[]): ReadonlyMap<string, string> {
  const seen = new Map<string, string>();
  function visitDep(name: string, node: PnpmDepNode): void {
    if (
      node.version !== undefined &&
      node.path !== undefined &&
      !node.version.startsWith("link:") &&
      !node.version.startsWith("file:") &&
      !node.version.startsWith("workspace:")
    ) {
      const key = `${name}@${node.version}`;
      if (!seen.has(key)) seen.set(key, node.path);
    }
    if (node.dependencies !== undefined) {
      for (const [childName, child] of Object.entries(node.dependencies)) {
        visitDep(childName, child);
      }
    }
  }
  for (const ws of workspaces) {
    if (ws.dependencies !== undefined) {
      for (const [name, child] of Object.entries(ws.dependencies)) {
        visitDep(name, child);
      }
    }
  }
  return seen;
}

function readPackageJson(dir: string): PackageJsonLike {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJsonLike;
}

function extractLicenseString(pj: PackageJsonLike): string | null {
  if (typeof pj.license === "string") return pj.license;
  if (
    pj.license !== undefined &&
    typeof pj.license === "object" &&
    typeof pj.license.type === "string"
  ) {
    return pj.license.type;
  }
  if (pj.licenses !== undefined && Array.isArray(pj.licenses)) {
    const types = pj.licenses
      .map((l) => l?.type)
      .filter((t): t is string => typeof t === "string" && t !== "");
    if (types.length === 1) return types[0] ?? null;
    if (types.length > 1) return `(${types.join(" OR ")})`;
  }
  return null;
}

interface EvalOutcome {
  readonly ok: boolean;
  readonly reason?: string;
}

function isDisallowedSimple(license: string): boolean {
  // Match the family prefix only when followed by `-` (e.g. `GPL-3.0`,
  // `AGPL-3.0`, `BUSL-1.1`) or as the bare identifier itself
  // (`GPL`, `AGPL`, `SSPL`, `BUSL`). Prevents an unrelated license
  // whose name happens to begin with `GPL...` (e.g. a hypothetical
  // `GPLicense-Foo`) from accidentally tripping the disallow check —
  // and also prevents the inverse: a malicious license string like
  // `GPLicense-fake-allow` cannot bypass the disallow check by *not*
  // matching, because we still require the canonical SPDX form.
  return DISALLOWED_PREFIXES.some((t) => license === t || license.startsWith(`${t}-`));
}

function stripBalancedOuterParens(expr: string): string {
  let e = expr.trim();
  while (e.startsWith("(") && e.endsWith(")")) {
    let depth = 0;
    let balanced = true;
    const inner = e.slice(1, -1);
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth < 0) {
          balanced = false;
          break;
        }
      }
    }
    if (!balanced || depth !== 0) break;
    e = inner.trim();
  }
  return e;
}

function evaluateExpression(rawExpr: string): EvalOutcome {
  const expr = stripBalancedOuterParens(rawExpr);

  if (/\bWITH\b/.test(expr)) {
    return {
      ok: false,
      reason: `unsupported SPDX expression "${rawExpr}" (contains WITH); add to LICENSE_OVERRIDES.json with rationale`,
    };
  }
  if (expr.includes("+")) {
    return {
      ok: false,
      reason: `unsupported SPDX expression "${rawExpr}" (contains "+"); add to LICENSE_OVERRIDES.json with rationale`,
    };
  }
  if (expr.includes("(")) {
    return {
      ok: false,
      reason: `unsupported nested SPDX expression "${rawExpr}"; add to LICENSE_OVERRIDES.json with rationale`,
    };
  }

  const hasOr = /\bOR\b/.test(expr);
  const hasAnd = /\bAND\b/.test(expr);
  if (hasOr && hasAnd) {
    return {
      ok: false,
      reason: `unsupported mixed-operator SPDX expression "${rawExpr}"; add to LICENSE_OVERRIDES.json with rationale`,
    };
  }

  if (hasOr) {
    const parts = expr.split(/\bOR\b/).map((p) => p.trim());
    if (parts.some((p) => ALLOWED.has(p))) return { ok: true };
    const disallowed = parts.find((p) => isDisallowedSimple(p));
    if (disallowed) {
      return {
        ok: false,
        reason: `license expression "${rawExpr}" — ${disallowed} is disallowed (docs/license-policy.md)`,
      };
    }
    return {
      ok: false,
      reason: `license expression "${rawExpr}" — no clause is in the allow list (docs/license-policy.md)`,
    };
  }
  if (hasAnd) {
    const parts = expr.split(/\bAND\b/).map((p) => p.trim());
    const notAllowed = parts.find((p) => !ALLOWED.has(p));
    if (notAllowed !== undefined) {
      const reason = isDisallowedSimple(notAllowed)
        ? `license expression "${rawExpr}" — "${notAllowed}" is disallowed (docs/license-policy.md)`
        : `license expression "${rawExpr}" — "${notAllowed}" not in allow list (docs/license-policy.md)`;
      return { ok: false, reason };
    }
    return { ok: true };
  }

  if (ALLOWED.has(expr)) return { ok: true };
  if (isDisallowedSimple(expr)) {
    return {
      ok: false,
      reason: `license "${rawExpr}" is disallowed (docs/license-policy.md)`,
    };
  }
  return {
    ok: false,
    reason: `license "${rawExpr}" not in allow list (docs/license-policy.md)`,
  };
}

function main(): void {
  const today = todayIso();
  const overrides = loadOverrides();
  const overrideMap = new Map<string, Override>();
  for (const o of overrides) overrideMap.set(`${o.name}@${o.version}`, o);

  let raw: string;
  try {
    raw = execSync("pnpm list -r --prod --json --depth Infinity", {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(`pnpm list failed: ${(err as Error).message}`);
  }
  const workspaces = JSON.parse(raw) as PnpmWorkspaceNode[];
  const prodDeps = collectProdDeps(workspaces);

  const violations: string[] = [];
  let scanned = 0;
  let overridden = 0;
  for (const [key, path] of prodDeps) {
    scanned++;
    const ov = overrideMap.get(key);
    const ovActive = ov !== undefined && isOverrideActive(ov, today);
    if (ovActive) {
      overridden++;
      continue;
    }

    if (!existsSync(path)) {
      violations.push(
        `${key}: package directory missing at ${path} (run pnpm install --frozen-lockfile)`,
      );
      continue;
    }

    let pj: PackageJsonLike;
    try {
      pj = readPackageJson(path);
    } catch (err) {
      violations.push(`${key}: failed to read package.json: ${(err as Error).message}`);
      continue;
    }

    const lic = extractLicenseString(pj);
    if (lic === null) {
      violations.push(
        `${key}: package.json declares no license field — treated as "No license" (docs/license-policy.md §Disallowed)`,
      );
      continue;
    }

    const r = evaluateExpression(lic);
    if (r.ok) continue;

    if (ov !== undefined) {
      // Override exists but is expired.
      violations.push(
        `${key}: override expired (expiresAt=${ov.expiresAt ?? ""}); ${r.reason ?? "license rejected"} — renew or remove the override`,
      );
    } else {
      violations.push(`${key}: ${r.reason ?? "license rejected"}`);
    }
  }

  if (violations.length > 0) {
    console.error(
      `check-licenses: ${violations.length} violation(s) across ${scanned} production package(s):`,
    );
    for (const v of violations) console.error(`  FAIL  ${v}`);
    process.exit(1);
  }

  console.log(
    `check-licenses: ${scanned} production package(s) scanned; ${overridden} via LICENSE_OVERRIDES.json — all permitted (docs/license-policy.md)`,
  );
}

try {
  main();
} catch (err) {
  console.error(`check-licenses: ${(err as Error).message}`);
  process.exit(1);
}
