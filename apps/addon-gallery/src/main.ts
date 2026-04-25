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

// Accepts ADR-0017 v1 + v2 inputs.
interface AddonDeprecation {
  readonly since: string;
  readonly reason: string;
  readonly supersededBy?: string;
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
}

interface RegistryV1 {
  readonly v: 1 | 2;
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
}

// ADR-0017 §3 — PublisherMetaIndexV1.
interface PublisherEntryV1 {
  readonly url: string;
  readonly name?: string;
  readonly featured?: boolean;
}

interface PublisherMetaIndexV1 {
  readonly v: 1;
  readonly kind: "senn-publisher-meta";
  readonly publishers: readonly PublisherEntryV1[];
}

interface MetaSummary {
  readonly url: string;
  readonly publisherCount: number;
}

const LS_REGISTRIES = "senn.gallery.registries";
const LS_HOST_ORIGIN = "senn.gallery.host-origin";

function defaultRegistryUrl(): string {
  // In dev the SENN web app commonly runs at 127.0.0.1:5173. In production
  // the gallery may be served from a different origin than the host, so
  // fall back to a well-known absolute URL the user can edit.
  if (typeof location !== "undefined" && location.origin) {
    // If the gallery is served from the same origin as the host, the
    // registry mirror is at /registry/official/index.json (matches
    // apps/web/public/registry/official/index.json).
    return `${location.origin.replace(/\/+$/, "")}/registry/official/index.json`;
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
  // We use the basename and resolve against the registry origin's /addons/.
  // This matches the served convention used by apps/web (public folder).
  const u = new URL(registryUrl);
  const base = basenameOfPath(addonPath);
  return new URL(`/addons/${base}/manifest.json`, u.origin).toString();
}

function sigUrlFor(manifestUrl: string): string {
  return new URL("manifest.sig.json", manifestUrl).toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
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
    publishers.push({
      url: p.url,
      ...(typeof p.name === "string" && p.name.length > 0 && p.name.length <= 80
        ? { name: p.name }
        : {}),
      ...(typeof p.featured === "boolean" ? { featured: p.featured } : {}),
    });
  }
  // Featured publishers come first; original order preserved within groups.
  publishers.sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false));
  return { v: 1, kind: "senn-publisher-meta", publishers };
}

function isRegistry(value: unknown): value is RegistryV1 {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) return false;
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
}

async function loadFromUrl(url: string): Promise<LoadResult> {
  // Fetch once; decide whether it is a meta-index or a publisher index.
  const value = await fetchJson<unknown>(url);
  if (isMetaIndex(value)) {
    const meta = normalizeMetaIndex(value);
    type Resolved =
      | { ok: true; url: string; registry: RegistryV1; addons: AddonRow[] }
      | { ok: false; url: string; error: string };
    const results: Resolved[] = await Promise.all(
      meta.publishers.map(async (entry): Promise<Resolved> => {
        try {
          const { registry, addons } = await loadPublisherIndex(entry.url, {
            metaSourceUrl: url,
            ...(entry.name ? { metaSourceName: entry.name } : {}),
          });
          return { ok: true, url: entry.url, registry, addons };
        } catch (err) {
          return { ok: false, url: entry.url, error: (err as Error).message };
        }
      }),
    );
    const registries: Array<{ url: string; registry: RegistryV1 }> = [];
    const addons: AddonRow[] = [];
    const errors: string[] = [];
    for (const r of results) {
      if (r.ok) {
        registries.push({ url: r.url, registry: r.registry });
        addons.push(...r.addons);
      } else {
        errors.push(`${r.url}: ${r.error}`);
      }
    }
    if (registries.length === 0) {
      throw new Error(
        `meta-index at ${url} resolved no publishers (${errors.join("; ") || "no entries"})`,
      );
    }
    return { registries, addons, meta: { url, publisherCount: meta.publishers.length } };
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
}

const state: State = {
  registries: readRegistries(),
  hostOrigin: readHostOrigin(),
  rows: [],
  registriesByUrl: new Map(),
  loadErrors: new Map(),
  metaByUrl: new Map(),
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
    if (metaSummary) {
      // The user pointed at a meta-index. Annotate the row with the
      // discovered publisher count; per-publisher rows are not surfaced
      // separately to keep the list short.
      const expanded = state.rows
        .filter((r) => r.metaSourceUrl === entry.url)
        .reduce((acc, r) => acc.add(r.registryUrl), new Set<string>());
      meta.dataset.testid = `registry-meta-${encodeURIComponent(entry.url)}`;
      meta.textContent = `meta-index · ${expanded.size} of ${metaSummary.publisherCount} publishers loaded`;
    } else if (reg) {
      meta.textContent = `${reg.publisher.name} · ${reg.addons.length} addons · key ${fingerprintKey(reg.trustedKeys[0] ?? "")}`;
    } else if (err) {
      meta.textContent = `error: ${err}`;
    } else {
      meta.textContent = "loading…";
    }
    left.append(url, meta);
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

async function refreshAll(): Promise<void> {
  const status = $("#config-status") as HTMLElement | null;
  if (status)
    status.textContent = `loading ${state.registries.length} registr${state.registries.length === 1 ? "y" : "ies"}…`;
  state.rows = [];
  state.registriesByUrl = new Map();
  state.loadErrors = new Map();
  state.metaByUrl = new Map();
  renderRegistryList();
  renderCards();

  for (const entry of state.registries) {
    try {
      const { registries, addons, meta } = await loadFromUrl(entry.url);
      for (const r of registries) state.registriesByUrl.set(r.url, r.registry);
      state.rows.push(...addons);
      if (meta) state.metaByUrl.set(entry.url, meta);
    } catch (err) {
      state.loadErrors.set(entry.url, (err as Error).message);
    }
  }

  if (status) {
    const errCount = state.loadErrors.size;
    status.textContent =
      errCount > 0
        ? `${state.registries.length - errCount} of ${state.registries.length} registries loaded; ${errCount} failed`
        : `${state.registries.length} registries loaded · ${state.rows.length} add-ons`;
  }
  renderRegistryList();
  renderFilters();
  renderCards();
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

  for (const sel of ["#filter-q", "#filter-cap", "#filter-cat", "#filter-reg"]) {
    const el = $(sel);
    if (!el) continue;
    el.addEventListener("input", () => renderCards());
    el.addEventListener("change", () => renderCards());
  }
}

bindUi();
void refreshAll();
