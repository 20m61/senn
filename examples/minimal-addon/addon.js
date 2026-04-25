window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  // Bridge with SENN Core via postMessage will be defined by @senn/addon-sdk.
  // This stub simply acknowledges messages for the runtime PoC.
  window.parent.postMessage({ type: "addon.ack", echo: event.data }, event.origin);
});
