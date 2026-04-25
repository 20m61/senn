/**
 * Message envelopes carried over the `core.text` data channel.
 * See docs/core-spec.md and docs/addon-runtime-spec.md.
 */

export interface CoreMessageEnvelope {
  readonly id: string;
  readonly kind: "core.message";
  readonly type: string;
  readonly createdAt: number;
  readonly payload: unknown;
}

export interface AddonMessageEnvelope {
  readonly id: string;
  readonly kind: "addon.message";
  readonly addon: string;
  readonly version: string;
  readonly createdAt: number;
  readonly payload: unknown;
}

export type MessageEnvelope = CoreMessageEnvelope | AddonMessageEnvelope;

const ADDON_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export class EnvelopeValidationError extends Error {
  constructor(message: string) {
    super(`senn: envelope validation failed — ${message}`);
    this.name = "EnvelopeValidationError";
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EnvelopeValidationError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

export function validateAddonEnvelope(value: unknown): AddonMessageEnvelope {
  const obj = asObject(value, "addon envelope");
  if (obj.kind !== "addon.message") throw new EnvelopeValidationError("kind must be addon.message");
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    throw new EnvelopeValidationError("id must be a non-empty string");
  }
  if (typeof obj.addon !== "string" || !ADDON_ID.test(obj.addon)) {
    throw new EnvelopeValidationError("addon must be a reverse-DNS id");
  }
  if (typeof obj.version !== "string" || !SEMVER.test(obj.version)) {
    throw new EnvelopeValidationError("version must be SemVer");
  }
  if (typeof obj.createdAt !== "number" || !Number.isFinite(obj.createdAt)) {
    throw new EnvelopeValidationError("createdAt must be a finite number");
  }
  if (!("payload" in obj)) throw new EnvelopeValidationError("payload missing");
  return {
    id: obj.id,
    kind: "addon.message",
    addon: obj.addon,
    version: obj.version,
    createdAt: obj.createdAt,
    payload: obj.payload,
  };
}

export function tryParseAddonEnvelope(json: string): AddonMessageEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if ((parsed as { kind?: unknown }).kind !== "addon.message") return null;
  try {
    return validateAddonEnvelope(parsed);
  } catch {
    return null;
  }
}
