/**
 * @senn/signaling-nostr — v2 content cipher
 *
 * Implements the OPTIONAL v2 wire variant defined by:
 *   - docs/adr/0024-encrypted-nostr-signaling-nip44.md
 *   - docs/adr/0027-nip44-implementation-source.md
 *   - docs/signaling-nostr-spec.md §"v2 content cipher (NIP-44, OPTIONAL)"
 *
 * Cipher source: nostr-tools/nip44 (sub-path import per ADR-0027 §2).
 * Room key: HKDF-SHA256 over UTF-8(roomId) per ADR-0024 §2 — derived
 * via WebCrypto (browser-standard preference, ADR-0027 §"Ruled-out
 * option" footnote: WebCrypto can do HKDF; only ChaCha20 is missing).
 *
 * The sentinel ("nv44") is prepended to the JSON plaintext outside
 * the cipher call (ADR-0027 §4); a v2 receiver that decrypts
 * successfully but does not see the sentinel discards the event
 * without falling back to v1 (ADR-0024 §5 step 4 — Codex P1 fix).
 */

import type { SignalingMessage } from "@senn/protocol";
import { decrypt, encrypt } from "nostr-tools/nip44";

const HKDF_SALT = new TextEncoder().encode("senn-nip44-v1");
const HKDF_INFO = new TextEncoder().encode("senn:nostr-signaling:v2");
const HKDF_LENGTH_BITS = 32 * 8;

/** 4-byte ASCII sentinel `nv44` prepended to v2 plaintext. */
export const V2_SENTINEL = "nv44";
const V2_SENTINEL_BYTES = new TextEncoder().encode(V2_SENTINEL);

/**
 * Derive the 32-byte room key for v2 encryption per ADR-0024 §2.
 *
 * `ikm` is `UTF-8(roomId)` — the bare 26-char Crockford base32
 * RoomId, NOT `senn:<roomId>`. The `senn:` prefix is the Nostr `t`
 * tag wrapper and MUST NOT enter the HKDF derivation (ADR-0024 §5
 * step 1 — Codex P1 fix).
 */
export async function deriveRoomKey(roomId: string): Promise<Uint8Array> {
  const ikm = new TextEncoder().encode(roomId);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT as BufferSource,
      info: HKDF_INFO as BufferSource,
    },
    baseKey,
    HKDF_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypt a SignalingMessage as a v2 content envelope.
 *
 * Plaintext = `UTF-8("nv44") || UTF-8(JSON.stringify(message))`.
 * The cipher call uses the upstream default nonce (random 32 bytes
 * per call) — see ADR-0024 §4 / ADR-0027 §"Non-deterministic
 * ciphertext".
 */
export function encryptV2(message: SignalingMessage, roomKey: Uint8Array): string {
  pinKeyLength(roomKey);
  const plaintext = `${V2_SENTINEL}${JSON.stringify(message)}`;
  return encrypt(plaintext, roomKey);
}

/**
 * Result of attempting to interpret a kind-25556 event's `content`
 * field per ADR-0024 §5 (7-step receive path):
 *
 *   - `v2`           — decrypted, sentinel matched, JSON parsed.
 *   - `v2-no-sentinel` — decrypted but no sentinel; per §5 step 4
 *                        the receiver MUST discard and MUST NOT
 *                        try v1 fallback.
 *   - `decrypt-fail` — NIP-44 decrypt threw; caller should attempt
 *                      v1 JSON.parse (§5 step 5).
 */
export type V2DecryptResult =
  | { kind: "v2"; message: SignalingMessage }
  | { kind: "v2-no-sentinel" }
  | { kind: "decrypt-fail" };

/**
 * Try to decrypt an event's `content` as a v2 envelope. Returns a
 * tagged result; never throws.
 *
 * The caller (NostrSignaling.handleEvent) decides what to do based
 * on the tag — for v1 fallback the result must be `decrypt-fail`,
 * which means "this is not v2 ciphertext, try v1 JSON.parse".
 */
export function tryDecryptV2(content: string, roomKey: Uint8Array): V2DecryptResult {
  pinKeyLength(roomKey);
  let plaintext: string;
  try {
    plaintext = decrypt(content, roomKey);
  } catch {
    return { kind: "decrypt-fail" };
  }
  if (!plaintext.startsWith(V2_SENTINEL)) {
    return { kind: "v2-no-sentinel" };
  }
  let message: SignalingMessage;
  try {
    message = JSON.parse(plaintext.slice(V2_SENTINEL_BYTES.length)) as SignalingMessage;
  } catch {
    // Decrypt succeeded with sentinel, but the payload is not valid
    // JSON. Per ADR-0024 §5 step 4's spirit ("not a v1 frame"),
    // discard rather than fall back. Surfaced as `v2-no-sentinel`
    // so the caller treats it the same as a sentinel mismatch.
    return { kind: "v2-no-sentinel" };
  }
  return { kind: "v2", message };
}

/**
 * Construction-time known-answer test (ADR-0027 §5).
 *
 * Loads the bundled fixture and verifies a deterministic round-trip
 * through the upstream `nostr-tools/nip44` module:
 *
 *   - encrypt(plaintext, conversationKey, fixedNonce) === fixture.ciphertext
 *   - decrypt(fixture.ciphertext, conversationKey) === fixture.plaintext
 *
 * Fails (throws) if either comparison mismatches. The caller (the
 * `NostrSignaling` constructor when v2 is enabled) MUST surface the
 * throw and MUST NOT fall back to v1 on KAT failure (ADR-0027 §5,
 * §5a pattern #6).
 *
 * The KAT itself is async because it loads a JSON file; the v2 init
 * promise on `NostrSignaling` awaits it before the first publish or
 * subscribe op, so any KAT failure surfaces deterministically before
 * any encrypted message is exchanged with peers.
 */
export async function runConstructionTimeKAT(): Promise<void> {
  const fixture = await loadKATFixture();
  const conversationKey = hexToBytes(fixture.conversationKey);
  const nonce = hexToBytes(fixture.nonce);
  pinKeyLength(conversationKey);

  const observedCiphertext = encrypt(fixture.plaintext, conversationKey, nonce);
  if (observedCiphertext !== fixture.ciphertext) {
    throw new Error(
      `senn: NIP-44 v2 KAT failed — encrypt(plaintext, key, fixedNonce) does not match fixture.ciphertext. Upstream nostr-tools/nip44 envelope may have changed. expected=${truncate(fixture.ciphertext)} observed=${truncate(observedCiphertext)}. See packages/signaling-nostr/test/fixtures/nip44-v2-vector.json.`,
    );
  }
  const observedPlaintext = decrypt(fixture.ciphertext, conversationKey);
  if (observedPlaintext !== fixture.plaintext) {
    throw new Error(
      `senn: NIP-44 v2 KAT failed — decrypt(fixture.ciphertext, key) does not match fixture.plaintext. Upstream nostr-tools/nip44 envelope may have changed. expected=${truncate(fixture.plaintext)} observed=${truncate(observedPlaintext)}.`,
    );
  }
}

interface KATFixture {
  readonly plaintext: string;
  readonly conversationKey: string;
  readonly nonce: string;
  readonly ciphertext: string;
}

/**
 * KAT fixture inlined as a TS const so the v2 path can run in
 * browser bundles (no `node:fs` import). The canonical JSON file
 * lives at `packages/signaling-nostr/test/fixtures/nip44-v2-vector.json`
 * (ADR-0027 §5); a contract test verifies the two stay in sync.
 *
 * Regenerate by re-running the upstream nostr-tools/nip44.encrypt
 * round-trip with the fixed conversationKey + nonce — see the
 * `description` field in the JSON file.
 */
export const KAT_FIXTURE: KATFixture = {
  plaintext: 'nv44{"type":"hello","v":1}',
  conversationKey: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
  nonce: "a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0",
  ciphertext:
    "AqGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr/Am8/2vbzK7d4WM+waqrzDTerdBF3QWa7QdM+Wjjb96+kFmpC96RH+1hUWR12jV/MM3/t9VPGWuctsF6hvX4lS6P9b",
};

async function loadKATFixture(): Promise<KATFixture> {
  return KAT_FIXTURE;
}

function pinKeyLength(key: Uint8Array): void {
  // ADR-0027 §3 — the conversationKey passed to nostr-tools/nip44
  // MUST be exactly 32 bytes. Pin at the SENN boundary because the
  // upstream signature does not.
  if (key.length !== 32) {
    throw new Error(`senn: NIP-44 v2 conversationKey MUST be 32 bytes, got ${key.length}`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`senn: invalid hex string (odd length): ${truncate(hex)}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`senn: invalid hex byte at offset ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

function truncate(s: string, n = 32): string {
  return s.length > n ? `${s.slice(0, n)}…(${s.length} total)` : s;
}
