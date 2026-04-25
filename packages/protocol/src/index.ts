export const SENN_PROTOCOL_VERSION = "0.1.0";

export type MessageKind = "core.message" | "addon.message";

export interface CoreMessageEnvelope {
  id: string;
  kind: "core.message";
  type: string;
  createdAt: number;
  payload: unknown;
}

export interface AddonMessageEnvelope {
  id: string;
  kind: "addon.message";
  addon: string;
  version: string;
  createdAt: number;
  payload: unknown;
}

export type MessageEnvelope = CoreMessageEnvelope | AddonMessageEnvelope;

export interface HelloMessage {
  type: "hello";
  client: "senn";
  version: string;
  capabilities: readonly string[];
}
