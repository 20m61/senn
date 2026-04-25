/* SENN add-on SDK runtime — classic script, runs inside the add-on iframe.
 *
 * Spec: docs/addon-sdk-spec.md.  Bridge protocol: docs/addon-runtime-spec.md.
 *
 * Exposes a single global `window.senn` that wraps the postMessage bridge:
 *   - senn.ready()           — announce ready, resolve to context on init
 *   - senn.on(event, fn)     — 'init' | 'deliver' | 'deliver-bin' | 'error'
 *   - senn.peer.send(payload)
 *   - senn.peer.sendBinary({ mime, bytes })
 *   - senn.storage.{get,put,delete,list,clear}
 *
 * The SDK is optional sugar; add-ons MAY talk to the bridge directly.
 */
(() => {
  if (typeof window === "undefined" || typeof window.parent === "undefined") return;
  if (window.senn) return; // idempotent if loaded twice

  const KIND = "senn.addon.v1";
  const pendingStorage = new Map();
  let nextRid = 0;
  let context = null;
  let initResolve = null;
  const initPromise = new Promise((resolve) => {
    initResolve = resolve;
  });
  const listeners = {
    init: new Set(),
    deliver: new Set(),
    "deliver-bin": new Set(),
    error: new Set(),
  };
  const audioLevelHandlers = new Set();

  const emit = (event, value) => {
    const set = listeners[event];
    if (!set) return;
    for (const fn of set) {
      try {
        fn(value);
      } catch (err) {
        console.error("senn-addon-sdk listener threw", err);
      }
    }
  };

  const post = (msg) => {
    window.parent.postMessage(msg, "*");
  };

  const rpcStorage = (req) =>
    new Promise((resolve, reject) => {
      const rid = `r_${++nextRid}`;
      pendingStorage.set(rid, { resolve, reject });
      post({ kind: KIND, op: "storage", rid, ...req });
    });

  window.addEventListener("message", (ev) => {
    if (ev.source !== window.parent) return;
    const msg = ev.data;
    if (!msg || msg.kind !== KIND) return;
    switch (msg.op) {
      case "init": {
        context = {
          addonId: msg.addonId,
          version: msg.version,
          sessionId: msg.sessionId,
        };
        emit("init", context);
        if (initResolve) {
          initResolve(context);
          initResolve = null;
        }
        return;
      }
      case "deliver":
        emit("deliver", { payload: msg.payload, from: msg.from });
        return;
      case "deliver-bin":
        emit("deliver-bin", { mime: msg.mime, bytes: msg.bytes, from: msg.from });
        return;
      case "audio.level": {
        for (const fn of audioLevelHandlers) {
          try {
            fn(msg.level);
          } catch (err) {
            console.error("senn-addon-sdk audio handler threw", err);
          }
        }
        return;
      }
      case "error": {
        const err = new Error(`${msg.code ? `${msg.code}: ` : ""}${msg.message || "bridge error"}`);
        err.code = msg.code;
        emit("error", err);
        return;
      }
      case "storage.result": {
        const p = pendingStorage.get(msg.rid);
        if (!p) return;
        pendingStorage.delete(msg.rid);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new Error(msg.error));
        return;
      }
    }
  });

  window.senn = {
    ready: () => {
      post({ kind: KIND, op: "ready" });
      return initPromise;
    },
    on: (event, handler) => {
      const set = listeners[event];
      if (!set) throw new Error(`senn-addon-sdk: unknown event: ${event}`);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
    get context() {
      return context;
    },
    peer: {
      send: (payload) => {
        post({ kind: KIND, op: "send", payload });
      },
      sendBinary: (req) => {
        if (!req || !(req.bytes instanceof Uint8Array)) {
          throw new TypeError("senn.peer.sendBinary: bytes must be a Uint8Array");
        }
        post({
          kind: KIND,
          op: "send-bin",
          mime: String(req.mime || "application/octet-stream"),
          bytes: req.bytes,
        });
      },
    },
    storage: {
      get: (key) => rpcStorage({ storage: "get", key }),
      put: (key, value) => rpcStorage({ storage: "put", key, value }),
      delete: (key) => rpcStorage({ storage: "delete", key }),
      list: () => rpcStorage({ storage: "list" }),
      clear: () => rpcStorage({ storage: "clear" }),
    },
    audio: {
      subscribeLevel: (handler) => {
        if (typeof handler !== "function") {
          throw new TypeError("senn.audio.subscribeLevel: handler must be a function");
        }
        audioLevelHandlers.add(handler);
        if (audioLevelHandlers.size === 1) {
          post({ kind: KIND, op: "audio.level.subscribe" });
        }
        return () => {
          audioLevelHandlers.delete(handler);
          if (audioLevelHandlers.size === 0) {
            post({ kind: KIND, op: "audio.level.unsubscribe" });
          }
        };
      },
    },
  };
})();
