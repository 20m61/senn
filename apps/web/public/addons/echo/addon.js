// Static SENN add-on: echo. Conforms to docs/addon-runtime-spec.md.
// MUST NOT touch network APIs. All cross-boundary I/O goes through
// the postMessage bridge with the host.

const KIND = "senn.addon.v1";
const stateEl = document.getElementById("state");
const logEl = document.getElementById("log");
const emitButton = document.getElementById("emit-button");
const input = document.getElementById("emit-input");
const vaultKey = document.getElementById("vault-key");
const vaultValue = document.getElementById("vault-value");
const vaultState = document.getElementById("vault-state");
const vaultSave = document.getElementById("vault-save");
const vaultLoad = document.getElementById("vault-load");
const vaultList = document.getElementById("vault-list");

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

function log(text) {
  const li = document.createElement("li");
  li.textContent = text;
  logEl.appendChild(li);
}

function send(payload) {
  parent.postMessage({ kind: KIND, op: "send", payload }, "*");
}

// Wire the button before we announce ready so the user can interact as soon
// as the bridge is up, even before init metadata arrives. We avoid <form>
// because the SENN sandbox withholds allow-forms (form submission would be
// blocked entirely by the browser, including the submit event).
emitButton.addEventListener("click", () => {
  const value = input.value.trim();
  if (!value) return;
  send({ text: value });
  log(`sent: ${value}`);
  input.value = "";
});
input.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") emitButton.click();
});

vaultSave?.addEventListener("click", async () => {
  const k = vaultKey?.value?.trim();
  const v = vaultValue?.value;
  if (!k) return;
  try {
    await rpc({ storage: "put", key: k, value: v });
    vaultState.textContent = `saved ${k}`;
  } catch (err) {
    vaultState.textContent = `error: ${err.message}`;
  }
});

vaultLoad?.addEventListener("click", async () => {
  const k = vaultKey?.value?.trim();
  if (!k) return;
  try {
    const got = await rpc({ storage: "get", key: k });
    vaultState.textContent = `loaded ${k}=${JSON.stringify(got)}`;
    if (typeof got === "string") vaultValue.value = got;
  } catch (err) {
    vaultState.textContent = `error: ${err.message}`;
  }
});

vaultList?.addEventListener("click", async () => {
  try {
    const keys = await rpc({ storage: "list" });
    vaultState.textContent = `keys=${JSON.stringify(keys)}`;
  } catch (err) {
    vaultState.textContent = `error: ${err.message}`;
  }
});

// Register the message listener BEFORE announcing ready, so we cannot miss
// the host's init message regardless of arrival order.
window.addEventListener("message", (ev) => {
  if (ev.source !== parent) return;
  const msg = ev.data;
  if (!msg || msg.kind !== KIND) return;

  switch (msg.op) {
    case "init":
      stateEl.textContent = `init (${msg.addonId} v${msg.version})`;
      initialized = true;
      break;
    case "deliver":
      log(`recv: ${JSON.stringify(msg.payload)}`);
      if (typeof msg.payload === "object" && msg.payload && msg.payload.echoed !== true) {
        send({ original: msg.payload, echoed: true, by: "echo-addon" });
      }
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

// Announce readiness — listener is wired, we will catch any init that follows.
parent.postMessage({ kind: KIND, op: "ready" }, "*");
stateEl.textContent = "ready";
