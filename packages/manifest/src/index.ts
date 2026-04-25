/**
 * @senn/manifest — Ed25519 detached signing and verification for SENN
 * add-on manifests.
 *
 * Spec: docs/addon-signing-spec.md.
 *
 * Uses Web Crypto only — no third-party crypto dependency.
 */

export const SENN_MANIFEST_SIGNING_VERSION = 1 as const;
export const SIGNATURE_ALG = "Ed25519" as const;
export const ED25519_PUBLIC_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

export interface ManifestSignatureV1 {
  readonly v: typeof SENN_MANIFEST_SIGNING_VERSION;
  readonly alg: typeof SIGNATURE_ALG;
  readonly publicKey: string;
  readonly signature: string;
  readonly signedAt: string;
}

export class ManifestSignatureError extends Error {
  constructor(message: string) {
    super(`senn: manifest signature — ${message}`);
    this.name = "ManifestSignatureError";
  }
}

const ALLOWED_KEYS: readonly string[] = ["v", "alg", "publicKey", "signature", "signedAt"];

function getCrypto(): Crypto {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new ManifestSignatureError("Web Crypto subtle is not available");
  }
  return c;
}

// ── base64url ────────────────────────────────────────────────────────────────

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    out += B64_ALPHABET[((b & 0x0f) << 2) | (c >> 6)];
    out += B64_ALPHABET[c & 0x3f];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const a = bytes[i] ?? 0;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[(a & 0x03) << 4];
  } else if (rem === 2) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    out += B64_ALPHABET[(b & 0x0f) << 2];
  }
  return out;
}

export function base64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) {
    throw new ManifestSignatureError("not base64url");
  }
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) lookup[B64_ALPHABET.charCodeAt(i)] = i;
  const len = s.length;
  const fullGroups = Math.floor(len / 4);
  const tail = len - fullGroups * 4;
  if (tail === 1) throw new ManifestSignatureError("invalid base64url length");
  const outLen = fullGroups * 3 + (tail === 0 ? 0 : tail - 1);
  const out = new Uint8Array(outLen);
  let oi = 0;
  let ii = 0;
  for (let g = 0; g < fullGroups; g++) {
    const a = lookup[s.charCodeAt(ii++)] ?? -1;
    const b = lookup[s.charCodeAt(ii++)] ?? -1;
    const c = lookup[s.charCodeAt(ii++)] ?? -1;
    const d = lookup[s.charCodeAt(ii++)] ?? -1;
    if ((a | b | c | d) < 0) throw new ManifestSignatureError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
    out[oi++] = ((b & 0x0f) << 4) | (c >> 2);
    out[oi++] = ((c & 0x03) << 6) | d;
  }
  if (tail === 2) {
    const a = lookup[s.charCodeAt(ii++)] ?? -1;
    const b = lookup[s.charCodeAt(ii++)] ?? -1;
    if ((a | b) < 0) throw new ManifestSignatureError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
  } else if (tail === 3) {
    const a = lookup[s.charCodeAt(ii++)] ?? -1;
    const b = lookup[s.charCodeAt(ii++)] ?? -1;
    const c = lookup[s.charCodeAt(ii++)] ?? -1;
    if ((a | b | c) < 0) throw new ManifestSignatureError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
    out[oi++] = ((b & 0x0f) << 4) | (c >> 2);
  }
  return out;
}

// ── key handling ─────────────────────────────────────────────────────────────

export interface SennKeyPair {
  readonly publicKey: CryptoKey;
  readonly privateKey: CryptoKey;
  readonly publicKeyBase64: string;
}

export async function generateKeyPair(): Promise<SennKeyPair> {
  const crypto = getCrypto();
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  if (raw.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
    throw new ManifestSignatureError("unexpected public key length");
  }
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicKeyBase64: base64urlEncode(raw),
  };
}

export async function importPublicKey(base64url: string): Promise<CryptoKey> {
  const raw = base64urlDecode(base64url);
  if (raw.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
    throw new ManifestSignatureError(
      `public key must be ${ED25519_PUBLIC_KEY_BYTES} bytes (got ${raw.byteLength})`,
    );
  }
  return getCrypto().subtle.importKey("raw", raw as BufferSource, { name: "Ed25519" }, true, [
    "verify",
  ]);
}

// ── sign / verify ────────────────────────────────────────────────────────────

export interface SignManifestInput {
  readonly manifestBytes: Uint8Array;
  readonly keyPair: SennKeyPair;
  readonly signedAt?: Date;
}

export async function signManifest(input: SignManifestInput): Promise<ManifestSignatureV1> {
  const crypto = getCrypto();
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      input.keyPair.privateKey,
      input.manifestBytes as BufferSource,
    ),
  );
  if (sig.byteLength !== ED25519_SIGNATURE_BYTES) {
    throw new ManifestSignatureError(
      `signature must be ${ED25519_SIGNATURE_BYTES} bytes (got ${sig.byteLength})`,
    );
  }
  return {
    v: SENN_MANIFEST_SIGNING_VERSION,
    alg: SIGNATURE_ALG,
    publicKey: input.keyPair.publicKeyBase64,
    signature: base64urlEncode(sig),
    signedAt: (input.signedAt ?? new Date()).toISOString(),
  };
}

export interface VerifyManifestInput {
  readonly manifestBytes: Uint8Array;
  readonly signature: ManifestSignatureV1;
  readonly trustedKeys?: ReadonlySet<string>;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestSignatureError("signature is not an object");
  }
  return value as Record<string, unknown>;
}

export function validateSignaturePayload(value: unknown): ManifestSignatureV1 {
  const obj = asObject(value);
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_KEYS.includes(k)) {
      throw new ManifestSignatureError(`unknown field: ${k}`);
    }
  }
  if (obj.v !== SENN_MANIFEST_SIGNING_VERSION) {
    throw new ManifestSignatureError(`v must be ${SENN_MANIFEST_SIGNING_VERSION}`);
  }
  if (obj.alg !== SIGNATURE_ALG) {
    throw new ManifestSignatureError(`alg must be ${SIGNATURE_ALG}`);
  }
  if (typeof obj.publicKey !== "string") {
    throw new ManifestSignatureError("publicKey must be a string");
  }
  const pk = base64urlDecode(obj.publicKey);
  if (pk.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
    throw new ManifestSignatureError("publicKey must decode to 32 bytes");
  }
  if (typeof obj.signature !== "string") {
    throw new ManifestSignatureError("signature must be a string");
  }
  const sig = base64urlDecode(obj.signature);
  if (sig.byteLength !== ED25519_SIGNATURE_BYTES) {
    throw new ManifestSignatureError("signature must decode to 64 bytes");
  }
  if (typeof obj.signedAt !== "string" || Number.isNaN(Date.parse(obj.signedAt))) {
    throw new ManifestSignatureError("signedAt must be ISO-8601");
  }
  return {
    v: SENN_MANIFEST_SIGNING_VERSION,
    alg: SIGNATURE_ALG,
    publicKey: obj.publicKey,
    signature: obj.signature,
    signedAt: obj.signedAt,
  };
}

export async function verifyManifest(input: VerifyManifestInput): Promise<VerifyResult> {
  const sig = input.signature;
  if (input.trustedKeys && !input.trustedKeys.has(sig.publicKey)) {
    return { ok: false, reason: "untrusted-key" };
  }
  const publicKey = await importPublicKey(sig.publicKey);
  const sigBytes = base64urlDecode(sig.signature);
  const ok = await getCrypto().subtle.verify(
    { name: "Ed25519" },
    publicKey,
    sigBytes as BufferSource,
    input.manifestBytes as BufferSource,
  );
  return ok ? { ok: true } : { ok: false, reason: "bad-signature" };
}
