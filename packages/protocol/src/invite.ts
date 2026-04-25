/**
 * Invite payload and URL encoding.
 *
 * Spec: docs/room-and-invite-spec.md.
 *
 * Wire format:  JSON.stringify(payload) → UTF-8 → CompressionStream("deflate-raw") → base64url (no padding)
 * URL form:     <https origin and path>#i=<encoded>
 */

import { type PeerId, type RoomId, isPeerId, isRoomId } from "./ids.js";

export const INVITE_PAYLOAD_VERSION = 1 as const;
export const INVITE_FRAGMENT_KEY = "i" as const;
export const INVITE_URL_MAX_LENGTH = 2048;

export interface InvitePayload {
  readonly v: typeof INVITE_PAYLOAD_VERSION;
  readonly roomId: RoomId;
  readonly from: PeerId;
  readonly protocolVersion: string;
  readonly capabilities: readonly string[];
  readonly note?: string;
}

const ALLOWED_KEYS: readonly string[] = [
  "v",
  "roomId",
  "from",
  "protocolVersion",
  "capabilities",
  "note",
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CAPABILITY_TAG = /^[a-z][a-z0-9-]*-v[0-9]+$/;

export class InviteValidationError extends Error {
  constructor(message: string) {
    super(`senn: invite validation failed — ${message}`);
    this.name = "InviteValidationError";
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InviteValidationError("payload is not an object");
  }
  return value as Record<string, unknown>;
}

/** Validate an arbitrary value as a `InvitePayload`. Throws on failure. */
export function validateInvitePayload(value: unknown): InvitePayload {
  const obj = asObject(value);

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new InviteValidationError(`unknown field: ${key}`);
    }
  }

  if (obj.v !== INVITE_PAYLOAD_VERSION) {
    throw new InviteValidationError(`v must be ${INVITE_PAYLOAD_VERSION}`);
  }
  if (!isRoomId(obj.roomId)) throw new InviteValidationError("roomId is not a RoomId");
  if (!isPeerId(obj.from)) throw new InviteValidationError("from is not a PeerId");
  if (typeof obj.protocolVersion !== "string" || !SEMVER.test(obj.protocolVersion)) {
    throw new InviteValidationError("protocolVersion is not SemVer");
  }
  if (!Array.isArray(obj.capabilities) || obj.capabilities.length === 0) {
    throw new InviteValidationError("capabilities must be a non-empty array");
  }
  for (const tag of obj.capabilities) {
    if (typeof tag !== "string" || !CAPABILITY_TAG.test(tag)) {
      throw new InviteValidationError(`invalid capability tag: ${String(tag)}`);
    }
  }
  if (obj.note !== undefined) {
    if (typeof obj.note !== "string") {
      throw new InviteValidationError("note must be a string when present");
    }
    if ([...obj.note].length > 64) {
      throw new InviteValidationError("note exceeds 64 code points");
    }
  }

  // Build the validated payload deterministically. (Object spread would
  // preserve unknown fields if validation skipped them, but we already
  // rejected those above.)
  const payload: InvitePayload = {
    v: INVITE_PAYLOAD_VERSION,
    roomId: obj.roomId,
    from: obj.from,
    protocolVersion: obj.protocolVersion,
    capabilities: [...obj.capabilities] as readonly string[],
    ...(obj.note !== undefined ? { note: obj.note } : {}),
  };
  return payload;
}

/** UTF-8 encode + deflate-raw + base64url. Does not include the URL prefix. */
export async function encodeInvite(payload: InvitePayload): Promise<string> {
  validateInvitePayload(payload);
  const json = canonicalJsonStringify(payload);
  const utf8 = new TextEncoder().encode(json);
  const compressed = await deflateRaw(utf8);
  return base64urlEncode(compressed);
}

/** base64url + inflate-raw + UTF-8 decode + JSON parse + schema validate. */
export async function decodeInvite(encoded: string): Promise<InvitePayload> {
  const compressed = base64urlDecode(encoded);
  const utf8 = await inflateRaw(compressed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(utf8));
  } catch (err) {
    throw new InviteValidationError(`payload is not valid JSON: ${(err as Error).message}`);
  }
  return validateInvitePayload(parsed);
}

/** Build a full invite URL from a base URL (origin + path) and a payload. */
export async function buildInviteUrl(baseUrl: string, payload: InvitePayload): Promise<string> {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "file:") {
    throw new InviteValidationError(`invite scheme must be https or file, got ${url.protocol}`);
  }
  url.hash = `${INVITE_FRAGMENT_KEY}=${await encodeInvite(payload)}`;
  const result = url.toString();
  if (result.length > INVITE_URL_MAX_LENGTH) {
    throw new InviteValidationError(
      `invite URL exceeds ${INVITE_URL_MAX_LENGTH} chars (${result.length})`,
    );
  }
  return result;
}

/** Parse an invite URL and return the validated payload. */
export async function parseInviteUrl(href: string): Promise<InvitePayload> {
  const url = new URL(href);
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const params = new URLSearchParams(fragment);
  const encoded = params.get(INVITE_FRAGMENT_KEY);
  if (!encoded) throw new InviteValidationError("missing #i= fragment");
  return decodeInvite(encoded);
}

// ---------------------------------------------------------------------------
// Internals: canonical JSON, base64url, deflate-raw via Web Streams
// ---------------------------------------------------------------------------

/** JSON stringify with a fixed key order so encoding is deterministic. */
function canonicalJsonStringify(payload: InvitePayload): string {
  const ordered: Record<string, unknown> = {
    v: payload.v,
    roomId: payload.roomId,
    from: payload.from,
    protocolVersion: payload.protocolVersion,
    capabilities: payload.capabilities,
  };
  if (payload.note !== undefined) ordered.note = payload.note;
  return JSON.stringify(ordered);
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64urlEncode(bytes: Uint8Array): string {
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

function base64urlDecode(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) {
    throw new InviteValidationError("invite is not base64url");
  }
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) lookup[B64_ALPHABET.charCodeAt(i)] = i;

  const len = encoded.length;
  const fullGroups = Math.floor(len / 4);
  const tail = len - fullGroups * 4;
  if (tail === 1) throw new InviteValidationError("invalid base64url length");

  const outLen = fullGroups * 3 + (tail === 0 ? 0 : tail - 1);
  const out = new Uint8Array(outLen);
  let oi = 0;
  let ii = 0;
  for (let g = 0; g < fullGroups; g++) {
    const a = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const b = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const c = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const d = lookup[encoded.charCodeAt(ii++)] ?? -1;
    if ((a | b | c | d) < 0) throw new InviteValidationError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
    out[oi++] = ((b & 0x0f) << 4) | (c >> 2);
    out[oi++] = ((c & 0x03) << 6) | d;
  }
  if (tail === 2) {
    const a = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const b = lookup[encoded.charCodeAt(ii++)] ?? -1;
    if ((a | b) < 0) throw new InviteValidationError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
  } else if (tail === 3) {
    const a = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const b = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const c = lookup[encoded.charCodeAt(ii++)] ?? -1;
    if ((a | b | c) < 0) throw new InviteValidationError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
    out[oi++] = ((b & 0x0f) << 4) | (c >> 2);
  }
  return out;
}

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  return runStream(new CompressionStream("deflate-raw"), input);
}

async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  return runStream(new DecompressionStream("deflate-raw"), input);
}

async function runStream(ts: GenericTransformStream, input: Uint8Array): Promise<Uint8Array> {
  const writer = ts.writable.getWriter();
  await writer.write(input);
  await writer.close();
  const reader = ts.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
