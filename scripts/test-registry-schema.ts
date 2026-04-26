#!/usr/bin/env tsx
/**
 * pnpm test:registry-schema
 *
 * Synthetic-fixture tests for scripts/lib/registry-schema.ts. Uses
 * Node's built-in test runner so it does not require adding scripts/
 * to the pnpm workspace or pulling in vitest at the repo root.
 *
 * Run via tsx so TypeScript imports resolve, then execute the test
 * file (this file) — Node's test runner picks up `test()` calls
 * registered before the process exits.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { validateMetaIndex, validateRegistry, validateSubmissions } from "./lib/registry-schema.js";

const VALID_KEY = "RefyZUlMPbQgj8cdXqFOIofvBeuXmKZcBUpJ9mayybQ"; // 43-char base64url

// --------------------------------------------------------------------
// Registry — v1
// --------------------------------------------------------------------

test("validateRegistry: v1 minimal accepts", () => {
  const r = validateRegistry({
    v: 1,
    publisher: { name: "Test" },
    trustedKeys: [VALID_KEY],
    addons: [
      {
        id: "dev.test.foo",
        name: "Foo",
        version: "0.1.0",
        description: "x",
        path: "addons/foo",
        capabilities: ["a"],
      },
    ],
  });
  assert.equal(r.v, 1);
  assert.equal(r.addons.length, 1);
});

test("validateRegistry: v1 rejects v2-only fields on a v1 doc", () => {
  assert.throws(
    () =>
      validateRegistry({
        v: 1,
        publisher: { name: "Test" },
        trustedKeys: [VALID_KEY],
        addons: [
          {
            id: "dev.test.foo",
            name: "Foo",
            version: "0.1.0",
            description: "x",
            path: "addons/foo",
            capabilities: [],
            categories: ["communication"],
          },
        ],
      }),
    /categories: requires v >= 2/,
  );
});

// --------------------------------------------------------------------
// Registry — v2
// --------------------------------------------------------------------

test("validateRegistry: v2 with categories + tags + deprecated accepts", () => {
  const r = validateRegistry({
    v: 2,
    publisher: { name: "Test", homepage: "https://example.com" },
    trustedKeys: [VALID_KEY],
    addons: [
      {
        id: "dev.test.foo",
        name: "Foo",
        version: "0.2.0",
        description: "x",
        path: "addons/foo",
        capabilities: ["a"],
        categories: ["communication", "creative"],
        tags: ["hello", "world-1"],
      },
      {
        id: "dev.test.bar",
        name: "Bar",
        version: "0.0.9",
        description: "y",
        path: "addons/bar",
        capabilities: [],
        deprecated: {
          since: "2026-01-01T00:00:00Z",
          reason: "rolled into foo",
          supersededBy: "dev.test.foo",
        },
      },
    ],
  });
  assert.equal(r.addons[1]?.deprecated?.supersededBy, "dev.test.foo");
});

test("validateRegistry: v2 rejects unknown category", () => {
  assert.throws(
    () =>
      validateRegistry({
        v: 2,
        publisher: { name: "Test" },
        trustedKeys: [VALID_KEY],
        addons: [
          {
            id: "dev.test.foo",
            name: "Foo",
            version: "0.1.0",
            description: "x",
            path: "addons/foo",
            capabilities: [],
            categories: ["bogus"],
          },
        ],
      }),
    /categories: unknown "bogus"/,
  );
});

test("validateRegistry: v2 rejects deprecated.supersededBy pointing at unknown id", () => {
  assert.throws(
    () =>
      validateRegistry({
        v: 2,
        publisher: { name: "Test" },
        trustedKeys: [VALID_KEY],
        addons: [
          {
            id: "dev.test.bar",
            name: "Bar",
            version: "0.0.9",
            description: "y",
            path: "addons/bar",
            capabilities: [],
            deprecated: {
              since: "2026-01-01T00:00:00Z",
              reason: "x",
              supersededBy: "dev.test.does-not-exist",
            },
          },
        ],
      }),
    /supersededBy.*not present/,
  );
});

test("validateRegistry: v2 rejects v3-only field history on a v2 doc", () => {
  assert.throws(
    () =>
      validateRegistry({
        v: 2,
        publisher: { name: "Test" },
        trustedKeys: [VALID_KEY],
        addons: [
          {
            id: "dev.test.foo",
            name: "Foo",
            version: "0.2.0",
            description: "x",
            path: "addons/foo",
            capabilities: [],
            history: [
              {
                version: "0.1.0",
                path: "addons/foo/0.1.0/manifest.json",
                signedAt: "2026-01-01T00:00:00Z",
                publicKey: VALID_KEY,
              },
            ],
          },
        ],
      }),
    /history: requires v >= 3/,
  );
});

// --------------------------------------------------------------------
// Registry — v3
// --------------------------------------------------------------------

test("validateRegistry: v3 with history + audit accepts", () => {
  const r = validateRegistry({
    v: 3,
    publisher: { name: "Test" },
    trustedKeys: [VALID_KEY],
    addons: [
      {
        id: "dev.test.foo",
        name: "Foo",
        version: "0.2.0",
        description: "x",
        path: "addons/foo",
        capabilities: ["a"],
        history: [
          {
            version: "0.1.0",
            path: "addons/foo/0.1.0/manifest.json",
            signedAt: "2026-01-01T00:00:00Z",
            publicKey: VALID_KEY,
            changelog: "first release",
          },
          {
            version: "0.1.1",
            path: "addons/foo/0.1.1/manifest.json",
            signedAt: "2026-02-01T00:00:00Z",
            publicKey: VALID_KEY,
            yanked: { at: "2026-02-15T00:00:00Z", reason: "regression" },
          },
        ],
        audit: {
          auditor: "SENN Project security review",
          auditedAt: "2026-03-01T00:00:00Z",
          auditedVersion: "0.2.0",
          findings: { summary: "no critical issues", severityCounts: { high: 0, low: 2 } },
          url: "https://example.com/audit/foo-0.2.0",
        },
      },
    ],
  });
  assert.equal(r.v, 3);
  assert.equal(r.addons[0]?.history?.length, 2);
  assert.equal(r.addons[0]?.audit?.findings.severityCounts?.low, 2);
});

test("validateRegistry: v3 rejects history including the head version", () => {
  assert.throws(
    () =>
      validateRegistry({
        v: 3,
        publisher: { name: "Test" },
        trustedKeys: [VALID_KEY],
        addons: [
          {
            id: "dev.test.foo",
            name: "Foo",
            version: "0.2.0",
            description: "x",
            path: "addons/foo",
            capabilities: [],
            history: [
              {
                version: "0.2.0",
                path: "addons/foo/0.2.0/manifest.json",
                signedAt: "2026-03-01T00:00:00Z",
                publicKey: VALID_KEY,
              },
            ],
          },
        ],
      }),
    /must not include the head version/,
  );
});

test("validateRegistry: v3 rejects audit.auditedVersion that is not in history or head", () => {
  assert.throws(
    () =>
      validateRegistry({
        v: 3,
        publisher: { name: "Test" },
        trustedKeys: [VALID_KEY],
        addons: [
          {
            id: "dev.test.foo",
            name: "Foo",
            version: "0.2.0",
            description: "x",
            path: "addons/foo",
            capabilities: [],
            audit: {
              auditor: "SENN Project",
              auditedAt: "2026-03-01T00:00:00Z",
              auditedVersion: "9.9.9",
              findings: { summary: "ok" },
            },
          },
        ],
      }),
    /auditedVersion 9\.9\.9 is neither/,
  );
});

test("validateRegistry: v3 rejects duplicate version in history", () => {
  assert.throws(
    () =>
      validateRegistry({
        v: 3,
        publisher: { name: "Test" },
        trustedKeys: [VALID_KEY],
        addons: [
          {
            id: "dev.test.foo",
            name: "Foo",
            version: "0.3.0",
            description: "x",
            path: "addons/foo",
            capabilities: [],
            history: [
              {
                version: "0.1.0",
                path: "p1",
                signedAt: "2026-01-01T00:00:00Z",
                publicKey: VALID_KEY,
              },
              {
                version: "0.1.0",
                path: "p2",
                signedAt: "2026-02-01T00:00:00Z",
                publicKey: VALID_KEY,
              },
            ],
          },
        ],
      }),
    /duplicate version 0\.1\.0/,
  );
});

// --------------------------------------------------------------------
// Meta-index — ADR-0020 §3b extension
// --------------------------------------------------------------------

test("validateMetaIndex: accepts endorsedBy + endorsementUrl", () => {
  const m = validateMetaIndex({
    v: 1,
    kind: "senn-publisher-meta",
    publishers: [
      {
        url: "https://example.com/index.json",
        name: "Example",
        featured: true,
        endorsedBy: ["SENN Project"],
        endorsementUrl: "https://example.com/endorsement",
      },
    ],
  });
  assert.equal(m.publishers[0]?.endorsedBy?.[0], "SENN Project");
});

test("validateMetaIndex: rejects too many endorsedBy entries", () => {
  assert.throws(
    () =>
      validateMetaIndex({
        v: 1,
        kind: "senn-publisher-meta",
        publishers: [
          {
            url: "https://example.com/index.json",
            endorsedBy: Array.from({ length: 9 }, (_, i) => `e${i}`),
          },
        ],
      }),
    /endorsedBy: must have 1\.\.8 entries/,
  );
});

// --------------------------------------------------------------------
// Submissions — ADR-0020 §2
// --------------------------------------------------------------------

test("validateSubmissions: accepts a pending submission", () => {
  const s = validateSubmissions({
    v: 1,
    kind: "senn-publisher-submissions",
    submissions: [
      {
        id: "s-001",
        addonId: "dev.test.foo",
        version: "0.1.0",
        manifestUrl: "https://example.com/foo/0.1.0/manifest.json",
        signatureUrl: "https://example.com/foo/0.1.0/manifest.sig.json",
        publicKey: VALID_KEY,
        submittedAt: "2026-01-01T00:00:00Z",
        contact: "submitter@example.com",
        status: "pending",
        statusUpdatedAt: "2026-01-01T00:00:00Z",
      },
    ],
  });
  assert.equal(s.submissions[0]?.status, "pending");
});

test("validateSubmissions: requires statusReason when status != pending", () => {
  assert.throws(
    () =>
      validateSubmissions({
        v: 1,
        kind: "senn-publisher-submissions",
        submissions: [
          {
            id: "s-002",
            addonId: "dev.test.foo",
            version: "0.1.0",
            manifestUrl: "https://example.com/foo/0.1.0/manifest.json",
            signatureUrl: "https://example.com/foo/0.1.0/manifest.sig.json",
            publicKey: VALID_KEY,
            submittedAt: "2026-01-01T00:00:00Z",
            contact: "submitter@example.com",
            status: "rejected",
            statusUpdatedAt: "2026-01-02T00:00:00Z",
          },
        ],
      }),
    /statusReason: required when status != "pending"/,
  );
});

test("validateSubmissions: rejects unknown status", () => {
  assert.throws(
    () =>
      validateSubmissions({
        v: 1,
        kind: "senn-publisher-submissions",
        submissions: [
          {
            id: "s-003",
            addonId: "dev.test.foo",
            version: "0.1.0",
            manifestUrl: "https://example.com/x",
            signatureUrl: "https://example.com/y",
            publicKey: VALID_KEY,
            submittedAt: "2026-01-01T00:00:00Z",
            contact: "x@y.z",
            status: "approved",
            statusUpdatedAt: "2026-01-02T00:00:00Z",
          },
        ],
      }),
    /status: must be one of/,
  );
});

test("validateSubmissions: rejects duplicate submission id", () => {
  assert.throws(
    () =>
      validateSubmissions({
        v: 1,
        kind: "senn-publisher-submissions",
        submissions: [
          {
            id: "dup",
            addonId: "dev.test.foo",
            version: "0.1.0",
            manifestUrl: "https://example.com/x",
            signatureUrl: "https://example.com/y",
            publicKey: VALID_KEY,
            submittedAt: "2026-01-01T00:00:00Z",
            contact: "x@y.z",
            status: "pending",
            statusUpdatedAt: "2026-01-01T00:00:00Z",
          },
          {
            id: "dup",
            addonId: "dev.test.bar",
            version: "0.1.0",
            manifestUrl: "https://example.com/x",
            signatureUrl: "https://example.com/y",
            publicKey: VALID_KEY,
            submittedAt: "2026-01-02T00:00:00Z",
            contact: "x@y.z",
            status: "pending",
            statusUpdatedAt: "2026-01-02T00:00:00Z",
          },
        ],
      }),
    /duplicate "dup"/,
  );
});
