#!/usr/bin/env tsx
/**
 * Walk the workspace and report any package.json with a license outside the
 * allow list defined in docs/license-policy.md. Stub implementation — fills in
 * once we have real dependencies; for now, emits a friendly notice.
 */
const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
]);

console.log(`license check stub — allowed licenses: ${[...ALLOWED].join(", ")}`);
console.log("no dependencies installed yet; nothing to verify.");
