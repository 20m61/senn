export const SENN_ADDON_RUNTIME_VERSION = "0.0.0";

export interface AddonHostOptions {
  readonly manifestUrl: string;
  readonly sandbox?: readonly string[];
}
