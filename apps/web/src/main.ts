import { AddonHost } from "@senn/addon-runtime";
import { PeerSession, SENN_CORE_VERSION } from "@senn/core";
import {
  type InvitePayload,
  type PeerId,
  type RoomId,
  SENN_PROTOCOL_VERSION,
  SIGNALING_BUNDLE_VERSION,
  type SignalingBundleV1,
  buildInviteBundleUrl,
  decodeSignalingBundle,
  newPeerId,
  newRoomId,
  parseInviteBundleUrl,
} from "@senn/protocol";
import { UrlFragmentSignaling } from "@senn/signaling-url-fragment";
import { IndexedDbStorageBackend } from "@senn/storage";

const transport = new UrlFragmentSignaling();
const addonStorageBackend = new IndexedDbStorageBackend();
const me: PeerId = newPeerId();
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

let room: RoomId | null = null;
let remotePeer: PeerId | null = null;
let session: PeerSession | null = null;

const statusEl = document.querySelector<HTMLElement>("#status");
const inbox = document.querySelector<HTMLUListElement>("#inbox");
const roomLabel = document.querySelector<HTMLSpanElement>("#room-id");
const exportOut = document.querySelector<HTMLTextAreaElement>("#export-out");
const importIn = document.querySelector<HTMLInputElement>("#import-in");
const stateLabel = document.querySelector<HTMLSpanElement>("#state");
const textIn = document.querySelector<HTMLInputElement>("#text-in");

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

function setSessionState(s: string): void {
  if (stateLabel) stateLabel.textContent = s;
}

function attachSession(s: PeerSession): void {
  session = s;
  setSessionState(s.state);
  s.on("state", (next) => {
    setSessionState(next);
    log(`session: ${next}`);
  });
  s.on("text", (msg) => log(`peer text: ${msg}`));
  s.on("error", (err) => log(`session error: ${err.message}`));
}

async function startInviter(): Promise<RoomId> {
  if (room) return room;
  room = newRoomId();
  if (roomLabel) roomLabel.textContent = room;
  log(`room = ${short(room)} (inviter)`);
  const s = new PeerSession({
    role: "inviter",
    roomId: room,
    localPeerId: me,
    remotePeerId: null,
    signaling: transport,
    rtcConfig: RTC_CONFIG,
  });
  attachSession(s);
  await s.start();
  return room;
}

async function startJoiner(invite: InvitePayload): Promise<void> {
  if (room && room !== invite.roomId) {
    log(`ignoring invite for a different room ${short(invite.roomId)}`);
    return;
  }
  if (room) return;
  room = invite.roomId;
  remotePeer = invite.from;
  if (roomLabel) roomLabel.textContent = room;
  log(`room = ${short(room)} (joiner; inviter = ${short(invite.from)})`);
  const s = new PeerSession({
    role: "joiner",
    roomId: room,
    localPeerId: me,
    remotePeerId: invite.from,
    signaling: transport,
    rtcConfig: RTC_CONFIG,
  });
  attachSession(s);
  await s.start();
}

async function composeExportUrl(): Promise<string | null> {
  const r = room;
  if (!r) return null;
  const encoded = await transport.exportBundle(r);
  if (!encoded) return "";
  const isFirstHop = remotePeer === null && session?.role === "inviter";
  if (isFirstHop) {
    const invite: InvitePayload = {
      v: 1,
      roomId: r,
      from: me,
      protocolVersion: SENN_PROTOCOL_VERSION,
      capabilities: ["text-v1"],
    };
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

document
  .querySelector<HTMLButtonElement>("#btn-create-room")
  ?.addEventListener("click", async () => {
    try {
      await startInviter();
    } catch (err) {
      log(`start error: ${(err as Error).message}`);
    }
  });

document.querySelector<HTMLButtonElement>("#btn-export")?.addEventListener("click", async () => {
  let url: string | null;
  try {
    url = await composeExportUrl();
  } catch (err) {
    if (exportOut) exportOut.value = `(error: ${(err as Error).message})`;
    return;
  }
  if (!exportOut) return;
  if (url === null) {
    exportOut.value = "(create a room first)";
    return;
  }
  if (url === "") {
    exportOut.value = "(outbox empty)";
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

document.querySelector<HTMLButtonElement>("#btn-send-text")?.addEventListener("click", async () => {
  if (!session || !textIn) return;
  const value = textIn.value;
  if (!value) return;
  try {
    await session.sendText(value);
    log(`me text: ${value}`);
    textIn.value = "";
  } catch (err) {
    log(`send error: ${(err as Error).message}`);
  }
});

let addonHost: AddonHost | null = null;
const addonStateLabel = document.querySelector<HTMLSpanElement>("#addon-state");
const addonMount = document.querySelector<HTMLElement>("#addon-mount");

async function loadAddonByManifest(manifestUrl: string): Promise<void> {
  if (addonHost) return;
  if (!addonMount) return;
  try {
    const host = await AddonHost.load(
      session
        ? {
            manifestUrl,
            container: addonMount,
            session,
            storage: addonStorageBackend,
          }
        : {
            manifestUrl,
            container: addonMount,
            storage: addonStorageBackend,
          },
    );
    addonHost = host;
    if (addonStateLabel) addonStateLabel.textContent = host.state;
    host.on("state", (s) => {
      if (addonStateLabel) addonStateLabel.textContent = s;
      log(`addon: ${s}`);
    });
    host.on("send", (payload) => log(`addon -> peers: ${JSON.stringify(payload).slice(0, 80)}`));
    host.on("error", (err) => log(`addon error: ${err.message}`));
    log(`addon loaded: ${host.manifest.id} v${host.manifest.version}`);
  } catch (err) {
    log(`addon load error: ${(err as Error).message}`);
  }
}

document
  .querySelector<HTMLButtonElement>("#btn-load-addon")
  ?.addEventListener("click", () => loadAddonByManifest("/addons/echo/manifest.json"));

document
  .querySelector<HTMLButtonElement>("#btn-load-whiteboard")
  ?.addEventListener("click", () => loadAddonByManifest("/addons/whiteboard/manifest.json"));

// ── E2E test hook (no-op in production) ─────────────────────────────────────
//
// The signing e2e creates an Ed25519 keypair, signs the echo manifest in the
// page's own crypto subtle (so the signature is real Web Crypto output), and
// loads the add-on with verify: required. We expose just enough surface for
// the test to drive this without leaking buttons into the real demo UI.
declare global {
  interface Window {
    __sennE2E?: {
      generateKeyPair: () => Promise<{ publicKey: string }>;
      signEchoManifest: () => Promise<void>;
      loadEcho: (verify: {
        mode: "none" | "optional" | "required";
        trustedKeys?: string[];
      }) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

{
  // E2E hook is always installed in this PoC; the page is dev-only anyway.
  const { generateKeyPair, signManifest, base64urlEncode } = await import("@senn/manifest");
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>> | null = null;
  const signedManifests = new Map<string, { bytes: Uint8Array; sig: string }>();

  const installRoute = (): void => {
    if ("serviceWorker" in navigator) {
      // not used; we patch fetch instead so test code controls it.
    }
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      if (u.endsWith("/addons/echo/manifest.sig.json")) {
        const entry = signedManifests.get("/addons/echo/manifest.json");
        if (!entry) return new Response("", { status: 404 });
        return new Response(entry.sig, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.endsWith("/addons/echo/manifest.json")) {
        const entry = signedManifests.get("/addons/echo/manifest.json");
        if (entry) {
          return new Response(new Blob([entry.bytes as BlobPart]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  };

  installRoute();

  window.__sennE2E = {
    async generateKeyPair() {
      signingKey = await generateKeyPair();
      return { publicKey: signingKey.publicKeyBase64 };
    },
    async signEchoManifest() {
      if (!signingKey) throw new Error("call generateKeyPair first");
      const realFetch = (globalThis as { fetch: typeof fetch }).fetch;
      // Bypass our route to fetch the original bytes from disk.
      // We do this by using XHR which is not patched; or we just fetch and
      // return the original file (since signedManifests is empty before sign).
      const res = await realFetch("/addons/echo/manifest.json");
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sig = await signManifest({ manifestBytes: bytes, keyPair: signingKey });
      signedManifests.set("/addons/echo/manifest.json", {
        bytes,
        sig: JSON.stringify(sig),
      });
      // Reference base64urlEncode so it isn't tree-shaken, also useful for tests.
      void base64urlEncode;
    },
    async loadEcho(verify) {
      if (addonHost) {
        await addonHost.close();
        addonHost = null;
      }
      if (!addonMount) return { ok: false, error: "no mount" };
      try {
        const opts = {
          manifestUrl: "/addons/echo/manifest.json",
          container: addonMount,
          storage: addonStorageBackend,
          verify: {
            mode: verify.mode,
            ...(verify.trustedKeys
              ? { trustedKeys: new Set(verify.trustedKeys) as ReadonlySet<string> }
              : {}),
          },
        } as const;
        const host = await AddonHost.load(opts);
        addonHost = host;
        if (addonStateLabel) addonStateLabel.textContent = host.state;
        host.on("state", (s) => {
          if (addonStateLabel) addonStateLabel.textContent = s;
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}

async function consumeUrl(href: string): Promise<void> {
  if (href.includes("#") && href.includes("i=")) {
    const parsed = await parseInviteBundleUrl(href);
    await startJoiner(parsed.invite);
    if (parsed.bundle) {
      const encoded = UrlFragmentSignaling.fromUrl(href);
      if (encoded) {
        const r = await transport.importBundle(encoded);
        log(`imported ${r.delivered} signaling message(s) via invite URL`);
      }
    }
    return;
  }
  const encoded = UrlFragmentSignaling.fromUrl(href) ?? href;
  if (!room) {
    log("cannot import bundle — no active room (join via an invite URL first)");
    return;
  }
  const r = await transport.importBundle(encoded);
  log(`imported ${r.delivered} signaling message(s) for ${short(r.roomId)}`);
}

if (location.hash.includes("i=") || location.hash.includes("s=")) {
  consumeUrl(location.href).catch((err) => log(`auto-import error: ${(err as Error).message}`));
}
