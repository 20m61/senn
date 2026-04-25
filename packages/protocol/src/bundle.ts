/**
 * Signaling bundle — payload that may travel via URL fragment, QR code,
 * copy/paste, or any other out-of-band channel.
 *
 * Spec: docs/signaling-url-fragment-spec.md.
 *
 * Wire format: JSON.stringify(bundle) → UTF-8 → deflate-raw → base64url.
 */

import { type RoomId, isPeerId, isRoomId } from "./ids.js";
import { InviteValidationError } from "./invite.js";
import type { SignalingMessage } from "./signaling.js";

export const SIGNALING_BUNDLE_VERSION = 1 as const;
export const SIGNALING_BUNDLE_FRAGMENT_KEY = "s" as const;

export interface SignalingBundleV1 {
  readonly v: typeof SIGNALING_BUNDLE_VERSION;
  readonly roomId: RoomId;
  readonly messages: readonly SignalingMessage[];
}

export class BundleValidationError extends Error {
  constructor(message: string) {
    super(`senn: bundle validation failed — ${message}`);
    this.name = "BundleValidationError";
  }
}

const ALLOWED_BUNDLE_KEYS: readonly string[] = ["v", "roomId", "messages"];
const KNOWN_KINDS = new Set(["offer", "answer", "ice", "bye"]);

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BundleValidationError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function validateMessage(value: unknown, idx: number): SignalingMessage {
  const obj = asObject(value, `messages[${idx}]`);
  const kind = obj.kind;
  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) {
    throw new BundleValidationError(`messages[${idx}].kind is invalid: ${String(kind)}`);
  }
  if (!isPeerId(obj.from)) {
    throw new BundleValidationError(`messages[${idx}].from is not a PeerId`);
  }
  switch (kind) {
    case "offer": {
      if (typeof obj.sdp !== "string" || obj.sdp.length === 0) {
        throw new BundleValidationError(`messages[${idx}].sdp must be a non-empty string`);
      }
      const allowed = new Set(["kind", "from", "sdp"]);
      for (const k of Object.keys(obj)) {
        if (!allowed.has(k)) {
          throw new BundleValidationError(`messages[${idx}] unknown field: ${k}`);
        }
      }
      return { kind: "offer", from: obj.from, sdp: obj.sdp };
    }
    case "answer": {
      if (typeof obj.sdp !== "string" || obj.sdp.length === 0) {
        throw new BundleValidationError(`messages[${idx}].sdp must be a non-empty string`);
      }
      if (!isPeerId(obj.to)) {
        throw new BundleValidationError(`messages[${idx}].to is not a PeerId`);
      }
      const allowed = new Set(["kind", "from", "to", "sdp"]);
      for (const k of Object.keys(obj)) {
        if (!allowed.has(k)) {
          throw new BundleValidationError(`messages[${idx}] unknown field: ${k}`);
        }
      }
      return { kind: "answer", from: obj.from, to: obj.to, sdp: obj.sdp };
    }
    case "ice": {
      if (typeof obj.candidate !== "object" || obj.candidate === null) {
        throw new BundleValidationError(
          `messages[${idx}].candidate must be an RTCIceCandidateInit`,
        );
      }
      if (!isPeerId(obj.to)) {
        throw new BundleValidationError(`messages[${idx}].to is not a PeerId`);
      }
      const allowed = new Set(["kind", "from", "to", "candidate"]);
      for (const k of Object.keys(obj)) {
        if (!allowed.has(k)) {
          throw new BundleValidationError(`messages[${idx}] unknown field: ${k}`);
        }
      }
      return {
        kind: "ice",
        from: obj.from,
        to: obj.to,
        candidate: obj.candidate as RTCIceCandidateInit,
      };
    }
    case "bye": {
      const allowed = new Set(["kind", "from"]);
      for (const k of Object.keys(obj)) {
        if (!allowed.has(k)) {
          throw new BundleValidationError(`messages[${idx}] unknown field: ${k}`);
        }
      }
      return { kind: "bye", from: obj.from };
    }
    default:
      throw new BundleValidationError(`unreachable kind ${kind}`);
  }
}

export function validateSignalingBundle(value: unknown): SignalingBundleV1 {
  const obj = asObject(value, "bundle");
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_BUNDLE_KEYS.includes(key)) {
      throw new BundleValidationError(`unknown field: ${key}`);
    }
  }
  if (obj.v !== SIGNALING_BUNDLE_VERSION) {
    throw new BundleValidationError(`v must be ${SIGNALING_BUNDLE_VERSION}`);
  }
  if (!isRoomId(obj.roomId)) {
    throw new BundleValidationError("roomId is not a RoomId");
  }
  if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
    throw new BundleValidationError("messages must be a non-empty array");
  }
  const messages = obj.messages.map((m, i) => validateMessage(m, i));
  return {
    v: SIGNALING_BUNDLE_VERSION,
    roomId: obj.roomId,
    messages,
  };
}

export async function encodeSignalingBundle(bundle: SignalingBundleV1): Promise<string> {
  validateSignalingBundle(bundle);
  const json = JSON.stringify(bundle);
  const utf8 = new TextEncoder().encode(json);
  const compressed = await runStream(new CompressionStream("deflate-raw"), utf8);
  return base64urlEncode(compressed);
}

export async function decodeSignalingBundle(encoded: string): Promise<SignalingBundleV1> {
  const compressed = base64urlDecode(encoded);
  const utf8 = await runStream(new DecompressionStream("deflate-raw"), compressed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(utf8));
  } catch (err) {
    throw new BundleValidationError(`payload is not valid JSON: ${(err as Error).message}`);
  }
  return validateSignalingBundle(parsed);
}

export function extractBundleFromUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch (err) {
    throw new BundleValidationError(`not a valid URL: ${(err as Error).message}`);
  }
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!fragment) return null;
  const params = new URLSearchParams(fragment);
  return params.get(SIGNALING_BUNDLE_FRAGMENT_KEY);
}

// ---------------------------------------------------------------------------
// Internal helpers (duplicated locally to keep bundle.ts self-contained;
// the same primitives live in invite.ts and stay in lock-step by spec.)
// ---------------------------------------------------------------------------

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
    throw new BundleValidationError("bundle is not base64url");
  }
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) lookup[B64_ALPHABET.charCodeAt(i)] = i;

  const len = encoded.length;
  const fullGroups = Math.floor(len / 4);
  const tail = len - fullGroups * 4;
  if (tail === 1) throw new BundleValidationError("invalid base64url length");

  const outLen = fullGroups * 3 + (tail === 0 ? 0 : tail - 1);
  const out = new Uint8Array(outLen);
  let oi = 0;
  let ii = 0;
  for (let g = 0; g < fullGroups; g++) {
    const a = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const b = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const c = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const d = lookup[encoded.charCodeAt(ii++)] ?? -1;
    if ((a | b | c | d) < 0) throw new BundleValidationError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
    out[oi++] = ((b & 0x0f) << 4) | (c >> 2);
    out[oi++] = ((c & 0x03) << 6) | d;
  }
  if (tail === 2) {
    const a = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const b = lookup[encoded.charCodeAt(ii++)] ?? -1;
    if ((a | b) < 0) throw new BundleValidationError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
  } else if (tail === 3) {
    const a = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const b = lookup[encoded.charCodeAt(ii++)] ?? -1;
    const c = lookup[encoded.charCodeAt(ii++)] ?? -1;
    if ((a | b | c) < 0) throw new BundleValidationError("invalid base64url digit");
    out[oi++] = (a << 2) | (b >> 4);
    out[oi++] = ((b & 0x0f) << 4) | (c >> 2);
  }
  return out;
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

// Re-export for callers that catch validation across both surfaces.
export { InviteValidationError };
