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
  buildInviteBundleUrl,
  buildInviteUrl,
  decodeInvite,
  encodeInvite,
  INVITE_FRAGMENT_KEY,
  INVITE_PAYLOAD_VERSION,
  INVITE_URL_MAX_LENGTH,
  InviteValidationError,
  parseInviteBundleUrl,
  parseInviteUrl,
  validateInvitePayload,
} from "./invite.js";
export type { InvitePayload, ParsedInviteBundle } from "./invite.js";

export {
  BundleValidationError,
  decodeSignalingBundle,
  encodeSignalingBundle,
  extractBundleFromUrl,
  SIGNALING_BUNDLE_FRAGMENT_KEY,
  SIGNALING_BUNDLE_VERSION,
  validateSignalingBundle,
} from "./bundle.js";
export type { SignalingBundleV1 } from "./bundle.js";

export type MessageKind = "core.message" | "addon.message";

export {
  EnvelopeValidationError,
  tryParseAddonEnvelope,
  validateAddonEnvelope,
} from "./envelope.js";
export type {
  AddonMessageEnvelope,
  CoreMessageEnvelope,
  MessageEnvelope,
} from "./envelope.js";

export interface HelloMessage {
  type: "hello";
  client: "senn";
  version: string;
  capabilities: readonly string[];
}
