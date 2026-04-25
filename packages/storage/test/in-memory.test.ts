import { describe, expect, it } from "vitest";

import {
  InMemoryStorageBackend,
  MAX_KEY_LENGTH,
  MAX_VALUE_BYTES,
  StorageError,
  createAddonStorage,
} from "../src/index.ts";

const BIG_STRING_PER_BYTE = "a";

describe("AddonStorage over InMemoryStorageBackend", () => {
  function fresh(addonId = "dev.senn.echo") {
    const backend = new InMemoryStorageBackend();
    const store = createAddonStorage(addonId, backend);
    return { backend, store };
  }

  it("put + get returns the stored value", async () => {
    const { store } = fresh();
    await store.put("draft", { title: "untitled", body: "" });
    expect(await store.get("draft")).toEqual({ title: "untitled", body: "" });
  });

  it("get returns null for missing keys", async () => {
    const { store } = fresh();
    expect(await store.get("missing")).toBeNull();
  });

  it("delete removes a key", async () => {
    const { store } = fresh();
    await store.put("draft", "x");
    await store.delete("draft");
    expect(await store.get("draft")).toBeNull();
  });

  it("list enumerates only this add-on's keys", async () => {
    const backend = new InMemoryStorageBackend();
    const a = createAddonStorage("dev.senn.a", backend);
    const b = createAddonStorage("dev.senn.b", backend);
    await a.put("k1", 1);
    await a.put("k2", 2);
    await b.put("k1", 99);
    expect(await a.list()).toEqual(["k1", "k2"]);
    expect(await b.list()).toEqual(["k1"]);
  });

  it("clear empties only this add-on's namespace", async () => {
    const backend = new InMemoryStorageBackend();
    const a = createAddonStorage("dev.senn.a", backend);
    const b = createAddonStorage("dev.senn.b", backend);
    await a.put("k", 1);
    await b.put("k", 2);
    await a.clear();
    expect(await a.list()).toEqual([]);
    expect(await b.get("k")).toBe(2);
  });

  it("rejects key longer than MAX_KEY_LENGTH", async () => {
    const { store } = fresh();
    const tooLong = "x".repeat(MAX_KEY_LENGTH + 1);
    await expect(store.put(tooLong, 1)).rejects.toBeInstanceOf(StorageError);
    await expect(store.get(tooLong)).rejects.toBeInstanceOf(StorageError);
  });

  it("rejects value larger than MAX_VALUE_BYTES", async () => {
    const { store } = fresh();
    const big = BIG_STRING_PER_BYTE.repeat(MAX_VALUE_BYTES + 1);
    await expect(store.put("k", big)).rejects.toMatchObject({
      code: "value-too-large",
    });
  });

  it("rejects unserialisable values", async () => {
    const { store } = fresh();
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    await expect(store.put("k", cyclic)).rejects.toMatchObject({
      code: "value-not-cloneable",
    });
  });

  it("namespaces by addon id even when a key is the same", async () => {
    const backend = new InMemoryStorageBackend();
    const a = createAddonStorage("dev.senn.a", backend);
    const b = createAddonStorage("dev.senn.b", backend);
    await a.put("config", { theme: "dark" });
    await b.put("config", { theme: "light" });
    expect(await a.get("config")).toEqual({ theme: "dark" });
    expect(await b.get("config")).toEqual({ theme: "light" });
  });

  it("close() rejects further use", async () => {
    const backend = new InMemoryStorageBackend();
    const store = createAddonStorage("dev.senn.x", backend);
    await store.put("k", 1);
    await backend.close();
    await expect(store.get("k")).rejects.toMatchObject({ code: "closed" });
  });
});
