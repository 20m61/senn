import { fileURLToPath } from "node:url";

import { type PeerId, type SignalingMessage, newPeerId, newRoomId } from "@senn/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HttpPollSignaling } from "../src/index.ts";

// Boots the reference Node server in-process and proves the adapter's
// wire behaviour against a real HTTP endpoint.
const SERVER_PATH = fileURLToPath(
  new URL("../../../examples/signaling-http-poll-server/node/server.mjs", import.meta.url),
);

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

interface ServerModule {
  startServer(opts?: { port?: number; host?: string }): Promise<ServerHandle>;
}

let handle: ServerHandle;

function offer(from: PeerId): SignalingMessage {
  return { kind: "offer", from, sdp: "v=0\r\n…" };
}

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v !== undefined && v !== null) return v as T;
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  const mod: ServerModule = await import(SERVER_PATH);
  handle = await mod.startServer({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await handle?.close();
});

describe("HttpPollSignaling against the reference Node endpoint", () => {
  it("publishes from one adapter and delivers to another over real HTTP", async () => {
    const endpoint = `${handle.url}/signal`;
    const room = newRoomId();
    const alice = newPeerId();

    const aliceTx = new HttpPollSignaling({ endpoint, intervalMs: 250 });
    const bobTx = new HttpPollSignaling({ endpoint, intervalMs: 250 });
    try {
      const inbox: SignalingMessage[] = [];
      bobTx.subscribe(room, (m) => inbox.push(m));

      await aliceTx.publish(room, offer(alice));
      const got = await waitFor(() => (inbox.length > 0 ? inbox[0] : undefined));
      expect(got).toMatchObject({ kind: "offer", from: alice });
    } finally {
      await aliceTx.close();
      await bobTx.close();
    }
  });

  it("rejects bad room ids with HttpPollServerError on publish", async () => {
    const endpoint = `${handle.url}/signal`;
    const tx = new HttpPollSignaling({ endpoint, intervalMs: 250 });
    try {
      // Cast through unknown to fabricate a string that fails the spec regex.
      const bad = "not-a-room-id" as unknown as ReturnType<typeof newRoomId>;
      await expect(tx.publish(bad, offer(newPeerId()))).rejects.toThrow(/400|bad room/i);
    } finally {
      await tx.close();
    }
  });

  it("rejects unknown signaling kinds at the endpoint", async () => {
    const endpoint = `${handle.url}/signal`;
    const tx = new HttpPollSignaling({ endpoint, intervalMs: 250 });
    try {
      const room = newRoomId();
      const bogus = { kind: "unknown", from: newPeerId() } as unknown as SignalingMessage;
      await expect(tx.publish(room, bogus)).rejects.toThrow(/400/);
    } finally {
      await tx.close();
    }
  });
});
