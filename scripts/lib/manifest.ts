/**
 * Manifest validation core (shared by validate-addon-manifest.ts and
 * validate-all-manifests.ts). Keep this in sync with docs/addon-manifest.md.
 */
import { readFile } from "node:fs/promises";

export const REQUIRED_FIELDS = [
  "id",
  "name",
  "version",
  "entry",
  "license",
  "permissions",
  "network",
  "capabilities",
] as const;

export const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set([
  "peer.send",
  "peer.receive",
  "peer.send.bin",
  "peer.receive.bin",
  "storage.local.read",
  "storage.local.write",
  "file.read.user_selected",
  "file.write.user_approved",
  "ui.panel",
  "ui.overlay",
  "presence.read",
  "audio.level",
]);

export class ManifestValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`manifest invalid (${path}): ${message}`);
    this.name = "ManifestValidationError";
    this.path = path;
  }
}

interface ManifestShape {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  entry?: unknown;
  license?: unknown;
  permissions?: unknown;
  network?: unknown;
  capabilities?: unknown;
}

export async function validateManifestFile(path: string): Promise<void> {
  const raw = await readFile(path, "utf8");
  let manifest: ManifestShape;
  try {
    manifest = JSON.parse(raw) as ManifestShape;
  } catch (err) {
    throw new ManifestValidationError(path, `not valid JSON: ${(err as Error).message}`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in manifest)) {
      throw new ManifestValidationError(path, `missing required field: ${field}`);
    }
  }
  if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) {
    throw new ManifestValidationError(
      path,
      "id must match reverse-DNS pattern (see docs/addon-manifest.md)",
    );
  }
  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    throw new ManifestValidationError(path, "version must be SemVer 2.0.0");
  }
  if (manifest.network !== false) {
    throw new ManifestValidationError(path, "network must be false");
  }
  if (!Array.isArray(manifest.permissions)) {
    throw new ManifestValidationError(path, "permissions must be an array");
  }
  for (const perm of manifest.permissions as unknown[]) {
    if (typeof perm !== "string" || !KNOWN_PERMISSIONS.has(perm)) {
      throw new ManifestValidationError(path, `unknown permission: ${String(perm)}`);
    }
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    throw new ManifestValidationError(path, "capabilities must be a non-empty array");
  }
}
