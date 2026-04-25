/**
 * @senn/storage — local-first add-on storage.
 *
 * Spec: docs/addon-storage-spec.md.
 *
 * Provides per-add-on key/value namespaces backed by IndexedDB in the
 * browser. Tests inject an InMemoryStorageBackend.
 */

export const SENN_STORAGE_VERSION = "0.0.0";

export const STORAGE_DB_NAME = "senn-addon-storage";
export const STORAGE_OBJECT_STORE = "values";
export const STORAGE_VERSION = 1;

export const MAX_KEY_LENGTH = 256;
export const MAX_VALUE_BYTES = 1 * 1024 * 1024; // 1 MiB

export type StorageErrorCode =
  | "permission-denied"
  | "key-too-long"
  | "value-too-large"
  | "quota-exceeded"
  | "value-not-cloneable"
  | "closed"
  | "invalid-request";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message?: string) {
    super(message ?? code);
    this.name = "StorageError";
    this.code = code;
  }
}

export interface StorageRecord {
  readonly value: unknown;
  readonly updatedAt: number;
}

export interface StorageBackend {
  get(addonId: string, key: string): Promise<StorageRecord | null>;
  put(addonId: string, key: string, record: StorageRecord): Promise<void>;
  delete(addonId: string, key: string): Promise<void>;
  list(addonId: string): Promise<string[]>;
  clear(addonId: string): Promise<void>;
  close(): Promise<void>;
}

function namespaceKey(addonId: string, key: string): string {
  return `${addonId} ${key}`;
}

function validateKey(key: unknown): asserts key is string {
  if (typeof key !== "string") throw new StorageError("invalid-request", "key must be a string");
  if (key.length > MAX_KEY_LENGTH) throw new StorageError("key-too-long");
}

function approximateBytes(value: unknown): number {
  // Approximate JSON-encoded byte size. We only need a stable upper bound.
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch (err) {
    throw new StorageError("value-not-cloneable", (err as Error).message);
  }
}

export interface AddonStorage {
  readonly addonId: string;
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}

class AddonStorageImpl implements AddonStorage {
  constructor(
    readonly addonId: string,
    private readonly backend: StorageBackend,
  ) {}

  async get(key: string): Promise<unknown> {
    validateKey(key);
    const rec = await this.backend.get(this.addonId, key);
    return rec?.value ?? null;
  }

  async put(key: string, value: unknown): Promise<void> {
    validateKey(key);
    const bytes = approximateBytes(value);
    if (bytes > MAX_VALUE_BYTES) throw new StorageError("value-too-large");
    await this.backend.put(this.addonId, key, { value, updatedAt: Date.now() });
  }

  async delete(key: string): Promise<void> {
    validateKey(key);
    await this.backend.delete(this.addonId, key);
  }

  async list(): Promise<string[]> {
    return this.backend.list(this.addonId);
  }

  async clear(): Promise<void> {
    await this.backend.clear(this.addonId);
  }
}

export function createAddonStorage(addonId: string, backend: StorageBackend): AddonStorage {
  return new AddonStorageImpl(addonId, backend);
}

// ─── In-memory backend (used by tests; usable in Node, ServiceWorker, etc.) ───

export class InMemoryStorageBackend implements StorageBackend {
  private readonly map = new Map<string, StorageRecord>();
  private closed = false;

  async get(addonId: string, key: string): Promise<StorageRecord | null> {
    if (this.closed) throw new StorageError("closed");
    return this.map.get(namespaceKey(addonId, key)) ?? null;
  }

  async put(addonId: string, key: string, record: StorageRecord): Promise<void> {
    if (this.closed) throw new StorageError("closed");
    this.map.set(namespaceKey(addonId, key), record);
  }

  async delete(addonId: string, key: string): Promise<void> {
    if (this.closed) throw new StorageError("closed");
    this.map.delete(namespaceKey(addonId, key));
  }

  async list(addonId: string): Promise<string[]> {
    if (this.closed) throw new StorageError("closed");
    const prefix = `${addonId} `;
    const out: string[] = [];
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    out.sort();
    return out;
  }

  async clear(addonId: string): Promise<void> {
    if (this.closed) throw new StorageError("closed");
    const prefix = `${addonId} `;
    for (const k of [...this.map.keys()]) {
      if (k.startsWith(prefix)) this.map.delete(k);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.map.clear();
  }
}

// ─── IndexedDB backend (browser) ──────────────────────────────────────────────

export class IndexedDbStorageBackend implements StorageBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private closed = false;

  constructor(
    private readonly dbName: string = STORAGE_DB_NAME,
    private readonly storeName: string = STORAGE_OBJECT_STORE,
  ) {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const indexedDB = (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
      if (!indexedDB) {
        reject(new StorageError("invalid-request", "IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(this.dbName, STORAGE_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new StorageError("invalid-request"));
      req.onblocked = () => reject(new StorageError("invalid-request", "open blocked"));
    });
    return this.dbPromise;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    if (this.closed) throw new StorageError("closed");
    const db = await this.openDb();
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async get(addonId: string, key: string): Promise<StorageRecord | null> {
    const store = await this.tx("readonly");
    return await new Promise((resolve, reject) => {
      const r = store.get(namespaceKey(addonId, key));
      r.onsuccess = () => resolve((r.result as StorageRecord | undefined) ?? null);
      r.onerror = () => reject(r.error);
    });
  }

  async put(addonId: string, key: string, record: StorageRecord): Promise<void> {
    const store = await this.tx("readwrite");
    await new Promise<void>((resolve, reject) => {
      const r = store.put(record, namespaceKey(addonId, key));
      r.onsuccess = () => resolve();
      r.onerror = () => {
        // Quota exceeded surfaces here as a DOMException with name QuotaExceededError.
        const err = r.error;
        if (err && err.name === "QuotaExceededError") {
          reject(new StorageError("quota-exceeded"));
        } else {
          reject(err);
        }
      };
    });
  }

  async delete(addonId: string, key: string): Promise<void> {
    const store = await this.tx("readwrite");
    await new Promise<void>((resolve, reject) => {
      const r = store.delete(namespaceKey(addonId, key));
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async list(addonId: string): Promise<string[]> {
    const store = await this.tx("readonly");
    const prefix = `${addonId} `;
    return await new Promise((resolve, reject) => {
      const out: string[] = [];
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      const cursor = store.openCursor(range);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) {
          out.sort();
          resolve(out);
          return;
        }
        const k = c.key as string;
        out.push(k.slice(prefix.length));
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  async clear(addonId: string): Promise<void> {
    const store = await this.tx("readwrite");
    const prefix = `${addonId} `;
    await new Promise<void>((resolve, reject) => {
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      const cursor = store.openCursor(range);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) {
          resolve();
          return;
        }
        c.delete();
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.dbPromise) {
      const db = await this.dbPromise.catch(() => null);
      db?.close();
      this.dbPromise = null;
    }
  }
}

export interface StorageNamespace {
  readonly addonId: string;
}
