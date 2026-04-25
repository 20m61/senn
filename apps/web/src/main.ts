import { SENN_CORE_VERSION } from "@senn/core";
import {
  type PeerId,
  type RoomId,
  SENN_PROTOCOL_VERSION,
  type SignalingMessage,
  newPeerId,
  newRoomId,
} from "@senn/protocol";
import { UrlFragmentSignaling } from "@senn/signaling-url-fragment";

const status = document.querySelector<HTMLElement>("#status");
if (status) {
  const line = document.createElement("p");
  line.textContent = `Core ${SENN_CORE_VERSION} · Protocol ${SENN_PROTOCOL_VERSION} · Adapter ${UrlFragmentSignaling.info.id}`;
  status.append(line);
}

const transport = new UrlFragmentSignaling();
const me: PeerId = newPeerId();
let room: RoomId | null = null;

const inbox = document.querySelector<HTMLUListElement>("#inbox");
const roomLabel = document.querySelector<HTMLSpanElement>("#room-id");
const exportOut = document.querySelector<HTMLTextAreaElement>("#export-out");
const importIn = document.querySelector<HTMLInputElement>("#import-in");
const msgKind = document.querySelector<HTMLSelectElement>("#msg-kind");

function logInbox(text: string): void {
  if (!inbox) return;
  const li = document.createElement("li");
  li.textContent = text;
  inbox.append(li);
}

function ensureRoom(): RoomId {
  if (!room) {
    room = newRoomId();
    if (roomLabel) roomLabel.textContent = room;
    transport.subscribe(room, (m) => logInbox(`recv ${m.kind} from ${shortId(m.from)}`));
    logInbox(`peerId = ${shortId(me)}`);
  }
  return room;
}

function shortId(id: string): string {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function buildMessage(kind: string, peer: PeerId): SignalingMessage {
  switch (kind) {
    case "offer":
      return { kind: "offer", from: peer, sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" };
    case "answer":
      return {
        kind: "answer",
        from: peer,
        to: peer,
        sdp: "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n",
      };
    case "ice":
      return {
        kind: "ice",
        from: peer,
        to: peer,
        candidate: { candidate: "candidate:demo 1 UDP 1 1.1.1.1 1 typ host", sdpMLineIndex: 0 },
      };
    case "bye":
      return { kind: "bye", from: peer };
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

document.querySelector<HTMLButtonElement>("#btn-create-room")?.addEventListener("click", () => {
  ensureRoom();
});

document.querySelector<HTMLButtonElement>("#btn-publish")?.addEventListener("click", async () => {
  const r = ensureRoom();
  const kind = msgKind?.value ?? "offer";
  await transport.publish(r, buildMessage(kind, me));
  logInbox(`sent ${kind}`);
});

document.querySelector<HTMLButtonElement>("#btn-export")?.addEventListener("click", async () => {
  const r = ensureRoom();
  const encoded = await transport.exportBundle(r);
  if (!exportOut) return;
  if (!encoded) {
    exportOut.value = "(outbox empty — publish a message first)";
    return;
  }
  const url = `${location.origin}${location.pathname}#${UrlFragmentSignaling.toFragment(encoded)}`;
  exportOut.value = url;
  exportOut.select();
});

document.querySelector<HTMLButtonElement>("#btn-import")?.addEventListener("click", async () => {
  if (!importIn) return;
  const value = importIn.value.trim();
  if (!value) return;
  try {
    const encoded = UrlFragmentSignaling.fromUrl(value) ?? value;
    ensureRoom();
    const result = await transport.importBundle(encoded);
    if (result.delivered === 0) {
      logInbox(`bundle for ${shortId(result.roomId)} ignored — not subscribed in this tab`);
    } else {
      logInbox(`imported ${result.delivered} message(s) for room ${shortId(result.roomId)}`);
    }
  } catch (err) {
    logInbox(`import error: ${(err as Error).message}`);
  }
  importIn.value = "";
});

// Auto-import if loaded with #s=… in the URL.
const initial = UrlFragmentSignaling.fromUrl(location.href);
if (initial) {
  ensureRoom();
  transport
    .importBundle(initial)
    .then((r) => logInbox(`auto-imported ${r.delivered} message(s) for ${shortId(r.roomId)}`))
    .catch((err) => logInbox(`auto-import error: ${(err as Error).message}`));
}
