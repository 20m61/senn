// Voice Meter add-on. Conforms to docs/addon-audio-level-spec.md.
// Subscribes to audio.level, renders a bar + a "speaking" boolean.
// No raw audio is ever exposed inside this iframe — only [0,1] levels.

const stateEl = document.getElementById("state");
const fill = document.getElementById("meter-fill");
const valueEl = document.getElementById("meter-value");
const speakingEl = document.getElementById("speaking");

const SPEAKING_THRESHOLD = 0.05;

function render(level) {
  const pct = Math.min(100, Math.max(0, level * 100));
  fill.style.width = `${pct}%`;
  valueEl.textContent = level.toFixed(3);
  speakingEl.textContent = level >= SPEAKING_THRESHOLD ? "yes" : "no";
}

senn.on("error", (err) => {
  stateEl.textContent = `error: ${err.message}`;
});

senn.ready().then((ctx) => {
  stateEl.textContent = `init (${ctx.addonId} v${ctx.version})`;
  senn.audio.subscribeLevel(render);
});
stateEl.textContent = "ready";
