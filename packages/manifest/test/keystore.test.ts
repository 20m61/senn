import { describe, expect, it } from "vitest";

import {
  KEYSTORE_VERSION,
  KeystoreError,
  exportKeystore,
  generateKeyPair,
  loadKeystore,
  signManifest,
  verifyManifest,
} from "../src/index.ts";

const SAMPLE = new TextEncoder().encode('{"id":"dev.senn.x"}');

describe("@senn/manifest — keystore round-trip", () => {
  it("exports + reloads a keypair and signs the same bytes the same way", async () => {
    const original = await generateKeyPair();
    const ks = await exportKeystore(original);
    expect(ks.v).toBe(KEYSTORE_VERSION);
    expect(ks.alg).toBe("Ed25519");
    expect(ks.publicKey).toBe(original.publicKeyBase64);
    expect(ks.privateKey.length).toBeGreaterThan(0);

    const reloaded = await loadKeystore(ks);
    expect(reloaded.publicKeyBase64).toBe(original.publicKeyBase64);

    const sig = await signManifest({ manifestBytes: SAMPLE, keyPair: reloaded });
    const result = await verifyManifest({ manifestBytes: SAMPLE, signature: sig });
    expect(result.ok).toBe(true);
  });

  it("rejects keystore with wrong version", async () => {
    const kp = await generateKeyPair();
    const ks = await exportKeystore(kp);
    await expect(loadKeystore({ ...ks, v: 2 })).rejects.toBeInstanceOf(KeystoreError);
  });

  it("rejects keystore with wrong alg", async () => {
    const kp = await generateKeyPair();
    const ks = await exportKeystore(kp);
    await expect(loadKeystore({ ...ks, alg: "RS256" })).rejects.toBeInstanceOf(KeystoreError);
  });

  it("rejects keystore with non-string fields", async () => {
    const kp = await generateKeyPair();
    const ks = await exportKeystore(kp);
    await expect(loadKeystore({ ...ks, publicKey: 12 })).rejects.toBeInstanceOf(KeystoreError);
    await expect(loadKeystore({ ...ks, privateKey: null })).rejects.toBeInstanceOf(KeystoreError);
  });

  it("rejects keystore where publicKey is not 32 bytes", async () => {
    const kp = await generateKeyPair();
    const ks = await exportKeystore(kp);
    await expect(loadKeystore({ ...ks, publicKey: "AAAA" })).rejects.toBeInstanceOf(KeystoreError);
  });

  it("rejects non-object input", async () => {
    await expect(loadKeystore(null)).rejects.toBeInstanceOf(KeystoreError);
    await expect(loadKeystore("string")).rejects.toBeInstanceOf(KeystoreError);
    await expect(loadKeystore([1, 2, 3])).rejects.toBeInstanceOf(KeystoreError);
  });
});
