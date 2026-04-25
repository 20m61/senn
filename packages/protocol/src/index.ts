export const SENN_PROTOCOL_VERSION = "0.1.0";

export type {
  SignalingAdapterInfo,
  SignalingHandler,
  SignalingMessage,
  SignalingTransport,
  Unsubscribe,
} from "./signaling.js";

export {
  assertPeerId,
  assertRoomId,
  isPeerId,
  isRoomId,
  newPeerId,
  newRoomId,
} from "./ids.js";
export type { PeerId, RoomId } from "./ids.js";

export {
  buildInviteUrl,
  decodeInvite,
  encodeInvite,
  INVITE_FRAGMENT_KEY,
  INVITE_PAYLOAD_VERSION,
  INVITE_URL_MAX_LENGTH,
  InviteValidationError,
  parseInviteUrl,
  validateInvitePayload,
} from "./invite.js";
export type { InvitePayload } from "./invite.js";

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
