// Static SENN add-on: echo. Conforms to docs/addon-runtime-spec.md.
// Uses @senn/addon-sdk's window.senn — no postMessage plumbing here.

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

function log(text) {
  const li = document.createElement("li");
  li.textContent = text;
  logEl.appendChild(li);
}

emitButton.addEventListener("click", () => {
  const value = input.value.trim();
  if (!value) return;
  senn.peer.send({ text: value });
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
    await senn.storage.put(k, v);
    vaultState.textContent = `saved ${k}`;
  } catch (err) {
    vaultState.textContent = `error: ${err.message}`;
  }
});

vaultLoad?.addEventListener("click", async () => {
  const k = vaultKey?.value?.trim();
  if (!k) return;
  try {
    const got = await senn.storage.get(k);
    vaultState.textContent = `loaded ${k}=${JSON.stringify(got)}`;
    if (typeof got === "string") vaultValue.value = got;
  } catch (err) {
    vaultState.textContent = `error: ${err.message}`;
  }
});

vaultList?.addEventListener("click", async () => {
  try {
    const keys = await senn.storage.list();
    vaultState.textContent = `keys=${JSON.stringify(keys)}`;
  } catch (err) {
    vaultState.textContent = `error: ${err.message}`;
  }
});

senn.on("deliver", ({ payload }) => {
  log(`recv: ${JSON.stringify(payload)}`);
  if (typeof payload === "object" && payload && payload.echoed !== true) {
    senn.peer.send({ original: payload, echoed: true, by: "echo-addon" });
  }
});

senn.ready().then((ctx) => {
  stateEl.textContent = `init (${ctx.addonId} v${ctx.version})`;
});
stateEl.textContent = "ready";
