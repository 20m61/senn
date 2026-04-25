/**
 * Room IDs and Peer IDs.
 *
 * Spec: docs/room-and-invite-spec.md.
 *
 * RoomId — 128 bits of CSPRNG, encoded as 26 chars of Crockford base32 (lowercase).
 * PeerId — ULID (48-bit ms timestamp || 80-bit randomness), 26 chars Crockford base32 (lowercase).
 *
 * Both alphabets exclude i, l, o, u to avoid visual ambiguity.
 */

export type RoomId = string & { readonly __brand: "RoomId" };
export type PeerId = string & { readonly __brand: "PeerId" };

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/;

function getCrypto(): Crypto {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("senn: Web Crypto (crypto.getRandomValues) is required");
  }
  return c;
}

/** Encode the high 130 bits of `bytes` (16 bytes input) into 26 base32 chars. */
function encodeBase32_130(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error("senn: expected 16 bytes");
  // We need 130 bits to produce 26 characters at 5 bits each.
  // Read as a 128-bit big-endian integer, left-shift 2 to fill 130 bits.
  let hi = 0n;
  for (let i = 0; i < 16; i++) hi = (hi << 8n) | BigInt(bytes[i] ?? 0);
  hi <<= 2n;
  let out = "";
  for (let i = 25; i >= 0; i--) {
    const idx = Number((hi >> BigInt(i * 5)) & 0x1fn);
    out += ALPHABET[idx];
  }
  return out;
}

/** Encode 48-bit ms timestamp (10 chars) || 80-bit randomness (16 chars). */
function encodeUlid(timestampMs: number, random10: Uint8Array): string {
  if (random10.length !== 10) throw new Error("senn: ulid randomness must be 10 bytes");
  if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > 0xffffffffffff) {
    throw new Error("senn: ulid timestamp out of range");
  }
  let ts = BigInt(timestampMs);
  let head = "";
  for (let i = 9; i >= 0; i--) {
    head += ALPHABET[Number(ts & 0x1fn)];
    ts >>= 5n;
  }
  head = head.split("").reverse().join("");

  // 80 bits → 16 chars at 5 bits each. Read big-endian, left-shift 0 (already 80 bits = 16*5).
  let r = 0n;
  for (let i = 0; i < 10; i++) r = (r << 8n) | BigInt(random10[i] ?? 0);
  let tail = "";
  for (let i = 15; i >= 0; i--) {
    tail += ALPHABET[Number((r >> BigInt(i * 5)) & 0x1fn)];
  }
  return head + tail;
}

/** Generate a new `RoomId` (128 bits CSPRNG). */
export function newRoomId(): RoomId {
  const bytes = new Uint8Array(16);
  getCrypto().getRandomValues(bytes);
  return encodeBase32_130(bytes) as RoomId;
}

/** Generate a new `PeerId` (ULID, current wall clock + 80 bits CSPRNG). */
export function newPeerId(now: number = Date.now()): PeerId {
  const random = new Uint8Array(10);
  getCrypto().getRandomValues(random);
  return encodeUlid(now, random) as PeerId;
}

export function isRoomId(value: unknown): value is RoomId {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isPeerId(value: unknown): value is PeerId {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function assertRoomId(value: unknown): asserts value is RoomId {
  if (!isRoomId(value)) throw new Error("senn: invalid RoomId");
}

export function assertPeerId(value: unknown): asserts value is PeerId {
  if (!isPeerId(value)) throw new Error("senn: invalid PeerId");
}
