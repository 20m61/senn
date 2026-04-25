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
import qrcode from "qrcode-generator";

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
const healthDot = document.querySelector<HTMLSpanElement>("#health-dot");
const uptimeEl = document.querySelector<HTMLSpanElement>("#uptime");
const iceInfoEl = document.querySelector<HTMLElement>("#ice-info");
const retryBtn = document.querySelector<HTMLButtonElement>("#btn-retry");
const textIn = document.querySelector<HTMLInputElement>("#text-in");

renderIceInfo();
let connectedAt: number | null = null;
let uptimeTimer: ReturnType<typeof setInterval> | null = null;

function renderIceInfo(): void {
  if (!iceInfoEl) return;
  const servers = RTC_CONFIG.iceServers ?? [];
  if (servers.length === 0) {
    iceInfoEl.textContent = "ICE: none configured (direct only)";
    return;
  }
  const labels = servers.flatMap((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.map((u) => {
      if (!u) return "?";
      if (u.startsWith("turn:") || u.startsWith("turns:")) return `TURN(${u})`;
      if (u.startsWith("stun:")) return `STUN(${u})`;
      return u;
    });
  });
  iceInfoEl.textContent = `ICE: ${labels.join(" · ")}`;
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}m${rest.toString().padStart(2, "0")}s`;
}

function refreshUptime(): void {
  if (!uptimeEl) return;
  if (connectedAt === null) {
    uptimeEl.textContent = "";
    return;
  }
  uptimeEl.textContent = `up ${fmtUptime(Date.now() - connectedAt)}`;
}

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
  if (healthDot) healthDot.dataset.state = s;
  if (s === "connected") {
    connectedAt = Date.now();
    refreshUptime();
    if (!uptimeTimer) uptimeTimer = setInterval(refreshUptime, 1_000);
  } else {
    connectedAt = null;
    if (uptimeTimer) {
      clearInterval(uptimeTimer);
      uptimeTimer = null;
    }
    refreshUptime();
  }
  if (retryBtn) {
    if (s === "failed" || s === "closed") {
      retryBtn.hidden = false;
    } else {
      retryBtn.hidden = true;
    }
  }
}

function attachSession(s: PeerSession): void {
  session = s;
  setSessionState(s.state);
  s.on("state", (next) => {
    setSessionState(next);
    log(`session: ${next}`);
    if (callStartBtn) callStartBtn.disabled = next !== "connected" || s.role !== "inviter";
  });
  s.on("text", (msg) => log(`peer text: ${msg}`));
  s.on("error", (err) => log(`session error: ${err.message}`));
  s.on("remote-track", ({ kind, track, streams }) => {
    log(`remote-track: ${kind} (${track.id})`);
    if (kind === "audio" && remoteAudio) {
      const stream = streams[0] ?? new MediaStream([track]);
      remoteAudio.srcObject = stream;
      void remoteAudio.play().catch(() => {
        // Autoplay may need a user gesture; surface to the user.
        log("remote-track: autoplay blocked — click the audio element to play");
      });
    }
  });
  s.on("remote-track-ended", ({ kind }) => {
    log(`remote-track-ended: ${kind}`);
    if (kind === "audio" && remoteAudio) remoteAudio.srcObject = null;
  });
}

async function resetForRetry(): Promise<void> {
  // Tear down everything tied to the old session and start fresh as the
  // inviter. The joiner side keeps the original invite URL on hand, so
  // a simple "create new room" matches both roles for v1.
  if (session) {
    try {
      await session.close();
    } catch {
      /* idempotent */
    }
    session = null;
  }
  if (addonHost) {
    try {
      await addonHost.close();
    } catch {
      /* idempotent */
    }
    addonHost = null;
  }
  room = null;
  remotePeer = null;
  if (roomLabel) roomLabel.textContent = "";
  if (exportOut) exportOut.value = "";
  setSessionState("idle");
  log("retry: reset; ready to create a new room");
  await startInviter();
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

document.querySelector<HTMLButtonElement>("#btn-retry")?.addEventListener("click", async () => {
  try {
    await resetForRetry();
  } catch (err) {
    log(`retry error: ${(err as Error).message}`);
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

// ── Share Modal (QR + clipboard) ────────────────────────────────────────────
//
// The Tier 0 invite URL is meant to be sent out-of-band. The Modal is a
// thin presentation layer over composeExportUrl: it does not change the
// invite contents, the signaling adapter, or any wire format.

const shareModal = document.querySelector<HTMLDialogElement>("#share-modal");
const shareQrEl = document.querySelector<HTMLDivElement>("#share-qr");
const shareUrlEl = document.querySelector<HTMLTextAreaElement>("#share-url");
const shareCopyStatus = document.querySelector<HTMLElement>("#share-copy-status");

function renderQr(target: HTMLElement, text: string): void {
  // Pick the smallest QR version that fits; fall back to a coarser ECC
  // level if the URL is too long even at version 40.
  for (const ecc of ["M", "L"] as const) {
    try {
      const qr = qrcode(0, ecc);
      qr.addData(text);
      qr.make();
      target.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
      return;
    } catch {
      /* try the next ECC level */
    }
  }
  target.textContent = "(URL too long for QR — use copy)";
}

document.querySelector<HTMLButtonElement>("#btn-share")?.addEventListener("click", async () => {
  if (!shareModal || !shareQrEl || !shareUrlEl) return;
  let url: string | null = null;
  try {
    url = await composeExportUrl();
  } catch (err) {
    log(`share error: ${(err as Error).message}`);
    return;
  }
  if (!url) {
    log("share: create a room first");
    return;
  }
  if (exportOut) exportOut.value = url;
  shareUrlEl.value = url;
  renderQr(shareQrEl, url);
  if (shareCopyStatus) shareCopyStatus.textContent = "";
  shareModal.showModal();
});

document.querySelector<HTMLButtonElement>("#share-close")?.addEventListener("click", () => {
  shareModal?.close();
});

document.querySelector<HTMLButtonElement>("#share-copy")?.addEventListener("click", async () => {
  if (!shareUrlEl) return;
  const text = shareUrlEl.value;
  try {
    await navigator.clipboard.writeText(text);
    if (shareCopyStatus) shareCopyStatus.textContent = "copied";
  } catch {
    // Clipboard API can be denied (no user gesture, no permission, http origin).
    // Fall back to selecting the text so the user can ⌘/Ctrl-C.
    shareUrlEl.select();
    if (shareCopyStatus) shareCopyStatus.textContent = "select + copy manually";
  }
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

async function loadAddonByManifest(
  manifestUrl: string,
  verify?: { mode: "required"; trustedKeys: ReadonlySet<string> },
): Promise<void> {
  if (addonHost) {
    await addonHost.close();
    addonHost = null;
  }
  if (!addonMount) return;
  try {
    const opts = {
      manifestUrl,
      container: addonMount,
      storage: addonStorageBackend,
      ...(session ? { session } : {}),
      ...(verify ? { verify } : {}),
    };
    const host = await AddonHost.load(opts);
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

document
  .querySelector<HTMLButtonElement>("#btn-load-presence")
  ?.addEventListener("click", () => loadAddonByManifest("/addons/avatar-presence/manifest.json"));

document
  .querySelector<HTMLButtonElement>("#btn-load-vault")
  ?.addEventListener("click", () => loadAddonByManifest("/addons/local-vault/manifest.json"));

document
  .querySelector<HTMLButtonElement>("#btn-load-meter")
  ?.addEventListener("click", () => loadAddonByManifest("/addons/voice-meter/manifest.json"));

// ── Audio level capture (host side of docs/addon-audio-level-spec.md) ──────
//
// AudioContext + AnalyserNode → RMS → addonHost.publishAudioLevel at ~20 Hz.
// The raw MediaStream stays on the host. The add-on iframe receives only
// the [0,1] scalar — there is no path from inside the iframe back to the
// stream.

interface AudioCapturePipeline {
  stop(): Promise<void>;
}

let micPipeline: AudioCapturePipeline | null = null;
const micStatusEl = document.querySelector<HTMLElement>("#mic-status");
const micToggleBtn = document.querySelector<HTMLButtonElement>("#btn-mic-toggle");

const callStartBtn = document.querySelector<HTMLButtonElement>("#btn-call-start");
const callStopBtn = document.querySelector<HTMLButtonElement>("#btn-call-stop");
const callStatusEl = document.querySelector<HTMLElement>("#call-status");
const remoteAudio = document.querySelector<HTMLAudioElement>("#remote-audio");

interface ActiveCall {
  readonly stream: MediaStream;
  readonly senders: Awaited<ReturnType<PeerSession["addLocalTrack"]>>[];
}
let activeCall: ActiveCall | null = null;

function setCallStatus(text: string): void {
  if (callStatusEl) callStatusEl.textContent = text;
}

function setMicStatus(text: string): void {
  if (micStatusEl) micStatusEl.textContent = text;
}

async function startAudioCapture(): Promise<AudioCapturePipeline> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const audioCtx = new (
    globalThis.AudioContext ||
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  )();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.4;
  source.connect(analyser);

  const buf = new Uint8Array(analyser.fftSize);
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] ?? 128) / 128 - 1; // [-1, 1]
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    // Scale RMS into a more readable [0,1] range — speech RMS sits around 0.05–0.3
    // in practice; multiply by ~3 and clamp so the meter actually moves.
    const level = Math.min(1, rms * 3);
    addonHost?.publishAudioLevel(level);
  };
  const timer = setInterval(tick, 50); // ~20 Hz, well under the 30 Hz cap

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      try {
        source.disconnect();
      } catch {
        /* idempotent */
      }
      for (const track of stream.getTracks()) track.stop();
      try {
        await audioCtx.close();
      } catch {
        /* idempotent */
      }
    },
  };
}

micToggleBtn?.addEventListener("click", async () => {
  if (micPipeline) {
    await micPipeline.stop();
    micPipeline = null;
    setMicStatus("mic: off");
    if (micToggleBtn) micToggleBtn.textContent = "enable mic for audio.level";
    return;
  }
  try {
    micPipeline = await startAudioCapture();
    setMicStatus("mic: on (publishing levels to active addon)");
    if (micToggleBtn) micToggleBtn.textContent = "disable mic";
  } catch (err) {
    setMicStatus(`mic: error — ${(err as Error).message}`);
  }
});

// ── Cross-peer mic call (ADR-0015 stage 1, inviter-only) ───────────────────

callStartBtn?.addEventListener("click", async () => {
  if (!session) {
    setCallStatus("call: no session");
    return;
  }
  if (session.role !== "inviter") {
    setCallStatus("call: stage 1 supports inviter only");
    return;
  }
  if (activeCall) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const senders: Awaited<ReturnType<PeerSession["addLocalTrack"]>>[] = [];
    for (const track of stream.getAudioTracks()) {
      senders.push(await session.addLocalTrack(track, stream));
    }
    activeCall = { stream, senders };
    setCallStatus(`call: live (${senders.length} track${senders.length === 1 ? "" : "s"})`);
    if (callStartBtn) callStartBtn.hidden = true;
    if (callStopBtn) callStopBtn.hidden = false;
  } catch (err) {
    setCallStatus(`call: error — ${(err as Error).message}`);
  }
});

callStopBtn?.addEventListener("click", async () => {
  if (!activeCall) return;
  try {
    for (const sender of activeCall.senders) {
      await sender.remove().catch(() => undefined);
    }
    for (const track of activeCall.stream.getTracks()) track.stop();
  } finally {
    activeCall = null;
    setCallStatus("call: idle");
    if (callStartBtn) callStartBtn.hidden = false;
    if (callStopBtn) callStopBtn.hidden = true;
  }
});

interface RegistryAddonV1 {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly path: string;
  readonly capabilities: readonly string[];
}
interface RegistryV1 {
  readonly v: 1;
  readonly publisher: { readonly name: string };
  readonly trustedKeys: readonly string[];
  readonly addons: readonly RegistryAddonV1[];
}

function registryPathToUrl(path: string): string | null {
  // The registry stores repo-relative paths; the web app only serves
  // addons under apps/web/public/. Other paths (e.g. examples/) are not
  // mountable from this origin and are skipped in the launcher.
  const prefix = "apps/web/public/";
  if (!path.startsWith(prefix)) return null;
  return `/${path.slice(prefix.length)}/manifest.json`;
}

async function renderOfficialRegistry(): Promise<void> {
  const statusEl = document.querySelector<HTMLElement>("#registry-status");
  const listEl = document.querySelector<HTMLUListElement>("#registry-list");
  if (!statusEl || !listEl) return;
  statusEl.textContent = "loading…";
  listEl.replaceChildren();
  let registry: RegistryV1;
  try {
    const res = await fetch("/registry/official/index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    registry = (await res.json()) as RegistryV1;
  } catch (err) {
    statusEl.textContent = `registry unavailable — ${(err as Error).message}`;
    return;
  }
  const trustedKeys = new Set(registry.trustedKeys);
  statusEl.textContent = `publisher ${registry.publisher.name} · ${registry.addons.length} addons · ${trustedKeys.size} trusted key(s)`;
  for (const addon of registry.addons) {
    const url = registryPathToUrl(addon.path);
    const li = document.createElement("li");
    li.dataset.addonId = addon.id;
    const head = document.createElement("div");
    head.className = "row";
    const name = document.createElement("strong");
    name.textContent = `${addon.name} v${addon.version}`;
    const idEl = document.createElement("span");
    idEl.className = "muted mono";
    idEl.textContent = addon.id;
    head.append(name, idEl);
    const desc = document.createElement("p");
    desc.className = "muted";
    desc.textContent = addon.description;
    const capRow = document.createElement("p");
    capRow.className = "muted mono";
    capRow.textContent = `capabilities: ${addon.capabilities.join(", ")}`;
    li.append(head, desc, capRow);
    if (url) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "load (verify=required)";
      btn.dataset.testid = `registry-load-${addon.id}`;
      btn.addEventListener("click", () =>
        loadAddonByManifest(url, { mode: "required", trustedKeys }),
      );
      li.append(btn);
    } else {
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = "(not mounted under apps/web/public — skipped)";
      li.append(note);
    }
    listEl.append(li);
  }
}

void renderOfficialRegistry();

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
      loadShipped: (
        manifestUrl: string,
        verify: {
          mode: "none" | "optional" | "required";
          trustedKeys?: string[];
        },
      ) => Promise<{ ok: boolean; error?: string }>;
      publishAudioLevel: (level: number) => boolean;
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
    async loadShipped(manifestUrl, verify) {
      if (addonHost) {
        await addonHost.close();
        addonHost = null;
      }
      if (!addonMount) return { ok: false, error: "no mount" };
      try {
        const opts = {
          manifestUrl,
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
    publishAudioLevel(level) {
      if (!addonHost) return false;
      addonHost.publishAudioLevel(level);
      return true;
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
