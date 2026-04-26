/**
 * SENN Add-on Gallery — discovery + trust display + install hand-off.
 *
 * Spec: docs/adr/0016-addon-gallery.md.
 *
 * The gallery is read-only. It fetches publisher registries the user
 * configures (default: the SENN web app at the current origin or
 * 127.0.0.1:5173 in dev), re-verifies every signed manifest in the
 * browser using @senn/manifest's verifyManifest, and emits a
 * deep-link URL the user's preferred SENN host can pick up.
 */

import {
  type ManifestSignatureV1,
  type VerifyResult,
  validateSignaturePayload,
  verifyManifest,
} from "@senn/manifest";

// Accepts ADR-0017 v1/v2 + ADR-0020 v3 inputs.
interface AddonDeprecation {
  readonly since: string;
  readonly reason: string;
  readonly supersededBy?: string;
}

interface AddonYank {
  readonly at: string;
  readonly reason: string;
}

interface AddonVersionEntry {
  readonly version: string;
  readonly path: string;
  readonly signedAt: string;
  readonly publicKey: string;
  readonly changelog?: string;
  readonly yanked?: AddonYank;
}

interface AddonAuditFindings {
  readonly summary: string;
  readonly severityCounts?: {
    readonly critical?: number;
    readonly high?: number;
    readonly medium?: number;
    readonly low?: number;
    readonly nit?: number;
  };
}

interface AddonAudit {
  readonly auditor: string;
  readonly auditedAt: string;
  readonly auditedVersion: string;
  readonly findings: AddonAuditFindings;
  readonly url?: string;
}

interface RegistryAddonV1 {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly path: string;
  readonly capabilities: readonly string[];
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
  readonly deprecated?: AddonDeprecation;
  // ADR-0020 v3 — optional.
  readonly history?: readonly AddonVersionEntry[];
  readonly audit?: AddonAudit;
}

interface RegistryV1 {
  readonly v: 1 | 2 | 3;
  readonly publisher: { readonly name: string; readonly homepage?: string };
  readonly trustedKeys: readonly string[];
  readonly addons: readonly RegistryAddonV1[];
}

interface RegistryEntry {
  readonly url: string; // user-provided URL of index.json
}

interface AddonManifestV1 {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly entry?: string;
  readonly license?: string;
  readonly permissions?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly description?: string;
}

interface AddonRow {
  readonly registryUrl: string;
  readonly registry: RegistryV1;
  readonly addon: RegistryAddonV1;
  readonly manifestUrl: string;
  readonly sigUrl: string;
  readonly manifest: AddonManifestV1 | null;
  readonly signature: ManifestSignatureV1 | null;
  readonly verifyResult: VerifyResult;
  readonly fetchError?: string;
  // ADR-0017 §3 — when a user-configured URL was a meta-index, this is
  // the source meta URL the publisher was discovered through.
  readonly metaSourceUrl?: string;
  readonly metaSourceName?: string;
  readonly metaFeatured?: boolean;
}

// ADR-0017 §3 — PublisherMetaIndexV1, extended by ADR-0020 §3b.
interface PublisherEntryV1 {
  readonly url: string;
  readonly name?: string;
  readonly featured?: boolean;
  readonly endorsedBy?: readonly string[];
  readonly endorsementUrl?: string;
}

interface PublisherMetaIndexV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-meta";
  readonly publishers: readonly PublisherEntryV1[];
}

interface MetaPublisherError {
  readonly url: string;
  readonly name?: string;
  readonly message: string;
}

interface MetaSummary {
  readonly url: string;
  readonly publisherCount: number;
  readonly featuredCount: number;
  readonly errors: readonly MetaPublisherError[];
  // ADR-0020 §3b — endorsement decorations are surfaced per meta row, but
  // the summary keeps a flat count so the registry-list caption can append
  // a tail like "· 2 endorsed".
  readonly endorsedCount: number;
}

// ADR-0020 §2 — PublisherSubmissionsV1.
type SubmissionStatus = "pending" | "needs-changes" | "accepted" | "rejected" | "withdrawn";

interface SubmissionV1 {
  readonly id: string;
  readonly addonId: string;
  readonly version: string;
  readonly manifestUrl: string;
  readonly signatureUrl: string;
  readonly publicKey: string;
  readonly submittedAt: string;
  readonly contact: string;
  readonly status: SubmissionStatus;
  readonly statusUpdatedAt: string;
  readonly statusReason?: string;
  readonly notes?: string;
}

interface PublisherSubmissionsV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-submissions";
  readonly submissions: readonly SubmissionV1[];
}

interface SubmissionsSummary {
  readonly url: string;
  readonly count: number;
}

const LS_REGISTRIES = "senn.gallery.registries";
const LS_HOST_ORIGIN = "senn.gallery.host-origin";

function basePath(): string {
  // Vite injects BASE_URL at build time; on Pages the deploy workflow sets
  // it to "/<repo>/", in dev it stays "/". Always shaped as "/<...>/" or "/".
  // The narrow cast avoids pulling vite/client types into the gallery's
  // tsconfig — the gallery is a single-file vanilla TS app.
  const meta = import.meta as { env?: { BASE_URL?: string } };
  const b = (meta.env?.BASE_URL ?? "/").trim();
  if (b.length === 0) return "/";
  return b.endsWith("/") ? b : `${b}/`;
}

function defaultRegistryUrl(): string {
  // In dev the SENN web app commonly runs at 127.0.0.1:5173. In production
  // the gallery may be served from a different origin than the host, so
  // fall back to a well-known absolute URL the user can edit.
  if (typeof location !== "undefined" && location.origin) {
    // If the gallery is served from the same origin as the host, the
    // registry mirror is at <base>registry/official/index.json (matches
    // apps/web/public/registry/official/index.json, optionally prefixed
    // by Vite's BASE_URL when deployed to a subpath like GitHub Pages).
    return `${location.origin.replace(/\/+$/, "")}${basePath()}registry/official/index.json`;
  }
  return "http://127.0.0.1:5173/registry/official/index.json";
}

function readRegistries(): RegistryEntry[] {
  try {
    const raw = localStorage.getItem(LS_REGISTRIES);
    if (!raw) return [{ url: defaultRegistryUrl() }];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [{ url: defaultRegistryUrl() }];
    const seen = new Set<string>();
    const out: RegistryEntry[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as { url?: unknown }).url === "string"
      ) {
        const url = (item as { url: string }).url;
        if (!seen.has(url)) {
          seen.add(url);
          out.push({ url });
        }
      }
    }
    return out.length > 0 ? out : [{ url: defaultRegistryUrl() }];
  } catch {
    return [{ url: defaultRegistryUrl() }];
  }
}

function writeRegistries(entries: RegistryEntry[]): void {
  localStorage.setItem(LS_REGISTRIES, JSON.stringify(entries));
}

function readHostOrigin(): string {
  return localStorage.getItem(LS_HOST_ORIGIN) ?? "";
}

function writeHostOrigin(origin: string): void {
  if (origin) localStorage.setItem(LS_HOST_ORIGIN, origin);
  else localStorage.removeItem(LS_HOST_ORIGIN);
}

function fingerprintKey(b64url: string): string {
  // Display the first 8 + last 4 chars of the base64url public key
  // — enough for users to compare against the publisher's posted key.
  if (b64url.length <= 14) return b64url;
  return `${b64url.slice(0, 8)}…${b64url.slice(-4)}`;
}

function basenameOfPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

function manifestUrlFor(registryUrl: string, addonPath: string): string {
  // The registry's `path` is repo-relative ("apps/web/public/addons/echo").
  // We use the basename and resolve relative to the registry URL's parent
  // directory, so a registry served at /<prefix>/registry/<publisher>/index.json
  // (the apps/web/public layout, optionally prefixed for subpath deploys
  // like GitHub Pages) finds its manifests at /<prefix>/addons/<slug>/...
  // When the registry URL doesn't match the convention we fall back to
  // <origin>/addons/<slug>/... which preserves the v1 behaviour.
  const u = new URL(registryUrl);
  const base = basenameOfPath(addonPath);
  const m = u.pathname.match(/^(.*)\/registry\/[^/]+\/[^/]+$/);
  if (m) {
    return new URL(`${m[1]}/addons/${base}/manifest.json`, u.origin).toString();
  }
  return new URL(`/addons/${base}/manifest.json`, u.origin).toString();
}

function sigUrlFor(manifestUrl: string): string {
  return new URL("manifest.sig.json", manifestUrl).toString();
}

// Default RequestCache is "default" (browser obeys HTTP cache headers).
// When the user clicks Refresh, every fetch in the run is forced to
// revalidate via "reload" so stale entries do not persist.
let currentCacheMode: RequestCache = "default";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "omit", cache: currentCacheMode });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: "omit", cache: currentCacheMode });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function isSubmissionsIndex(value: unknown): value is PublisherSubmissionsV1 {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (o.kind !== "senn-publisher-submissions") return false;
  if (!Array.isArray(o.submissions)) return false;
  for (const s of o.submissions) {
    if (typeof s !== "object" || s === null) return false;
    const r = s as Record<string, unknown>;
    for (const k of [
      "id",
      "addonId",
      "version",
      "manifestUrl",
      "signatureUrl",
      "publicKey",
      "submittedAt",
      "contact",
      "status",
      "statusUpdatedAt",
    ]) {
      if (typeof r[k] !== "string") return false;
    }
  }
  return true;
}

function isMetaIndex(value: unknown): value is PublisherMetaIndexV1 {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (o.kind !== "senn-publisher-meta") return false;
  if (!Array.isArray(o.publishers) || o.publishers.length === 0) return false;
  for (const p of o.publishers) {
    if (typeof p !== "object" || p === null) return false;
    if (typeof (p as { url?: unknown }).url !== "string") return false;
  }
  return true;
}

function normalizeEndorsedBy(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t.length === 0 || t.length > 80) continue;
    out.push(t);
    if (out.length >= 8) break;
  }
  return out.length > 0 ? out : undefined;
}

function normalizeEndorsementUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

function normalizeMetaIndex(value: PublisherMetaIndexV1): PublisherMetaIndexV1 {
  const seen = new Set<string>();
  const publishers: PublisherEntryV1[] = [];
  for (const p of value.publishers) {
    if (seen.has(p.url)) continue;
    try {
      const parsed = new URL(p.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    } catch {
      continue;
    }
    seen.add(p.url);
    const endorsedBy = normalizeEndorsedBy((p as { endorsedBy?: unknown }).endorsedBy);
    const endorsementUrl = normalizeEndorsementUrl(
      (p as { endorsementUrl?: unknown }).endorsementUrl,
    );
    publishers.push({
      url: p.url,
      ...(typeof p.name === "string" && p.name.length > 0 && p.name.length <= 80
        ? { name: p.name }
        : {}),
      ...(typeof p.featured === "boolean" ? { featured: p.featured } : {}),
      ...(endorsedBy ? { endorsedBy } : {}),
      ...(endorsementUrl ? { endorsementUrl } : {}),
    });
  }
  // Featured publishers come first; original order preserved within groups.
  publishers.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));
  return { v: 1, kind: "senn-publisher-meta", publishers };
}

function isRegistry(value: unknown): value is RegistryV1 {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2 && o.v !== 3) return false;
  if (typeof o.publisher !== "object" || o.publisher === null) return false;
  const pub = o.publisher as Record<string, unknown>;
  if (typeof pub.name !== "string") return false;
  if (!Array.isArray(o.trustedKeys) || o.trustedKeys.some((k) => typeof k !== "string")) {
    return false;
  }
  if (!Array.isArray(o.addons)) return false;
  for (const a of o.addons) {
    if (typeof a !== "object" || a === null) return false;
    const r = a as Record<string, unknown>;
    for (const k of ["id", "name", "version", "description", "path"]) {
      if (typeof r[k] !== "string") return false;
    }
    if (!Array.isArray(r.capabilities) || r.capabilities.some((c) => typeof c !== "string")) {
      return false;
    }
  }
  return true;
}

interface LoadOptions {
  readonly metaSourceUrl?: string;
  readonly metaSourceName?: string;
  readonly metaFeatured?: boolean;
}

async function loadPublisherIndex(
  url: string,
  opts: LoadOptions = {},
): Promise<{ registry: RegistryV1; addons: AddonRow[] }> {
  const value = await fetchJson<unknown>(url);
  if (isMetaIndex(value)) {
    throw new Error(
      `expected a publisher index but received a meta-index at ${url} — meta-of-meta is not supported`,
    );
  }
  if (!isRegistry(value)) throw new Error(`registry schema invalid: ${url}`);
  const registry = value;
  const trustedKeys = new Set(registry.trustedKeys);
  const rows = await Promise.all(
    registry.addons.map(async (addon): Promise<AddonRow> => {
      const manifestUrl = manifestUrlFor(url, addon.path);
      const sigUrl = sigUrlFor(manifestUrl);
      try {
        const [manifestBytes, sigJson] = await Promise.all([
          fetchBytes(manifestUrl),
          fetchJson<unknown>(sigUrl),
        ]);
        const signature = validateSignaturePayload(sigJson);
        const verifyResult = await verifyManifest({
          manifestBytes,
          signature,
          trustedKeys,
        });
        let manifest: AddonManifestV1 | null = null;
        try {
          manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as AddonManifestV1;
        } catch {
          /* manifest body parse error surfaces in the card */
        }
        return {
          registryUrl: url,
          registry,
          addon,
          manifestUrl,
          sigUrl,
          manifest,
          signature,
          verifyResult,
          ...(opts.metaSourceUrl ? { metaSourceUrl: opts.metaSourceUrl } : {}),
          ...(opts.metaSourceName ? { metaSourceName: opts.metaSourceName } : {}),
          ...(opts.metaFeatured ? { metaFeatured: true } : {}),
        };
      } catch (err) {
        return {
          registryUrl: url,
          registry,
          addon,
          manifestUrl,
          sigUrl,
          manifest: null,
          signature: null,
          verifyResult: { ok: false, reason: "fetch-error" },
          fetchError: (err as Error).message,
          ...(opts.metaSourceUrl ? { metaSourceUrl: opts.metaSourceUrl } : {}),
          ...(opts.metaSourceName ? { metaSourceName: opts.metaSourceName } : {}),
          ...(opts.metaFeatured ? { metaFeatured: true } : {}),
        };
      }
    }),
  );
  return { registry, addons: rows };
}

interface LoadResult {
  readonly registries: ReadonlyArray<{ url: string; registry: RegistryV1 }>;
  readonly addons: AddonRow[];
  readonly meta?: MetaSummary;
  // The meta-index's publisher entries, in normalized order. Used to render
  // endorsement chips next to each publisher's row.
  readonly metaPublishers?: readonly PublisherEntryV1[];
  // ADR-0020 §2 — when the URL turned out to be a submissions document, the
  // parsed body. Surfaces in the dedicated Submissions section below.
  readonly submissions?: PublisherSubmissionsV1;
}

async function loadFromUrl(url: string): Promise<LoadResult> {
  // Fetch once; decide whether it is a meta-index, submissions doc, or a
  // publisher index.
  const value = await fetchJson<unknown>(url);
  if (isSubmissionsIndex(value)) {
    return { registries: [], addons: [], submissions: value };
  }
  if (isMetaIndex(value)) {
    const meta = normalizeMetaIndex(value);
    type Resolved =
      | { ok: true; entry: PublisherEntryV1; registry: RegistryV1; addons: AddonRow[] }
      | { ok: false; entry: PublisherEntryV1; error: string };
    const results: Resolved[] = await Promise.all(
      meta.publishers.map(async (entry): Promise<Resolved> => {
        try {
          const { registry, addons } = await loadPublisherIndex(entry.url, {
            metaSourceUrl: url,
            ...(entry.name ? { metaSourceName: entry.name } : {}),
            ...(entry.featured ? { metaFeatured: true } : {}),
          });
          return { ok: true, entry, registry, addons };
        } catch (err) {
          return { ok: false, entry, error: (err as Error).message };
        }
      }),
    );
    const registries: Array<{ url: string; registry: RegistryV1 }> = [];
    const addons: AddonRow[] = [];
    const errors: MetaPublisherError[] = [];
    for (const r of results) {
      if (r.ok) {
        registries.push({ url: r.entry.url, registry: r.registry });
        addons.push(...r.addons);
      } else {
        errors.push({
          url: r.entry.url,
          ...(r.entry.name ? { name: r.entry.name } : {}),
          message: r.error,
        });
      }
    }
    if (registries.length === 0) {
      const detail = errors.map((e) => `${e.url}: ${e.message}`).join("; ");
      throw new Error(`meta-index at ${url} resolved no publishers (${detail || "no entries"})`);
    }
    const featuredCount = meta.publishers.reduce((n, p) => n + (p.featured ? 1 : 0), 0);
    const endorsedCount = meta.publishers.reduce(
      (n, p) => n + ((p.endorsedBy?.length ?? 0) > 0 ? 1 : 0),
      0,
    );
    return {
      registries,
      addons,
      meta: {
        url,
        publisherCount: meta.publishers.length,
        featuredCount,
        endorsedCount,
        errors,
      },
      metaPublishers: meta.publishers,
    };
  }
  if (!isRegistry(value)) throw new Error(`registry schema invalid: ${url}`);
  const registry = value;
  const trustedKeys = new Set(registry.trustedKeys);
  const rows = await Promise.all(
    registry.addons.map(async (addon): Promise<AddonRow> => {
      const manifestUrl = manifestUrlFor(url, addon.path);
      const sigUrl = sigUrlFor(manifestUrl);
      try {
        const [manifestBytes, sigJson] = await Promise.all([
          fetchBytes(manifestUrl),
          fetchJson<unknown>(sigUrl),
        ]);
        const signature = validateSignaturePayload(sigJson);
        const verifyResult = await verifyManifest({
          manifestBytes,
          signature,
          trustedKeys,
        });
        let manifest: AddonManifestV1 | null = null;
        try {
          manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as AddonManifestV1;
        } catch {
          /* manifest body parse error surfaces in the card */
        }
        return {
          registryUrl: url,
          registry,
          addon,
          manifestUrl,
          sigUrl,
          manifest,
          signature,
          verifyResult,
        };
      } catch (err) {
        return {
          registryUrl: url,
          registry,
          addon,
          manifestUrl,
          sigUrl,
          manifest: null,
          signature: null,
          verifyResult: { ok: false, reason: "fetch-error" },
          fetchError: (err as Error).message,
        };
      }
    }),
  );
  return { registries: [{ url, registry }], addons: rows };
}

interface State {
  registries: RegistryEntry[];
  hostOrigin: string;
  rows: AddonRow[];
  registriesByUrl: Map<string, RegistryV1>;
  loadErrors: Map<string, string>;
  // For each user-configured URL that turned out to be a meta-index, a
  // summary the registry list can render.
  metaByUrl: Map<string, MetaSummary>;
  // Per-meta-index publisher list (post-normalisation). Used to render
  // endorsement chips next to each publisher row.
  metaPublishersByUrl: Map<string, readonly PublisherEntryV1[]>;
  // ADR-0020 §2 — submissions index per source URL. Each entry's
  // submissions are rendered in the dedicated Submissions section.
  submissionsByUrl: Map<string, readonly SubmissionV1[]>;
}

const state: State = {
  registries: readRegistries(),
  hostOrigin: readHostOrigin(),
  rows: [],
  registriesByUrl: new Map(),
  loadErrors: new Map(),
  metaByUrl: new Map(),
  metaPublishersByUrl: new Map(),
  submissionsByUrl: new Map(),
};

function $(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

function renderRegistryList(): void {
  const list = $("#registry-list") as HTMLUListElement | null;
  if (!list) return;
  list.replaceChildren();
  for (const entry of state.registries) {
    const li = document.createElement("li");
    li.dataset.testid = `registry-row-${encodeURIComponent(entry.url)}`;
    const left = document.createElement("div");
    const url = document.createElement("div");
    url.className = "mono";
    url.textContent = entry.url;
    const meta = document.createElement("div");
    meta.className = "muted mono";
    const reg = state.registriesByUrl.get(entry.url);
    const err = state.loadErrors.get(entry.url);
    const metaSummary = state.metaByUrl.get(entry.url);
    const submissions = state.submissionsByUrl.get(entry.url);
    if (submissions) {
      meta.dataset.testid = `registry-submissions-${encodeURIComponent(entry.url)}`;
      meta.textContent = `submissions index · ${submissions.length} submission${submissions.length === 1 ? "" : "s"}`;
    } else if (metaSummary) {
      // The user pointed at a meta-index. Annotate the row with the
      // discovered publisher count; per-publisher rows are not surfaced
      // separately to keep the list short.
      const expanded = state.rows
        .filter((r) => r.metaSourceUrl === entry.url)
        .reduce((acc, r) => acc.add(r.registryUrl), new Set<string>());
      meta.dataset.testid = `registry-meta-${encodeURIComponent(entry.url)}`;
      const featuredTail =
        metaSummary.featuredCount > 0 ? ` · ${metaSummary.featuredCount} featured` : "";
      const endorsedTail =
        metaSummary.endorsedCount > 0 ? ` · ${metaSummary.endorsedCount} endorsed` : "";
      meta.textContent = `meta-index · ${expanded.size} of ${metaSummary.publisherCount} publishers loaded${featuredTail}${endorsedTail}`;
    } else if (reg) {
      meta.textContent = `${reg.publisher.name} · ${reg.addons.length} addons · key ${fingerprintKey(reg.trustedKeys[0] ?? "")}`;
    } else if (err) {
      meta.textContent = `error: ${err}`;
    } else {
      meta.textContent = "loading…";
    }
    left.append(url, meta);
    if (metaSummary && metaSummary.errors.length > 0) {
      const errorList = document.createElement("ul");
      errorList.className = "muted mono meta-errors";
      errorList.dataset.testid = `registry-meta-errors-${encodeURIComponent(entry.url)}`;
      for (const e of metaSummary.errors) {
        const eli = document.createElement("li");
        const label = e.name ? `${e.name} (${e.url})` : e.url;
        eli.textContent = `failed: ${label} — ${e.message}`;
        errorList.append(eli);
      }
      left.append(errorList);
    }
    // ADR-0020 §3b — render endorsement chips per publisher entry, if any.
    const metaPublishers = state.metaPublishersByUrl.get(entry.url);
    if (metaPublishers?.some((p) => (p.endorsedBy?.length ?? 0) > 0)) {
      const endorseList = document.createElement("ul");
      endorseList.className = "muted meta-endorsements";
      endorseList.dataset.testid = `registry-meta-endorsements-${encodeURIComponent(entry.url)}`;
      for (const p of metaPublishers) {
        const labels = p.endorsedBy ?? [];
        if (labels.length === 0) continue;
        const eli = document.createElement("li");
        eli.dataset.testid = `registry-meta-endorsement-${encodeURIComponent(entry.url)}-${encodeURIComponent(p.url)}`;
        const who = document.createElement("span");
        who.className = "mono";
        who.textContent = `${p.name ?? p.url}: `;
        eli.append(who);
        for (const label of labels) {
          const chip = document.createElement("span");
          chip.className = "badge badge-endorsement";
          chip.textContent = label;
          eli.append(chip, document.createTextNode(" "));
        }
        if (p.endorsementUrl) {
          const link = document.createElement("a");
          link.href = p.endorsementUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "(report)";
          link.className = "mono";
          eli.append(link);
        }
        endorseList.append(eli);
      }
      left.append(endorseList);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "remove";
    remove.dataset.testid = `registry-remove-${encodeURIComponent(entry.url)}`;
    remove.addEventListener("click", () => {
      state.registries = state.registries.filter((r) => r.url !== entry.url);
      writeRegistries(state.registries);
      void refreshAll();
    });
    li.append(left, remove);
    list.appendChild(li);
  }
}

function unionCapabilities(): string[] {
  const set = new Set<string>();
  for (const row of state.rows) for (const c of row.addon.capabilities) set.add(c);
  return [...set].sort();
}

function unionCategories(): string[] {
  const set = new Set<string>();
  for (const row of state.rows) for (const c of row.addon.categories ?? []) set.add(c);
  return [...set].sort();
}

function renderFilters(): void {
  const cap = $("#filter-cap") as HTMLSelectElement | null;
  const cat = $("#filter-cat") as HTMLSelectElement | null;
  const reg = $("#filter-reg") as HTMLSelectElement | null;
  if (cap) {
    const current = cap.value;
    cap.replaceChildren(new Option("(any)", ""));
    for (const c of unionCapabilities()) cap.append(new Option(c, c));
    cap.value = current;
  }
  if (cat) {
    const current = cat.value;
    cat.replaceChildren(new Option("(any)", ""));
    for (const c of unionCategories()) cat.append(new Option(c, c));
    cat.value = current;
  }
  if (reg) {
    const current = reg.value;
    reg.replaceChildren(new Option("(any)", ""));
    for (const r of state.registries) reg.append(new Option(r.url, r.url));
    reg.value = current;
  }
}

function badgeFor(result: VerifyResult): HTMLSpanElement {
  const span = document.createElement("span");
  if (result.ok) {
    span.className = "badge badge-ok";
    span.textContent = "verified";
  } else if (result.reason === "untrusted-key") {
    span.className = "badge badge-warn";
    span.textContent = "untrusted key";
  } else {
    span.className = "badge badge-fail";
    span.textContent = `verify: ${result.reason ?? "failed"}`;
  }
  return span;
}

function handoffUrl(row: AddonRow): string | null {
  if (!state.hostOrigin) return null;
  try {
    const u = new URL("/", state.hostOrigin);
    u.searchParams.set("addon", row.manifestUrl);
    u.searchParams.set("publisher", row.registryUrl);
    return u.toString();
  } catch {
    return null;
  }
}

function renderCards(): void {
  const list = $("#addon-cards") as HTMLUListElement | null;
  const status = $("#results-status") as HTMLElement | null;
  if (!list || !status) return;
  list.replaceChildren();

  const q = (($("#filter-q") as HTMLInputElement | null)?.value ?? "").trim().toLowerCase();
  const capSel = (($("#filter-cap") as HTMLSelectElement | null)?.value ?? "").trim();
  const catSel = (($("#filter-cat") as HTMLSelectElement | null)?.value ?? "").trim();
  const regSel = (($("#filter-reg") as HTMLSelectElement | null)?.value ?? "").trim();

  const visible = state.rows.filter((row) => {
    if (regSel && row.registryUrl !== regSel) return false;
    if (capSel && !row.addon.capabilities.includes(capSel)) return false;
    if (catSel && !(row.addon.categories ?? []).includes(catSel)) return false;
    if (q) {
      const hay =
        `${row.addon.name}\n${row.addon.description}\n${(row.addon.tags ?? []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  status.textContent =
    state.rows.length === 0
      ? "no add-ons loaded yet."
      : `${visible.length} of ${state.rows.length} matching`;

  for (const row of visible) {
    const li = document.createElement("li");
    li.dataset.testid = `addon-card-${row.addon.id}`;

    const head = document.createElement("div");
    head.className = "head";
    const name = document.createElement("strong");
    name.textContent = `${row.addon.name} v${row.addon.version}`;
    const id = document.createElement("span");
    id.className = "id";
    id.textContent = row.addon.id;
    head.append(name, id, badgeFor(row.verifyResult));
    if (row.metaFeatured) {
      const featured = document.createElement("span");
      featured.className = "badge badge-featured";
      featured.dataset.testid = `addon-featured-${row.addon.id}`;
      featured.textContent = "featured";
      featured.title =
        `Featured by meta-index ${row.metaSourceName ?? row.metaSourceUrl ?? ""}`.trim();
      head.append(featured);
    }
    if (row.addon.deprecated) {
      const dep = document.createElement("span");
      dep.className = "badge badge-warn";
      dep.dataset.testid = `addon-deprecated-${row.addon.id}`;
      dep.textContent = "deprecated";
      dep.title = `${row.addon.deprecated.reason}${
        row.addon.deprecated.supersededBy ? ` → ${row.addon.deprecated.supersededBy}` : ""
      }`;
      head.append(dep);
    }
    if (row.addon.audit) {
      const audited = document.createElement("span");
      audited.className = "badge badge-audit";
      audited.dataset.testid = `addon-audit-${row.addon.id}`;
      audited.textContent = `audited v${row.addon.audit.auditedVersion}`;
      audited.title = `${row.addon.audit.auditor} · ${row.addon.audit.auditedAt} — ${row.addon.audit.findings.summary}`;
      head.append(audited);
    }
    li.append(head);

    const desc = document.createElement("p");
    desc.className = "muted";
    desc.textContent = row.addon.description;
    li.append(desc);

    if (row.addon.deprecated) {
      const depRow = document.createElement("p");
      depRow.className = "meta mono";
      depRow.dataset.testid = `addon-deprecated-row-${row.addon.id}`;
      const supersededBy = row.addon.deprecated.supersededBy
        ? ` → use ${row.addon.deprecated.supersededBy}`
        : "";
      depRow.textContent = `deprecated since ${row.addon.deprecated.since}: ${row.addon.deprecated.reason}${supersededBy}`;
      li.append(depRow);
    }

    if (row.addon.history && row.addon.history.length > 0) {
      const det = document.createElement("details");
      det.className = "meta mono";
      det.dataset.testid = `addon-history-${row.addon.id}`;
      const sum = document.createElement("summary");
      sum.textContent = `version history (${row.addon.history.length})`;
      det.append(sum);
      const ul = document.createElement("ul");
      ul.className = "history-list";
      for (const h of row.addon.history) {
        const hi = document.createElement("li");
        hi.dataset.testid = `addon-history-entry-${row.addon.id}-${h.version}`;
        const head = document.createElement("span");
        head.textContent = `v${h.version} · ${h.signedAt} · ${fingerprintKey(h.publicKey)}`;
        hi.append(head);
        if (h.yanked) {
          const yanked = document.createElement("span");
          yanked.className = "badge badge-fail";
          yanked.textContent = "yanked";
          yanked.title = `yanked ${h.yanked.at}: ${h.yanked.reason}`;
          hi.append(document.createTextNode(" "), yanked);
        }
        if (h.changelog) {
          const cl = document.createElement("p");
          cl.className = "muted";
          cl.textContent = h.changelog;
          hi.append(cl);
        }
        ul.append(hi);
      }
      det.append(ul);
      li.append(det);
    }

    const caps = document.createElement("p");
    caps.className = "meta mono";
    const capParts = [`capabilities: ${row.addon.capabilities.join(", ") || "(none)"}`];
    if (row.addon.categories && row.addon.categories.length > 0) {
      capParts.push(`categories: ${row.addon.categories.join(", ")}`);
    }
    if (row.addon.tags && row.addon.tags.length > 0) {
      capParts.push(`tags: ${row.addon.tags.join(", ")}`);
    }
    caps.textContent = capParts.join(" · ");
    li.append(caps);

    if (row.manifest?.permissions && row.manifest.permissions.length > 0) {
      const perms = document.createElement("p");
      perms.className = "meta mono";
      perms.textContent = `permissions: ${row.manifest.permissions.join(", ")}`;
      li.append(perms);
    }

    const trust = document.createElement("p");
    trust.className = "meta mono";
    const sig = row.signature;
    const metaTail = row.metaSourceUrl ? ` · via ${row.metaSourceName ?? "meta-index"}` : "";
    trust.textContent = sig
      ? `signed by ${fingerprintKey(sig.publicKey)} at ${sig.signedAt} · publisher ${row.registry.publisher.name}${metaTail}`
      : `publisher ${row.registry.publisher.name}${metaTail} · signature ${row.fetchError ? `error: ${row.fetchError}` : "missing"}`;
    if (row.metaSourceUrl) {
      trust.dataset.testid = `addon-meta-source-${row.addon.id}`;
    }
    li.append(trust);

    const actions = document.createElement("div");
    actions.className = "actions";
    const handoff = handoffUrl(row);
    if (handoff) {
      const open = document.createElement("a");
      open.href = handoff;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Open in SENN host";
      open.className = "badge badge-ok";
      open.style.textDecoration = "none";
      open.dataset.testid = `addon-open-${row.addon.id}`;
      actions.append(open);
    }
    const copyManifest = document.createElement("button");
    copyManifest.type = "button";
    copyManifest.className = "secondary";
    copyManifest.textContent = "copy manifest URL";
    copyManifest.dataset.testid = `addon-copy-${row.addon.id}`;
    copyManifest.addEventListener("click", () => {
      void navigator.clipboard.writeText(row.manifestUrl).catch(() => undefined);
    });
    actions.append(copyManifest);
    li.append(actions);

    list.append(li);
  }
}

function statusBadgeClass(status: SubmissionStatus): string {
  switch (status) {
    case "accepted":
      return "badge badge-ok";
    case "pending":
      return "badge badge-featured";
    case "needs-changes":
      return "badge badge-warn";
    case "rejected":
    case "withdrawn":
      return "badge badge-fail";
  }
}

function renderSubmissions(): void {
  const section = document.getElementById("submissions") as HTMLElement | null;
  const list = document.getElementById("submission-cards") as HTMLUListElement | null;
  if (!section || !list) return;
  list.replaceChildren();

  // Aggregate every submissions index the user has configured. Deduplicate
  // by (sourceUrl, submission.id) — submission ids are unique within a
  // single index per ADR-0020 §2.
  const all: Array<{ sourceUrl: string; submission: SubmissionV1 }> = [];
  for (const [sourceUrl, subs] of state.submissionsByUrl) {
    for (const s of subs) all.push({ sourceUrl, submission: s });
  }
  if (all.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  for (const { sourceUrl, submission } of all) {
    const li = document.createElement("li");
    li.dataset.testid = `submission-card-${submission.id}`;

    const head = document.createElement("div");
    head.className = "head";
    const name = document.createElement("strong");
    name.textContent = `${submission.addonId} v${submission.version}`;
    const id = document.createElement("span");
    id.className = "id";
    id.textContent = submission.id;
    const statusBadge = document.createElement("span");
    statusBadge.className = statusBadgeClass(submission.status);
    statusBadge.dataset.testid = `submission-status-${submission.id}`;
    statusBadge.textContent = submission.status;
    head.append(name, id, statusBadge);
    li.append(head);

    const meta = document.createElement("p");
    meta.className = "meta mono";
    meta.textContent = `submitted ${submission.submittedAt} · status updated ${submission.statusUpdatedAt} · key ${fingerprintKey(submission.publicKey)}`;
    li.append(meta);

    const contact = document.createElement("p");
    contact.className = "meta mono";
    contact.dataset.testid = `submission-contact-${submission.id}`;
    contact.textContent = `contact: ${submission.contact}`;
    li.append(contact);

    if (submission.statusReason) {
      const reason = document.createElement("p");
      reason.className = "meta mono";
      reason.dataset.testid = `submission-reason-${submission.id}`;
      reason.textContent = `reason: ${submission.statusReason}`;
      li.append(reason);
    }

    if (submission.notes) {
      const notes = document.createElement("p");
      notes.className = "muted";
      notes.dataset.testid = `submission-notes-${submission.id}`;
      notes.textContent = submission.notes;
      li.append(notes);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    const manifestLink = document.createElement("a");
    manifestLink.href = submission.manifestUrl;
    manifestLink.target = "_blank";
    manifestLink.rel = "noopener noreferrer";
    manifestLink.textContent = "manifest";
    manifestLink.className = "secondary";
    manifestLink.style.textDecoration = "none";
    manifestLink.dataset.testid = `submission-manifest-${submission.id}`;
    actions.append(manifestLink);
    const sigLink = document.createElement("a");
    sigLink.href = submission.signatureUrl;
    sigLink.target = "_blank";
    sigLink.rel = "noopener noreferrer";
    sigLink.textContent = "signature";
    sigLink.className = "secondary";
    sigLink.style.textDecoration = "none";
    sigLink.dataset.testid = `submission-signature-${submission.id}`;
    actions.append(sigLink);
    li.append(actions);

    const sourceFoot = document.createElement("p");
    sourceFoot.className = "meta mono";
    sourceFoot.textContent = `via ${sourceUrl}`;
    li.append(sourceFoot);

    list.append(li);
  }
}

interface RefreshOptions {
  readonly bypassCache?: boolean;
}

async function refreshAll(opts: RefreshOptions = {}): Promise<void> {
  // The browser HTTP cache is honoured by default. Refresh-with-bypass
  // forces revalidation for every fetch in this run; once the run
  // completes we revert to the default so subsequent loads still hit
  // the cache where the server permits it.
  const previousCache = currentCacheMode;
  currentCacheMode = opts.bypassCache ? "reload" : "default";
  try {
    const status = $("#config-status") as HTMLElement | null;
    if (status)
      status.textContent = `loading ${state.registries.length} registr${state.registries.length === 1 ? "y" : "ies"}…`;
    state.rows = [];
    state.registriesByUrl = new Map();
    state.loadErrors = new Map();
    state.metaByUrl = new Map();
    state.metaPublishersByUrl = new Map();
    state.submissionsByUrl = new Map();
    renderRegistryList();
    renderCards();
    renderSubmissions();

    for (const entry of state.registries) {
      try {
        const { registries, addons, meta, metaPublishers, submissions } = await loadFromUrl(
          entry.url,
        );
        for (const r of registries) state.registriesByUrl.set(r.url, r.registry);
        state.rows.push(...addons);
        if (meta) state.metaByUrl.set(entry.url, meta);
        if (metaPublishers) state.metaPublishersByUrl.set(entry.url, metaPublishers);
        if (submissions) state.submissionsByUrl.set(entry.url, submissions.submissions);
      } catch (err) {
        state.loadErrors.set(entry.url, (err as Error).message);
      }
    }

    if (status) {
      const errCount = state.loadErrors.size;
      const partialMetaErrors = [...state.metaByUrl.values()].reduce(
        (n, m) => n + m.errors.length,
        0,
      );
      const tail = partialMetaErrors > 0 ? ` (${partialMetaErrors} meta publishers failed)` : "";
      status.textContent =
        errCount > 0
          ? `${state.registries.length - errCount} of ${state.registries.length} registries loaded; ${errCount} failed${tail}`
          : `${state.registries.length} registries loaded · ${state.rows.length} add-ons${tail}`;
    }
    renderRegistryList();
    renderFilters();
    renderCards();
    renderSubmissions();
  } finally {
    currentCacheMode = previousCache;
  }
}

function bindUi(): void {
  const hostInput = $("#host-origin") as HTMLInputElement | null;
  if (hostInput) {
    hostInput.value = state.hostOrigin;
    hostInput.placeholder = state.hostOrigin || "http://127.0.0.1:5173";
    hostInput.addEventListener("change", () => {
      state.hostOrigin = hostInput.value.trim();
      writeHostOrigin(state.hostOrigin);
      renderCards();
    });
  }

  const addInput = $("#registry-add") as HTMLInputElement | null;
  const addBtn = $("#btn-registry-add") as HTMLButtonElement | null;
  if (addBtn && addInput) {
    addBtn.addEventListener("click", () => {
      const url = addInput.value.trim();
      if (!url) return;
      if (state.registries.some((r) => r.url === url)) {
        addInput.value = "";
        return;
      }
      state.registries.push({ url });
      writeRegistries(state.registries);
      addInput.value = "";
      void refreshAll();
    });
  }

  const refreshBtn = $("#btn-registry-refresh") as HTMLButtonElement | null;
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      void refreshAll({ bypassCache: true });
    });
  }

  for (const sel of ["#filter-q", "#filter-cap", "#filter-cat", "#filter-reg"]) {
    const el = $(sel);
    if (!el) continue;
    el.addEventListener("input", () => renderCards());
    el.addEventListener("change", () => renderCards());
  }
}

bindUi();
void refreshAll();
