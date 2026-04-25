// SENN Local Vault add-on. Conforms to docs/addon-file-transfer-spec.md,
// docs/addon-storage-spec.md, and docs/addon-binary-transfer-spec.md.
// Uses @senn/addon-sdk's window.senn — no postMessage plumbing here.

const KEY_PREFIX = "vault/";
const PEER_BIN_MAX_BYTES = 4 * 1024 * 1024; // ADR-0012; bridge+PeerSession chunk transparently

const stateEl = document.getElementById("state");
const opStatus = document.getElementById("op-status");
const picker = document.getElementById("picker");
const btnAdd = document.getElementById("btn-add");
const listEl = document.getElementById("list");
const inboxEl = document.getElementById("inbox");

let initialized = false;

function setStatus(text) {
  opStatus.textContent = text;
}

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function refreshList() {
  const keys = await senn.storage.list();
  listEl.replaceChildren();
  const fileKeys = keys.filter((k) => k.startsWith(KEY_PREFIX));
  if (fileKeys.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "(no files yet)";
    listEl.append(li);
    return;
  }
  for (const k of fileKeys) {
    const rec = await senn.storage.get(k);
    if (!rec) continue;
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = rec.name;
    name.dataset.testid = "file-name";
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${rec.size} B · ${rec.type || "?"}`;
    const dl = document.createElement("button");
    dl.type = "button";
    dl.textContent = "download";
    dl.className = "download";
    dl.addEventListener("click", () => downloadKey(k, rec));
    const send = document.createElement("button");
    send.type = "button";
    send.textContent = "send to peer";
    send.className = "send";
    send.dataset.testid = "send-to-peer";
    send.addEventListener("click", () => sendToPeer(rec));
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "delete";
    rm.className = "delete";
    rm.addEventListener("click", async () => {
      await senn.storage.delete(k);
      setStatus(`deleted ${rec.name}`);
      await refreshList();
    });
    li.append(name, meta, dl, send, rm);
    listEl.append(li);
  }
}

function sendToPeer(rec) {
  const bytes = base64ToBytes(rec.b64);
  if (bytes.byteLength > PEER_BIN_MAX_BYTES) {
    setStatus(`too large to send (${bytes.byteLength} B; cap ${PEER_BIN_MAX_BYTES} B)`);
    return;
  }
  // Frame the filename into the bytes so the receiver knows what to label
  // it. Header layout: u16 LE name_len, name UTF-8, body bytes.
  const nameBytes = new TextEncoder().encode(rec.name);
  if (nameBytes.byteLength > 255) {
    setStatus("filename too long to send (max 255 B UTF-8)");
    return;
  }
  const frame = new Uint8Array(2 + nameBytes.byteLength + bytes.byteLength);
  new DataView(frame.buffer).setUint16(0, nameBytes.byteLength, true);
  frame.set(nameBytes, 2);
  frame.set(bytes, 2 + nameBytes.byteLength);
  if (frame.byteLength > PEER_BIN_MAX_BYTES) {
    setStatus(`too large to send including filename (${frame.byteLength} B)`);
    return;
  }
  senn.peer.sendBinary({
    mime: rec.type || "application/octet-stream",
    bytes: frame,
  });
  setStatus(`sent ${rec.name} (${bytes.byteLength} B) to peer`);
}

function handleIncoming(mime, framedBytes) {
  if (framedBytes.byteLength < 2) return;
  const nameLen = new DataView(framedBytes.buffer, framedBytes.byteOffset, 2).getUint16(0, true);
  if (2 + nameLen > framedBytes.byteLength) return;
  const name = new TextDecoder().decode(framedBytes.subarray(2, 2 + nameLen));
  const body = framedBytes.subarray(2 + nameLen);
  const li = document.createElement("li");
  const nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = name;
  nameEl.dataset.testid = "inbox-name";
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `${body.byteLength} B · ${mime || "?"}`;
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "save to vault";
  save.className = "save";
  save.dataset.testid = "inbox-save";
  save.addEventListener("click", async () => {
    const rec = {
      name,
      type: mime || "",
      size: body.byteLength,
      b64: bytesToBase64(body),
    };
    await senn.storage.put(`${KEY_PREFIX}${name}`, rec);
    setStatus(`saved received file ${name} to vault`);
    await refreshList();
  });
  li.append(nameEl, meta, save);
  inboxEl.append(li);
  setStatus(`received ${name} (${body.byteLength} B)`);
}

function downloadKey(_k, rec) {
  // The user clicked "download" — that gesture authorises the download
  // (per docs/addon-file-transfer-spec.md).
  const bytes = base64ToBytes(rec.b64);
  // ArrayBuffer copy so the Blob owns its own backing store independently
  // of any reuse of the same Uint8Array.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const url = URL.createObjectURL(
    new Blob([buf], { type: rec.type || "application/octet-stream" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = rec.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
  setStatus(`downloaded ${rec.name}`);
}

btnAdd.addEventListener("click", async () => {
  if (!initialized) return;
  const file = picker.files?.[0];
  if (!file) {
    setStatus("pick a file first");
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.byteLength > 700 * 1024) {
      setStatus(`file too large for storage (${bytes.byteLength} B; demo limit ~700 KB)`);
      return;
    }
    const rec = {
      name: file.name,
      type: file.type,
      size: bytes.byteLength,
      b64: bytesToBase64(bytes),
    };
    await senn.storage.put(`${KEY_PREFIX}${file.name}`, rec);
    setStatus(`added ${file.name} (${bytes.byteLength} B)`);
    picker.value = "";
    await refreshList();
  } catch (err) {
    setStatus(`error: ${err.message}`);
  }
});

senn.on("deliver-bin", ({ mime, bytes }) => handleIncoming(mime, bytes));
senn.on("error", (err) => setStatus(`bridge error: ${err.message}`));

senn.ready().then((ctx) => {
  stateEl.textContent = `init (${ctx.addonId} v${ctx.version})`;
  initialized = true;
  // Best-effort initial render — tolerated to fail before the host's first
  // storage call resolves.
  refreshList().catch(() => undefined);
});
stateEl.textContent = "ready";
