import { SENN_CORE_VERSION } from "@senn/core";
import {
  type InvitePayload,
  type PeerId,
  type RoomId,
  SENN_PROTOCOL_VERSION,
  SIGNALING_BUNDLE_VERSION,
  type SignalingBundleV1,
  type SignalingMessage,
  buildInviteBundleUrl,
  decodeSignalingBundle,
  newPeerId,
  newRoomId,
  parseInviteBundleUrl,
} from "@senn/protocol";
import { UrlFragmentSignaling } from "@senn/signaling-url-fragment";

const transport = new UrlFragmentSignaling();
const me: PeerId = newPeerId();
let room: RoomId | null = null;
let remotePeer: PeerId | null = null;

const statusEl = document.querySelector<HTMLElement>("#status");
const inbox = document.querySelector<HTMLUListElement>("#inbox");
const roomLabel = document.querySelector<HTMLSpanElement>("#room-id");
const exportOut = document.querySelector<HTMLTextAreaElement>("#export-out");
const importIn = document.querySelector<HTMLInputElement>("#import-in");
const msgKind = document.querySelector<HTMLSelectElement>("#msg-kind");

if (statusEl) {
  const line = document.createElement("p");
  line.textContent = `Core ${SENN_CORE_VERSION} · Protocol ${SENN_PROTOCOL_VERSION} · Adapter ${UrlFragmentSignaling.info.id}`;
  statusEl.append(line);
  const peerLine = document.createElement("p");
  peerLine.textContent = `peerId = ${short(me)}`;
  statusEl.append(peerLine);
}

function log(text: string): void {
  if (!inbox) return;
  const li = document.createElement("li");
  li.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  inbox.append(li);
}

function short(id: string): string {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function ensureLocalRoom(): RoomId {
  if (!room) {
    room = newRoomId();
    if (roomLabel) roomLabel.textContent = room;
    transport.subscribe(room, (m) => {
      remotePeer = m.from === me ? remotePeer : m.from;
      log(`recv ${m.kind} from ${short(m.from)}`);
    });
    log(`room = ${short(room)} (inviter)`);
  }
  return room;
}

function joinRemoteRoom(invite: InvitePayload): void {
  if (room && room !== invite.roomId) {
    log(`ignoring invite for a different room ${short(invite.roomId)}`);
    return;
  }
  if (!room) {
    room = invite.roomId;
    remotePeer = invite.from;
    if (roomLabel) roomLabel.textContent = room;
    transport.subscribe(room, (m) => log(`recv ${m.kind} from ${short(m.from)}`));
    log(`room = ${short(room)} (joiner; inviter = ${short(invite.from)})`);
  }
}

function buildMessage(kind: string, peer: PeerId): SignalingMessage {
  switch (kind) {
    case "offer":
      return { kind: "offer", from: peer, sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
    case "answer": {
      const to = remotePeer ?? peer;
      return {
        kind: "answer",
        from: peer,
        to,
        sdp: "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n",
      };
    }
    case "ice": {
      const to = remotePeer ?? peer;
      return {
        kind: "ice",
        from: peer,
        to,
        candidate: {
          candidate: "candidate:demo 1 UDP 1 1.1.1.1 1 typ host",
          sdpMLineIndex: 0,
        },
      };
    }
    case "bye":
      return { kind: "bye", from: peer };
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

async function composeExportUrl(): Promise<string | null> {
  const r = room;
  if (!r) return null;
  const encoded = await transport.exportBundle(r);
  if (!encoded) return "";
  // First hop from the inviter: include #i= too, so the joiner learns the room.
  const isFirstHop = remotePeer === null && r === room;
  if (isFirstHop) {
    const invite: InvitePayload = {
      v: 1,
      roomId: r,
      from: me,
      protocolVersion: SENN_PROTOCOL_VERSION,
      capabilities: ["text-v1"],
    };
    // Re-derive the bundle we just exported from the messages the user
    // published. `exportBundle` already drained the outbox, so reconstruct
    // a bundle for the combined URL by parsing the encoded form back.
    const decoded = await decodeSignalingBundle(encoded);
    const bundle: SignalingBundleV1 = {
      v: SIGNALING_BUNDLE_VERSION,
      roomId: r,
      messages: decoded.messages,
    };
    return buildInviteBundleUrl(`${location.origin}${location.pathname}`, invite, bundle);
  }
  return `${location.origin}${location.pathname}#${UrlFragmentSignaling.toFragment(encoded)}`;
}

document.querySelector<HTMLButtonElement>("#btn-create-room")?.addEventListener("click", () => {
  ensureLocalRoom();
});

document.querySelector<HTMLButtonElement>("#btn-publish")?.addEventListener("click", async () => {
  const r = room ?? ensureLocalRoom();
  const kind = msgKind?.value ?? "offer";
  await transport.publish(r, buildMessage(kind, me));
  log(`sent ${kind}`);
});

document.querySelector<HTMLButtonElement>("#btn-export")?.addEventListener("click", async () => {
  const url = await composeExportUrl();
  if (!exportOut) return;
  if (url === null) {
    exportOut.value = "(create a room first)";
    return;
  }
  if (url === "") {
    exportOut.value = "(outbox empty — publish a message first)";
    return;
  }
  exportOut.value = url;
  exportOut.select();
});

document.querySelector<HTMLButtonElement>("#btn-import")?.addEventListener("click", async () => {
  if (!importIn) return;
  const value = importIn.value.trim();
  if (!value) return;
  try {
    await consumeUrl(value);
  } catch (err) {
    log(`import error: ${(err as Error).message}`);
  }
  importIn.value = "";
});

async function consumeUrl(href: string): Promise<void> {
  // Prefer the combined parser when #i= is present.
  if (href.includes("#") && href.includes("i=")) {
    const parsed = await parseInviteBundleUrl(href);
    joinRemoteRoom(parsed.invite);
    if (parsed.bundle) {
      const encoded = UrlFragmentSignaling.fromUrl(href);
      if (encoded) {
        const r = await transport.importBundle(encoded);
        log(`imported ${r.delivered} message(s) via invite URL`);
      }
    }
    return;
  }
  // Otherwise treat as a plain #s=…
  const encoded = UrlFragmentSignaling.fromUrl(href) ?? href;
  if (!room) {
    log("cannot import bundle — no active room (join via an invite URL first)");
    return;
  }
  const r = await transport.importBundle(encoded);
  log(`imported ${r.delivered} message(s) for ${short(r.roomId)}`);
}

// Auto-consume any URL the page was opened with.
if (location.hash.includes("i=") || location.hash.includes("s=")) {
  consumeUrl(location.href).catch((err) => log(`auto-import error: ${(err as Error).message}`));
}
