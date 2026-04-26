/**
 * Registry schema validators (v1 / v2 / v3). Pure functions over JSON
 * input; no filesystem, no signature verification. Used by both the
 * full `verify:official` chain and the schema-only `validate:registry`
 * CLI.
 *
 * Spec:
 *   - addons/official/README.md (v1 reference shape)
 *   - docs/adr/0017-registry-schema-v2.md (v2 additive fields)
 *   - docs/adr/0020-registry-schema-v3.md (v3 history / submissions / audit)
 */

// ADR-0017 v2 closed-enum categories.
export const KNOWN_CATEGORIES: readonly string[] = [
  "communication",
  "creative",
  "productivity",
  "presence",
  "files",
  "games",
  "education",
  "accessibility",
  "developer-tools",
  "other",
];

export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const ED25519_PUBKEY_PATTERN = /^[A-Za-z0-9_-]{43}$/; // base64url, 32 bytes → 43 chars

export interface AddonDeprecationV1 {
  readonly since: string;
  readonly reason: string;
  readonly supersededBy?: string;
}

// ADR-0020 §1
export interface AddonYankV1 {
  readonly at: string;
  readonly reason: string;
}

export interface AddonVersionEntryV1 {
  readonly version: string;
  readonly path: string;
  readonly signedAt: string;
  readonly publicKey: string;
  readonly changelog?: string;
  readonly yanked?: AddonYankV1;
}

// ADR-0020 §3a
export interface AddonAuditFindingsV1 {
  readonly summary: string;
  readonly severityCounts?: {
    readonly critical?: number;
    readonly high?: number;
    readonly medium?: number;
    readonly low?: number;
    readonly nit?: number;
  };
}

export interface AddonAuditV1 {
  readonly auditor: string;
  readonly auditedAt: string;
  readonly auditedVersion: string;
  readonly findings: AddonAuditFindingsV1;
  readonly url?: string;
}

export interface RegistryAddon {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly path: string;
  readonly capabilities: readonly string[];
  // v2
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
  readonly deprecated?: AddonDeprecationV1;
  // v3
  readonly history?: readonly AddonVersionEntryV1[];
  readonly audit?: AddonAuditV1;
}

export interface Registry {
  readonly v: 1 | 2 | 3;
  readonly publisher: { readonly name: string; readonly homepage?: string };
  readonly trustedKeys: readonly string[];
  readonly addons: readonly RegistryAddon[];
}

// ADR-0017 §3 + ADR-0020 §3b
export interface PublisherEntry {
  readonly url: string;
  readonly name?: string;
  readonly featured?: boolean;
  readonly endorsedBy?: readonly string[];
  readonly endorsementUrl?: string;
}

export interface PublisherMetaIndexV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-meta";
  readonly publishers: readonly PublisherEntry[];
}

// ADR-0020 §2
export type SubmissionStatusV1 =
  | "pending"
  | "needs-changes"
  | "accepted"
  | "rejected"
  | "withdrawn";

export interface SubmissionV1 {
  readonly id: string;
  readonly addonId: string;
  readonly version: string;
  readonly manifestUrl: string;
  readonly signatureUrl: string;
  readonly publicKey: string;
  readonly submittedAt: string;
  readonly contact: string;
  readonly status: SubmissionStatusV1;
  readonly statusUpdatedAt: string;
  readonly statusReason?: string;
  readonly notes?: string;
}

export interface PublisherSubmissionsV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-submissions";
  readonly submissions: readonly SubmissionV1[];
}

const SUBMISSION_STATUSES: ReadonlySet<SubmissionStatusV1> = new Set([
  "pending",
  "needs-changes",
  "accepted",
  "rejected",
  "withdrawn",
]);

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isIsoInstant(s: unknown): s is string {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

function validateAddonDeprecation(value: unknown, where: string): AddonDeprecationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}.deprecated: must be an object`);
  }
  const d = value as Record<string, unknown>;
  if (!isIsoInstant(d.since)) throw new Error(`${where}.deprecated.since: must be ISO-8601`);
  if (typeof d.reason !== "string" || d.reason.length === 0 || d.reason.length > 280) {
    throw new Error(`${where}.deprecated.reason: must be 1..280 char string`);
  }
  if (d.supersededBy !== undefined && typeof d.supersededBy !== "string") {
    throw new Error(`${where}.deprecated.supersededBy: must be a string when present`);
  }
  return {
    since: d.since,
    reason: d.reason,
    ...(typeof d.supersededBy === "string" ? { supersededBy: d.supersededBy } : {}),
  };
}

function validateYank(value: unknown, where: string): AddonYankV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}.yanked: must be an object`);
  }
  const y = value as Record<string, unknown>;
  if (!isIsoInstant(y.at)) throw new Error(`${where}.yanked.at: must be ISO-8601`);
  if (typeof y.reason !== "string" || y.reason.length === 0 || y.reason.length > 280) {
    throw new Error(`${where}.yanked.reason: must be 1..280 char string`);
  }
  return { at: y.at, reason: y.reason };
}

function validateHistoryEntry(value: unknown, where: string): AddonVersionEntryV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}: must be an object`);
  }
  const e = value as Record<string, unknown>;
  if (typeof e.version !== "string" || !SEMVER_PATTERN.test(e.version)) {
    throw new Error(`${where}.version: must be SemVer 2.0.0`);
  }
  if (typeof e.path !== "string" || e.path.length === 0) {
    throw new Error(`${where}.path: must be non-empty string`);
  }
  if (!isIsoInstant(e.signedAt)) throw new Error(`${where}.signedAt: must be ISO-8601`);
  if (typeof e.publicKey !== "string" || !ED25519_PUBKEY_PATTERN.test(e.publicKey)) {
    throw new Error(`${where}.publicKey: must be 43-char base64url Ed25519 key`);
  }
  if (e.changelog !== undefined) {
    if (typeof e.changelog !== "string") {
      throw new Error(`${where}.changelog: must be string when present`);
    }
    if (Buffer.byteLength(e.changelog, "utf8") > 2048) {
      throw new Error(`${where}.changelog: must be ≤ 2 KiB UTF-8`);
    }
  }
  const yanked = e.yanked === undefined ? undefined : validateYank(e.yanked, where);
  return {
    version: e.version,
    path: e.path,
    signedAt: e.signedAt,
    publicKey: e.publicKey,
    ...(typeof e.changelog === "string" ? { changelog: e.changelog } : {}),
    ...(yanked ? { yanked } : {}),
  };
}

function validateAuditFindings(value: unknown, where: string): AddonAuditFindingsV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}.findings: must be an object`);
  }
  const f = value as Record<string, unknown>;
  if (typeof f.summary !== "string" || f.summary.length === 0 || f.summary.length > 280) {
    throw new Error(`${where}.findings.summary: must be 1..280 char string`);
  }
  let severityCounts: AddonAuditFindingsV1["severityCounts"];
  if (f.severityCounts !== undefined) {
    if (
      !f.severityCounts ||
      typeof f.severityCounts !== "object" ||
      Array.isArray(f.severityCounts)
    ) {
      throw new Error(`${where}.findings.severityCounts: must be an object when present`);
    }
    const sc = f.severityCounts as Record<string, unknown>;
    const KEYS = ["critical", "high", "medium", "low", "nit"] as const;
    const out: Record<string, number> = {};
    for (const k of Object.keys(sc)) {
      if (!KEYS.includes(k as (typeof KEYS)[number])) {
        throw new Error(`${where}.findings.severityCounts: unknown key ${JSON.stringify(k)}`);
      }
      const v = sc[k];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        throw new Error(`${where}.findings.severityCounts.${k}: must be non-negative integer`);
      }
      out[k] = v;
    }
    severityCounts = out as AddonAuditFindingsV1["severityCounts"];
  }
  return {
    summary: f.summary,
    ...(severityCounts ? { severityCounts } : {}),
  };
}

function validateAudit(value: unknown, where: string): AddonAuditV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}.audit: must be an object`);
  }
  const a = value as Record<string, unknown>;
  if (typeof a.auditor !== "string" || a.auditor.length === 0 || a.auditor.length > 80) {
    throw new Error(`${where}.audit.auditor: must be 1..80 char string`);
  }
  if (!isIsoInstant(a.auditedAt)) throw new Error(`${where}.audit.auditedAt: must be ISO-8601`);
  if (typeof a.auditedVersion !== "string" || !SEMVER_PATTERN.test(a.auditedVersion)) {
    throw new Error(`${where}.audit.auditedVersion: must be SemVer 2.0.0`);
  }
  if (a.url !== undefined) {
    if (typeof a.url !== "string")
      throw new Error(`${where}.audit.url: must be string when present`);
    try {
      new URL(a.url);
    } catch {
      throw new Error(`${where}.audit.url: must be a valid URL`);
    }
  }
  const findings = validateAuditFindings(a.findings, `${where}.audit`);
  return {
    auditor: a.auditor,
    auditedAt: a.auditedAt,
    auditedVersion: a.auditedVersion,
    findings,
    ...(typeof a.url === "string" ? { url: a.url } : {}),
  };
}

export function validateRegistry(input: unknown): Registry {
  if (!input || typeof input !== "object") throw new Error("registry: not an object");
  const o = input as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2 && o.v !== 3) throw new Error("registry: v must be 1, 2, or 3");
  const v = o.v as 1 | 2 | 3;
  const pub = o.publisher;
  if (!pub || typeof pub !== "object") throw new Error("registry: publisher must be an object");
  const publisher = pub as Record<string, unknown>;
  if (typeof publisher.name !== "string")
    throw new Error("registry: publisher.name must be string");
  if (!isStringArray(o.trustedKeys) || o.trustedKeys.length === 0) {
    throw new Error("registry: trustedKeys must be a non-empty string array");
  }
  if (!Array.isArray(o.addons)) throw new Error("registry: addons must be an array");
  const addons: RegistryAddon[] = o.addons.map((raw, i) => {
    const where = `addon[${i}]`;
    if (!raw || typeof raw !== "object") throw new Error(`${where}: not an object`);
    const a = raw as Record<string, unknown>;
    for (const k of ["id", "name", "version", "description", "path"]) {
      if (typeof a[k] !== "string") throw new Error(`${where}.${k}: must be string`);
    }
    if (typeof a.id === "string" && !ID_PATTERN.test(a.id)) {
      throw new Error(`${where}.id: must be reverse-DNS (got ${JSON.stringify(a.id)})`);
    }
    if (typeof a.version === "string" && !SEMVER_PATTERN.test(a.version)) {
      throw new Error(`${where}.version: must be SemVer 2.0.0`);
    }
    if (!isStringArray(a.capabilities)) {
      throw new Error(`${where}.capabilities: must be string array`);
    }
    let categories: readonly string[] | undefined;
    if (a.categories !== undefined) {
      if (v < 2) throw new Error(`${where}.categories: requires v >= 2`);
      if (!isStringArray(a.categories)) {
        throw new Error(`${where}.categories: must be string array`);
      }
      for (const c of a.categories) {
        if (!KNOWN_CATEGORIES.includes(c)) {
          throw new Error(
            `${where}.categories: unknown ${JSON.stringify(c)} (allowed: ${KNOWN_CATEGORIES.join(", ")})`,
          );
        }
      }
      categories = a.categories;
    }
    let tags: readonly string[] | undefined;
    if (a.tags !== undefined) {
      if (v < 2) throw new Error(`${where}.tags: requires v >= 2`);
      if (!isStringArray(a.tags)) throw new Error(`${where}.tags: must be string array`);
      if (a.tags.length > 8) throw new Error(`${where}.tags: at most 8 entries`);
      for (const t of a.tags) {
        if (!TAG_PATTERN.test(t)) {
          throw new Error(`${where}.tags: invalid ${JSON.stringify(t)} (kebab-case, ≤32 chars)`);
        }
      }
      tags = a.tags;
    }
    let deprecated: AddonDeprecationV1 | undefined;
    if (a.deprecated !== undefined) {
      if (v < 2) throw new Error(`${where}.deprecated: requires v >= 2`);
      deprecated = validateAddonDeprecation(a.deprecated, where);
    }
    let history: AddonVersionEntryV1[] | undefined;
    if (a.history !== undefined) {
      if (v < 3) throw new Error(`${where}.history: requires v >= 3`);
      if (!Array.isArray(a.history)) throw new Error(`${where}.history: must be an array`);
      const seen = new Set<string>();
      const list: AddonVersionEntryV1[] = [];
      for (let j = 0; j < a.history.length; j++) {
        const entry = validateHistoryEntry(a.history[j], `${where}.history[${j}]`);
        if (seen.has(entry.version)) {
          throw new Error(`${where}.history: duplicate version ${entry.version}`);
        }
        seen.add(entry.version);
        list.push(entry);
      }
      // The head version must NOT also appear in history (per ADR-0020 §1).
      if (typeof a.version === "string" && seen.has(a.version)) {
        throw new Error(
          `${where}.history: must not include the head version ${a.version} (head lives at outer .version/.path)`,
        );
      }
      history = list;
    }
    let audit: AddonAuditV1 | undefined;
    if (a.audit !== undefined) {
      if (v < 3) throw new Error(`${where}.audit: requires v >= 3`);
      audit = validateAudit(a.audit, where);
      // Cross-check: auditedVersion must match the head OR an entry in history[].
      const known = new Set<string>([...(history?.map((h) => h.version) ?? [])]);
      if (typeof a.version === "string") known.add(a.version);
      if (!known.has(audit.auditedVersion)) {
        throw new Error(
          `${where}.audit.auditedVersion ${audit.auditedVersion} is neither the head version nor present in history[]`,
        );
      }
    }
    return {
      id: a.id as string,
      name: a.name as string,
      version: a.version as string,
      description: a.description as string,
      path: a.path as string,
      capabilities: a.capabilities,
      ...(categories ? { categories } : {}),
      ...(tags ? { tags } : {}),
      ...(deprecated ? { deprecated } : {}),
      ...(history ? { history } : {}),
      ...(audit ? { audit } : {}),
    };
  });
  // Cross-check: deprecated.supersededBy SHOULD point at another id in this registry.
  const ids = new Set(addons.map((a) => a.id));
  for (const a of addons) {
    if (a.deprecated?.supersededBy && !ids.has(a.deprecated.supersededBy)) {
      throw new Error(
        `addon ${a.id}: deprecated.supersededBy ${a.deprecated.supersededBy} is not present in this registry`,
      );
    }
  }
  return {
    v,
    publisher: {
      name: publisher.name,
      ...(typeof publisher.homepage === "string" ? { homepage: publisher.homepage } : {}),
    },
    trustedKeys: o.trustedKeys,
    addons,
  };
}

export function validateMetaIndex(input: unknown): PublisherMetaIndexV1 {
  if (!input || typeof input !== "object") throw new Error("meta: not an object");
  const o = input as Record<string, unknown>;
  if (o.v !== 1) throw new Error("meta: v must be 1");
  if (o.kind !== "senn-publisher-meta") {
    throw new Error('meta: kind must be "senn-publisher-meta"');
  }
  if (!Array.isArray(o.publishers)) throw new Error("meta: publishers must be an array");
  if (o.publishers.length === 0) throw new Error("meta: publishers must be non-empty");
  const seen = new Set<string>();
  const publishers: PublisherEntry[] = o.publishers.map((raw, i) => {
    const where = `meta.publishers[${i}]`;
    if (!raw || typeof raw !== "object") throw new Error(`${where}: not an object`);
    const p = raw as Record<string, unknown>;
    if (typeof p.url !== "string") throw new Error(`${where}.url: must be a string`);
    let parsed: URL;
    try {
      parsed = new URL(p.url);
    } catch {
      throw new Error(`${where}.url: ${JSON.stringify(p.url)} is not an absolute URL`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`${where}.url: must use http(s), got ${parsed.protocol}`);
    }
    if (seen.has(p.url)) throw new Error(`${where}.url: duplicate ${JSON.stringify(p.url)}`);
    seen.add(p.url);
    if (p.name !== undefined) {
      if (typeof p.name !== "string" || p.name.length === 0 || p.name.length > 80) {
        throw new Error(`${where}.name: must be 1..80 char string when present`);
      }
    }
    if (p.featured !== undefined && typeof p.featured !== "boolean") {
      throw new Error(`${where}.featured: must be boolean when present`);
    }
    // ADR-0020 §3b — endorsedBy / endorsementUrl. Additive, decorative.
    let endorsedBy: readonly string[] | undefined;
    if (p.endorsedBy !== undefined) {
      if (!isStringArray(p.endorsedBy)) {
        throw new Error(`${where}.endorsedBy: must be a string array when present`);
      }
      if (p.endorsedBy.length === 0 || p.endorsedBy.length > 8) {
        throw new Error(`${where}.endorsedBy: must have 1..8 entries when present`);
      }
      for (const e of p.endorsedBy) {
        if (e.length === 0 || e.length > 80) {
          throw new Error(`${where}.endorsedBy: each label must be 1..80 chars`);
        }
      }
      endorsedBy = p.endorsedBy;
    }
    if (p.endorsementUrl !== undefined) {
      if (typeof p.endorsementUrl !== "string") {
        throw new Error(`${where}.endorsementUrl: must be a string when present`);
      }
      try {
        new URL(p.endorsementUrl);
      } catch {
        throw new Error(`${where}.endorsementUrl: must be a valid URL`);
      }
    }
    return {
      url: p.url,
      ...(typeof p.name === "string" ? { name: p.name } : {}),
      ...(typeof p.featured === "boolean" ? { featured: p.featured } : {}),
      ...(endorsedBy ? { endorsedBy } : {}),
      ...(typeof p.endorsementUrl === "string" ? { endorsementUrl: p.endorsementUrl } : {}),
    };
  });
  return { v: 1, kind: "senn-publisher-meta", publishers };
}

export function validateSubmissions(input: unknown): PublisherSubmissionsV1 {
  if (!input || typeof input !== "object") throw new Error("submissions: not an object");
  const o = input as Record<string, unknown>;
  if (o.v !== 1) throw new Error("submissions: v must be 1");
  if (o.kind !== "senn-publisher-submissions") {
    throw new Error('submissions: kind must be "senn-publisher-submissions"');
  }
  if (!Array.isArray(o.submissions)) {
    throw new Error("submissions: submissions must be an array");
  }
  const seenIds = new Set<string>();
  const submissions: SubmissionV1[] = o.submissions.map((raw, i) => {
    const where = `submissions[${i}]`;
    if (!raw || typeof raw !== "object") throw new Error(`${where}: not an object`);
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || s.id.length === 0) {
      throw new Error(`${where}.id: must be non-empty string`);
    }
    if (seenIds.has(s.id)) throw new Error(`${where}.id: duplicate ${JSON.stringify(s.id)}`);
    seenIds.add(s.id);
    if (typeof s.addonId !== "string" || !ID_PATTERN.test(s.addonId)) {
      throw new Error(`${where}.addonId: must be reverse-DNS`);
    }
    if (typeof s.version !== "string" || !SEMVER_PATTERN.test(s.version)) {
      throw new Error(`${where}.version: must be SemVer 2.0.0`);
    }
    for (const k of ["manifestUrl", "signatureUrl"] as const) {
      if (typeof s[k] !== "string") throw new Error(`${where}.${k}: must be string`);
      try {
        new URL(s[k] as string);
      } catch {
        throw new Error(`${where}.${k}: must be a valid URL`);
      }
    }
    if (typeof s.publicKey !== "string" || !ED25519_PUBKEY_PATTERN.test(s.publicKey)) {
      throw new Error(`${where}.publicKey: must be 43-char base64url Ed25519 key`);
    }
    if (!isIsoInstant(s.submittedAt)) throw new Error(`${where}.submittedAt: must be ISO-8601`);
    if (typeof s.contact !== "string" || s.contact.length === 0 || s.contact.length > 200) {
      throw new Error(`${where}.contact: must be 1..200 char string`);
    }
    if (typeof s.status !== "string" || !SUBMISSION_STATUSES.has(s.status as SubmissionStatusV1)) {
      throw new Error(`${where}.status: must be one of ${[...SUBMISSION_STATUSES].join(", ")}`);
    }
    if (!isIsoInstant(s.statusUpdatedAt)) {
      throw new Error(`${where}.statusUpdatedAt: must be ISO-8601`);
    }
    if (
      s.status !== "pending" &&
      (typeof s.statusReason !== "string" || s.statusReason.length === 0)
    ) {
      throw new Error(`${where}.statusReason: required when status != "pending"`);
    }
    if (s.statusReason !== undefined) {
      if (typeof s.statusReason !== "string" || s.statusReason.length > 280) {
        throw new Error(`${where}.statusReason: must be ≤ 280 char string when present`);
      }
    }
    if (s.notes !== undefined) {
      if (typeof s.notes !== "string")
        throw new Error(`${where}.notes: must be string when present`);
      if (Buffer.byteLength(s.notes, "utf8") > 2048) {
        throw new Error(`${where}.notes: must be ≤ 2 KiB UTF-8`);
      }
    }
    return {
      id: s.id,
      addonId: s.addonId,
      version: s.version,
      manifestUrl: s.manifestUrl as string,
      signatureUrl: s.signatureUrl as string,
      publicKey: s.publicKey,
      submittedAt: s.submittedAt,
      contact: s.contact,
      status: s.status as SubmissionStatusV1,
      statusUpdatedAt: s.statusUpdatedAt,
      ...(typeof s.statusReason === "string" ? { statusReason: s.statusReason } : {}),
      ...(typeof s.notes === "string" ? { notes: s.notes } : {}),
    };
  });
  return { v: 1, kind: "senn-publisher-submissions", submissions };
}
