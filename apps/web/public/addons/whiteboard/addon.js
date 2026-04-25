// SENN Whiteboard add-on. Conforms to docs/addon-runtime-spec.md
// and docs/addon-storage-spec.md.
//
// Strokes flow peer-to-peer via the host's bridge — the add-on never
// touches the network itself. Snapshots persist to per-add-on local
// storage via the same bridge.

const KIND = "senn.addon.v1";
const SNAPSHOT_KEY = "snapshot";
const STROKE_THROTTLE_MS = 16; // ~60 Hz cap, per docs/lightweight-data-strategy.md

const stateEl = document.getElementById("state");
const ownCountEl = document.getElementById("own-strokes");
const peerCountEl = document.getElementById("peer-strokes");
const vaultStateEl = document.getElementById("vault-state");
const board = document.getElementById("board");
const ctx = board.getContext("2d");
const btnDemo = document.getElementById("btn-demo");
const btnClear = document.getElementById("btn-clear");
const btnSave = document.getElementById("btn-save");
const btnLoad = document.getElementById("btn-load");

ctx.lineCap = "round";
ctx.lineJoin = "round";

const state = {
  initialized: false,
  ownCount: 0,
  peerCount: 0,
  strokes: [], // local copy for snapshot save
};

const pendingRpc = new Map();
let nextRid = 0;

function rpc(req) {
  return new Promise((resolve, reject) => {
    const rid = `r_${++nextRid}`;
    pendingRpc.set(rid, { resolve, reject });
    parent.postMessage({ kind: KIND, op: "storage", rid, ...req }, "*");
  });
}

function send(payload) {
  parent.postMessage({ kind: KIND, op: "send", payload }, "*");
}

function drawSegment(seg, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = seg.w ?? 2;
  ctx.beginPath();
  ctx.moveTo(seg.x1, seg.y1);
  ctx.lineTo(seg.x2, seg.y2);
  ctx.stroke();
}

function emitOwn(seg) {
  state.strokes.push(seg);
  state.ownCount++;
  ownCountEl.textContent = String(state.ownCount);
  drawSegment(seg, "#1a73e8");
  send({ type: "stroke", segment: seg });
}

function applyPeer(seg) {
  state.strokes.push(seg);
  state.peerCount++;
  peerCountEl.textContent = String(state.peerCount);
  drawSegment(seg, "#188038");
}

// Demo button — deterministic stroke for testing and onboarding.
btnDemo.addEventListener("click", () => {
  if (!state.initialized) return;
  emitOwn({ x1: 20, y1: 20, x2: 280, y2: 140, w: 3 });
});

btnClear.addEventListener("click", () => {
  ctx.clearRect(0, 0, board.width, board.height);
  state.strokes = [];
  state.ownCount = 0;
  state.peerCount = 0;
  ownCountEl.textContent = "0";
  peerCountEl.textContent = "0";
});

btnSave.addEventListener("click", async () => {
  try {
    await rpc({ storage: "put", key: SNAPSHOT_KEY, value: { strokes: state.strokes } });
    vaultStateEl.textContent = `saved ${state.strokes.length} strokes`;
  } catch (err) {
    vaultStateEl.textContent = `error: ${err.message}`;
  }
});

btnLoad.addEventListener("click", async () => {
  try {
    const snap = await rpc({ storage: "get", key: SNAPSHOT_KEY });
    if (!snap || !Array.isArray(snap.strokes)) {
      vaultStateEl.textContent = "no snapshot";
      return;
    }
    ctx.clearRect(0, 0, board.width, board.height);
    state.strokes = [...snap.strokes];
    state.ownCount = snap.strokes.length;
    state.peerCount = 0;
    ownCountEl.textContent = String(state.ownCount);
    peerCountEl.textContent = "0";
    for (const seg of snap.strokes) drawSegment(seg, "#1a73e8");
    vaultStateEl.textContent = `loaded ${snap.strokes.length} strokes`;
  } catch (err) {
    vaultStateEl.textContent = `error: ${err.message}`;
  }
});

// Pointer drawing — throttled to STROKE_THROTTLE_MS.
let drawing = false;
let lastPoint = null;
let lastEmit = 0;

function pointerXY(ev) {
  const rect = board.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

board.addEventListener("pointerdown", (ev) => {
  drawing = true;
  lastPoint = pointerXY(ev);
  board.setPointerCapture(ev.pointerId);
});

board.addEventListener("pointermove", (ev) => {
  if (!drawing || !lastPoint) return;
  const now = performance.now();
  if (now - lastEmit < STROKE_THROTTLE_MS) return;
  lastEmit = now;
  const next = pointerXY(ev);
  emitOwn({ x1: lastPoint.x, y1: lastPoint.y, x2: next.x, y2: next.y, w: 2 });
  lastPoint = next;
});

function endDrawing() {
  drawing = false;
  lastPoint = null;
}

board.addEventListener("pointerup", endDrawing);
board.addEventListener("pointercancel", endDrawing);
board.addEventListener("pointerleave", endDrawing);

// Bridge listener — must be registered before announcing ready.
window.addEventListener("message", (ev) => {
  if (ev.source !== parent) return;
  const msg = ev.data;
  if (!msg || msg.kind !== KIND) return;

  switch (msg.op) {
    case "init":
      stateEl.textContent = `init (${msg.addonId} v${msg.version})`;
      state.initialized = true;
      break;
    case "deliver":
      if (
        msg.payload &&
        typeof msg.payload === "object" &&
        msg.payload.type === "stroke" &&
        msg.payload.segment
      ) {
        applyPeer(msg.payload.segment);
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

parent.postMessage({ kind: KIND, op: "ready" }, "*");
stateEl.textContent = "ready";
