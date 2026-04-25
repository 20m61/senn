// SENN Avatar Presence add-on. Conforms to docs/addon-runtime-spec.md.
//
// Sends only state (speaking flag, emotion, reaction emoji) and never
// any audio/video — that is the whole point of the add-on. Bandwidth
// stays minimal and viewers reconstruct presence locally from state.

const KIND = "senn.addon.v1";
const STATE_THROTTLE_MS = 200;

const stateEl = document.getElementById("state");
const meDot = document.getElementById("me-dot");
const peerDot = document.getElementById("peer-dot");
const meSpeakingEl = document.getElementById("me-speaking");
const meEmotionEl = document.getElementById("me-emotion");
const peerSpeakingEl = document.getElementById("peer-speaking");
const peerEmotionEl = document.getElementById("peer-emotion");
const meReactionEl = document.getElementById("me-reaction");
const peerReactionEl = document.getElementById("peer-reaction");
const btnToggleSpeaking = document.getElementById("btn-toggle-speaking");
const emotionSelect = document.getElementById("emotion-select");

let initialized = false;
let lastSent = 0;
let pendingState = null;

const me = { speaking: false, emotion: "neutral" };

function send(payload) {
  parent.postMessage({ kind: KIND, op: "send", payload }, "*");
}

function applyMe() {
  meSpeakingEl.textContent = me.speaking ? "yes" : "no";
  meEmotionEl.textContent = me.emotion;
  meDot.dataset.speaking = me.speaking ? "1" : "0";
  meDot.dataset.emotion = me.emotion;
}

function applyPeer(state) {
  if (typeof state.speaking === "boolean") {
    peerSpeakingEl.textContent = state.speaking ? "yes" : "no";
    peerDot.dataset.speaking = state.speaking ? "1" : "0";
  }
  if (typeof state.emotion === "string") {
    peerEmotionEl.textContent = state.emotion;
    peerDot.dataset.emotion = state.emotion;
  }
}

function flushState() {
  if (!pendingState) return;
  const payload = pendingState;
  pendingState = null;
  lastSent = performance.now();
  send({ type: "state", state: payload });
}

function emitStateChange() {
  applyMe();
  pendingState = { speaking: me.speaking, emotion: me.emotion };
  const now = performance.now();
  const wait = Math.max(0, STATE_THROTTLE_MS - (now - lastSent));
  if (wait === 0) flushState();
  else setTimeout(flushState, wait);
}

btnToggleSpeaking.addEventListener("click", () => {
  if (!initialized) return;
  me.speaking = !me.speaking;
  emitStateChange();
});

emotionSelect.addEventListener("change", () => {
  if (!initialized) return;
  me.emotion = emotionSelect.value;
  emitStateChange();
});

for (const btn of document.querySelectorAll(".rxn")) {
  btn.addEventListener("click", () => {
    if (!initialized) return;
    const emoji = btn.dataset.emoji;
    if (!emoji) return;
    meReactionEl.textContent = emoji;
    send({ type: "reaction", emoji });
    setTimeout(() => {
      if (meReactionEl.textContent === emoji) meReactionEl.textContent = "";
    }, 1500);
  });
}

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
      if (!msg.payload || typeof msg.payload !== "object") return;
      if (msg.payload.type === "state" && msg.payload.state) {
        applyPeer(msg.payload.state);
      } else if (msg.payload.type === "reaction" && typeof msg.payload.emoji === "string") {
        peerReactionEl.textContent = msg.payload.emoji;
        setTimeout(() => {
          if (peerReactionEl.textContent === msg.payload.emoji) peerReactionEl.textContent = "";
        }, 1500);
      }
      break;
  }
});

parent.postMessage({ kind: KIND, op: "ready" }, "*");
stateEl.textContent = "ready";
applyMe();
