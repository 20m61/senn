import { describe, expect, it } from "vitest";

import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  ManifestSignatureError,
  base64urlDecode,
  base64urlEncode,
  generateKeyPair,
  signManifest,
  validateSignaturePayload,
  verifyManifest,
} from "../src/index.ts";

const SAMPLE_MANIFEST = new TextEncoder().encode(
  '{"id":"dev.senn.echo","name":"Echo","version":"0.1.0","entry":"index.html","license":"Apache-2.0","network":false,"permissions":["peer.send"],"capabilities":["echo-v1"]}',
);

describe("@senn/manifest — sign/verify round-trip", () => {
  it("signs a manifest and verifies it with the matching public key", async () => {
    const kp = await generateKeyPair();
    expect(kp.publicKeyBase64.length).toBeGreaterThan(0);
    const sig = await signManifest({ manifestBytes: SAMPLE_MANIFEST, keyPair: kp });
    expect(sig.alg).toBe("Ed25519");
    expect(base64urlDecode(sig.publicKey).byteLength).toBe(ED25519_PUBLIC_KEY_BYTES);
    expect(base64urlDecode(sig.signature).byteLength).toBe(ED25519_SIGNATURE_BYTES);

    const result = await verifyManifest({
      manifestBytes: SAMPLE_MANIFEST,
      signature: sig,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when the manifest bytes are tampered", async () => {
    const kp = await generateKeyPair();
    const sig = await signManifest({ manifestBytes: SAMPLE_MANIFEST, keyPair: kp });
    const tampered = new Uint8Array(SAMPLE_MANIFEST);
    tampered[10] = (tampered[10] ?? 0) ^ 0x20;
    const result = await verifyManifest({ manifestBytes: tampered, signature: sig });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-signature");
  });

  it("rejects when the public key is not in trustedKeys", async () => {
    const signer = await generateKeyPair();
    const other = await generateKeyPair();
    const sig = await signManifest({ manifestBytes: SAMPLE_MANIFEST, keyPair: signer });
    const result = await verifyManifest({
      manifestBytes: SAMPLE_MANIFEST,
      signature: sig,
      trustedKeys: new Set([other.publicKeyBase64]),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("untrusted-key");
  });

  it("accepts when publicKey is in trustedKeys", async () => {
    const kp = await generateKeyPair();
    const sig = await signManifest({ manifestBytes: SAMPLE_MANIFEST, keyPair: kp });
    const result = await verifyManifest({
      manifestBytes: SAMPLE_MANIFEST,
      signature: sig,
      trustedKeys: new Set([kp.publicKeyBase64]),
    });
    expect(result.ok).toBe(true);
  });

  it("validateSignaturePayload rejects unknown alg", () => {
    expect(() =>
      validateSignaturePayload({
        v: 1,
        alg: "RS256",
        publicKey: base64urlEncode(new Uint8Array(32)),
        signature: base64urlEncode(new Uint8Array(64)),
        signedAt: new Date().toISOString(),
      }),
    ).toThrow(ManifestSignatureError);
  });

  it("validateSignaturePayload rejects extra fields", () => {
    expect(() =>
      validateSignaturePayload({
        v: 1,
        alg: "Ed25519",
        publicKey: base64urlEncode(new Uint8Array(32)),
        signature: base64urlEncode(new Uint8Array(64)),
        signedAt: new Date().toISOString(),
        extra: "no",
      }),
    ).toThrow(/unknown field/);
  });

  it("validateSignaturePayload rejects wrong key length", () => {
    expect(() =>
      validateSignaturePayload({
        v: 1,
        alg: "Ed25519",
        publicKey: base64urlEncode(new Uint8Array(31)),
        signature: base64urlEncode(new Uint8Array(64)),
        signedAt: new Date().toISOString(),
      }),
    ).toThrow(/32 bytes/);
  });

  it("validateSignaturePayload rejects wrong signature length", () => {
    expect(() =>
      validateSignaturePayload({
        v: 1,
        alg: "Ed25519",
        publicKey: base64urlEncode(new Uint8Array(32)),
        signature: base64urlEncode(new Uint8Array(63)),
        signedAt: new Date().toISOString(),
      }),
    ).toThrow(/64 bytes/);
  });

  it("validateSignaturePayload rejects bad ISO date", () => {
    expect(() =>
      validateSignaturePayload({
        v: 1,
        alg: "Ed25519",
        publicKey: base64urlEncode(new Uint8Array(32)),
        signature: base64urlEncode(new Uint8Array(64)),
        signedAt: "not a date",
      }),
    ).toThrow(/ISO-8601/);
  });

  it("base64url encode/decode is byte-stable across edge lengths", () => {
    for (const n of [0, 1, 2, 3, 31, 32, 64, 65]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 17) & 0xff;
      const round = base64urlDecode(base64urlEncode(bytes));
      expect(round.byteLength).toBe(n);
      expect(Array.from(round)).toEqual(Array.from(bytes));
    }
  });
});
