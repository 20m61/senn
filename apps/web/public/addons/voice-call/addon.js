// Voice Call add-on. Conforms to docs/addon-media-spec.md.
// Stage 1+2 of ADR-0015: addon asks the host to start/stop sending and
// receiving audio tracks; the addon never sees a MediaStreamTrack.

const stateEl = document.getElementById("state");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnListen = document.getElementById("btn-listen");
const btnMute = document.getElementById("btn-mute");
const trackLog = document.getElementById("track-log");

function logTrack(text) {
  const li = document.createElement("li");
  li.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  li.dataset.testid = "track-log-entry";
  trackLog.appendChild(li);
}

senn.media.onTrack(({ direction, track, state }) => {
  logTrack(`${direction} ${track} ${state}`);
  if (direction === "local" && track === "audio") {
    if (state === "added") {
      btnStart.hidden = true;
      btnStop.hidden = false;
    } else {
      btnStart.hidden = false;
      btnStop.hidden = true;
    }
  }
  if (direction === "remote" && track === "audio") {
    if (state === "added") {
      btnListen.hidden = true;
      btnMute.hidden = false;
    } else {
      btnListen.hidden = false;
      btnMute.hidden = true;
    }
  }
});

senn.on("error", (err) => {
  logTrack(`error: ${err.message}`);
});

btnStart.addEventListener("click", () => senn.media.startLocalAudio());
btnStop.addEventListener("click", () => senn.media.stopLocalAudio());
btnListen.addEventListener("click", () => senn.media.subscribeRemoteAudio());
btnMute.addEventListener("click", () => senn.media.unsubscribeRemoteAudio());

senn.ready().then((ctx) => {
  stateEl.textContent = `init (${ctx.addonId} v${ctx.version})`;
});
