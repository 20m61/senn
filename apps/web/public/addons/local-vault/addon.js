// SENN Local Vault add-on. Conforms to docs/addon-file-transfer-spec.md
// and docs/addon-storage-spec.md.
//
// Files are stored as base64 inside the per-add-on storage namespace.
// Nothing leaves the device — the CSP `connect-src 'none'` makes
// network access impossible for this iframe.

const KIND = "senn.addon.v1";
const KEY_PREFIX = "vault/";

const stateEl = document.getElementById("state");
const opStatus = document.getElementById("op-status");
const picker = document.getElementById("picker");
const btnAdd = document.getElementById("btn-add");
const listEl = document.getElementById("list");

let initialized = false;
const pendingRpc = new Map();
let nextRid = 0;

function rpc(req) {
  return new Promise((resolve, reject) => {
    const rid = `r_${++nextRid}`;
    pendingRpc.set(rid, { resolve, reject });
    parent.postMessage({ kind: KIND, op: "storage", rid, ...req }, "*");
  });
}

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
  const keys = await rpc({ storage: "list" });
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
    const rec = await rpc({ storage: "get", key: k });
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
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "delete";
    rm.className = "delete";
    rm.addEventListener("click", async () => {
      await rpc({ storage: "delete", key: k });
      setStatus(`deleted ${rec.name}`);
      await refreshList();
    });
    li.append(name, meta, dl, rm);
    listEl.append(li);
  }
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
    await rpc({ storage: "put", key: `${KEY_PREFIX}${file.name}`, value: rec });
    setStatus(`added ${file.name} (${bytes.byteLength} B)`);
    picker.value = "";
    await refreshList();
  } catch (err) {
    setStatus(`error: ${err.message}`);
  }
});

window.addEventListener("message", (ev) => {
  if (ev.source !== parent) return;
  const msg = ev.data;
  if (!msg || msg.kind !== KIND) return;

  switch (msg.op) {
    case "init":
      stateEl.textContent = `init (${msg.addonId} v${msg.version})`;
      initialized = true;
      // Best-effort initial render — tolerated to fail before the host's
      // first storage call resolves.
      refreshList().catch(() => undefined);
      break;
    case "storage.result": {
      const pending = pendingRpc.get(msg.rid);
      if (!pending) return;
      pendingRpc.delete(msg.rid);
      if (msg.ok) pending.resolve(msg.value);
      else pending.reject(new Error(msg.error));
      break;
    }
  }
});

parent.postMessage({ kind: KIND, op: "ready" }, "*");
stateEl.textContent = "ready";
