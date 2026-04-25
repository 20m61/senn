import { InMemoryStorageBackend, type StorageBackend } from "@senn/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADDON_BRIDGE_KIND, AddonHost } from "../src/index.ts";

const VALID_MANIFEST = {
  id: "dev.senn.test",
  name: "Test",
  version: "0.0.1",
  entry: "index.html",
  license: "Apache-2.0",
  network: false,
  permissions: [
    "ui.panel",
    "peer.send",
    "peer.send.bin",
    "peer.receive.bin",
    "storage.local.read",
    "storage.local.write",
  ],
  capabilities: ["test-v1"],
};

function makeFetcher(manifest: object): typeof fetch {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/manifest.json")) {
      return new Response(new Blob([bytes as BlobPart]), { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

interface FakePeerLink {
  textSent: string[];
  binarySent: { addon: string; mime: string; bytes: Uint8Array }[];
  textHandler: ((s: string) => void) | null;
  binaryHandler: ((m: { addon: string; mime: string; bytes: Uint8Array }) => void) | null;
  on(event: "text", handler: (s: string) => void): () => void;
  on(
    event: "binary",
    handler: (m: { addon: string; mime: string; bytes: Uint8Array }) => void,
  ): () => void;
  sendText(message: string): Promise<void>;
  sendBinary(msg: { addon: string; mime: string; bytes: Uint8Array }): Promise<void>;
}

function makeFakePeerLink(): FakePeerLink {
  const link = {
    textSent: [] as string[],
    binarySent: [] as { addon: string; mime: string; bytes: Uint8Array }[],
    textHandler: null as ((s: string) => void) | null,
    binaryHandler: null as ((m: { addon: string; mime: string; bytes: Uint8Array }) => void) | null,
    on(event: string, handler: unknown) {
      if (event === "text") link.textHandler = handler as (s: string) => void;
      if (event === "binary")
        link.binaryHandler = handler as (m: {
          addon: string;
          mime: string;
          bytes: Uint8Array;
        }) => void;
      return () => {
        if (event === "text") link.textHandler = null;
        if (event === "binary") link.binaryHandler = null;
      };
    },
    async sendText(message: string) {
      link.textSent.push(message);
    },
    async sendBinary(msg: { addon: string; mime: string; bytes: Uint8Array }) {
      link.binarySent.push(msg);
    },
  };
  return link as FakePeerLink;
}

/**
 * happy-dom's iframe contentWindow is a real Window stub. We trigger
 * AddonHost's window-level message handler by dispatching a MessageEvent
 * with `source` set to the iframe's contentWindow — the same shape the
 * browser delivers when the iframe posts to its parent.
 */
function postFromIframe(host: AddonHost, container: HTMLElement, data: unknown): void {
  const iframe = container.querySelector("iframe");
  if (!iframe || !iframe.contentWindow) throw new Error("no iframe");
  const ev = new MessageEvent("message", { data, source: iframe.contentWindow as Window });
  globalThis.dispatchEvent(ev);
  void host;
}

/** Drain microtasks between sends so promise chains in the host run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/**
 * Capture the next host → iframe postMessage by patching iframe.contentWindow.postMessage.
 * happy-dom does not necessarily fire 'message' on a window when its own
 * postMessage is invoked, so we intercept directly. Restored on capture.
 */
function captureNextReply(container: HTMLElement): Promise<unknown> {
  const iframe = container.querySelector("iframe") as HTMLIFrameElement;
  if (!iframe?.contentWindow) throw new Error("no iframe");
  const win = iframe.contentWindow as Window;
  const original = win.postMessage.bind(win);
  return new Promise((resolve) => {
    win.postMessage = ((data: unknown) => {
      win.postMessage = original;
      resolve(data);
    }) as typeof win.postMessage;
  });
}

describe("@senn/addon-runtime — bridge ops", () => {
  let container: HTMLElement;
  let storage: StorageBackend;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    storage = new InMemoryStorageBackend();
  });

  afterEach(() => {
    container.remove();
  });

  async function loadHost(
    overrides: Partial<typeof VALID_MANIFEST> = {},
    extra: { peerLink?: FakePeerLink } = {},
  ): Promise<{ host: AddonHost }> {
    const host = await AddonHost.load({
      manifestUrl: "https://example.test/addons/test/manifest.json",
      container,
      fetcher: makeFetcher({ ...VALID_MANIFEST, ...overrides }),
      storage,
      ...(extra.peerLink ? { session: extra.peerLink as never } : {}),
    });
    return { host };
  }

  it("send-bin without peer.send.bin permission emits a permission-denied error to the iframe", async () => {
    const { host } = await loadHost({ permissions: ["ui.panel"] });
    const replyP = captureNextReply(container);
    postFromIframe(host, container, {
      kind: ADDON_BRIDGE_KIND,
      op: "send-bin",
      mime: "text/plain",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const reply = (await replyP) as { kind: string; op: string; code?: string };
    expect(reply.kind).toBe(ADDON_BRIDGE_KIND);
    expect(reply.op).toBe("error");
    expect(reply.code).toBe("permission-denied");
    await host.close();
  });

  it("send-bin with too-large body emits payload-too-large", async () => {
    const link = makeFakePeerLink();
    const { host } = await loadHost(undefined, { peerLink: link });
    const replyP = captureNextReply(container);
    const big = new Uint8Array(4 * 1024 * 1024 + 1); // > ADDON_BIN_MAX_BYTES (4 MiB)
    postFromIframe(host, container, {
      kind: ADDON_BRIDGE_KIND,
      op: "send-bin",
      mime: "application/octet-stream",
      bytes: big,
    });
    const reply = (await replyP) as { code?: string };
    expect(reply.code).toBe("payload-too-large");
    expect(link.binarySent.length).toBe(0);
    await host.close();
  });

  it("send-bin with bad payload (non-Uint8Array) emits bad-payload", async () => {
    const link = makeFakePeerLink();
    const { host } = await loadHost(undefined, { peerLink: link });
    const replyP = captureNextReply(container);
    postFromIframe(host, container, {
      kind: ADDON_BRIDGE_KIND,
      op: "send-bin",
      mime: "text/plain",
      bytes: "not-bytes" as unknown as Uint8Array,
    });
    const reply = (await replyP) as { code?: string };
    expect(reply.code).toBe("bad-payload");
    expect(link.binarySent.length).toBe(0);
    await host.close();
  });

  it("send-bin without a peer link emits not-connected", async () => {
    const { host } = await loadHost(); // no session
    const replyP = captureNextReply(container);
    postFromIframe(host, container, {
      kind: ADDON_BRIDGE_KIND,
      op: "send-bin",
      mime: "text/plain",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const reply = (await replyP) as { code?: string };
    expect(reply.code).toBe("not-connected");
    await host.close();
  });

  it("send-bin with permission + peer link forwards bytes to PeerSession", async () => {
    const link = makeFakePeerLink();
    const { host } = await loadHost(undefined, { peerLink: link });
    postFromIframe(host, container, {
      kind: ADDON_BRIDGE_KIND,
      op: "send-bin",
      mime: "text/plain",
      bytes: new Uint8Array([7, 8, 9]),
    });
    await flush();
    expect(link.binarySent).toHaveLength(1);
    expect(link.binarySent[0]).toMatchObject({
      addon: "dev.senn.test",
      mime: "text/plain",
    });
    expect(Array.from(link.binarySent[0]?.bytes ?? [])).toEqual([7, 8, 9]);
    await host.close();
  });

  it("storage put/get round-trip via bridge", async () => {
    const { host } = await loadHost();
    // put
    const putReplyP = captureNextReply(container);
    postFromIframe(host, container, {
      kind: ADDON_BRIDGE_KIND,
      op: "storage",
      rid: "r1",
      storage: "put",
      key: "hello",
      value: { n: 42 },
    });
    const putReply = (await putReplyP) as { rid: string; ok: boolean };
    expect(putReply).toMatchObject({ rid: "r1", ok: true });

    // get
    const getReplyP = captureNextReply(container);
    postFromIframe(host, container, {
      kind: ADDON_BRIDGE_KIND,
      op: "storage",
      rid: "r2",
      storage: "get",
      key: "hello",
    });
    const getReply = (await getReplyP) as { rid: string; ok: boolean; value: unknown };
    expect(getReply).toMatchObject({ rid: "r2", ok: true });
    expect(getReply.value).toEqual({ n: 42 });
    await host.close();
  });

  it("storage write without storage.local.write permission rejects", async () => {
    const { host } = await loadHost({ permissions: ["ui.panel", "storage.local.read"] });
    const replyP = captureNextReply(container);
    postFromIframe(host, container, {
      kind: ADDON_BRIDGE_KIND,
      op: "storage",
      rid: "rw",
      storage: "put",
      key: "k",
      value: "v",
    });
    const reply = (await replyP) as { ok: boolean; error?: string };
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe("permission-denied");
    await host.close();
  });
});
