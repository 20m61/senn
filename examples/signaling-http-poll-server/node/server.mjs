#!/usr/bin/env node
/**
 * SENN Tier-1 signaling endpoint — Node reference.
 *
 * Wire contract: docs/signaling-http-poll-spec.md.
 *
 * Storage: in-memory Map<roomId, Array<{ id, ts, message }>>.
 * TTL: 60 seconds, swept lazily on every read/write.
 *
 * Usage:
 *   node server.mjs --port 8787 [--host 127.0.0.1]
 *
 * Programmatic (used by the adapter's integration test):
 *   import { startServer } from "./server.mjs";
 *   const { url, close } = await startServer({ port: 0 });
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const ROOM_ID_RE = /^[0-9a-hjkmnp-tv-z]{26}$/;
const KNOWN_KINDS = new Set(["offer", "answer", "ice", "bye"]);
const TTL_MS = 60_000;
const MAX_BODY = 16 * 1024;

function nextId() {
  return `m_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json");
}

function send(res, status, body) {
  setCors(res);
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > MAX_BODY) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function pruneTtl(items) {
  const cutoff = Date.now() - TTL_MS;
  return items.filter((it) => it.ts >= cutoff);
}

export function startServer({ port = 0, host = "127.0.0.1" } = {}) {
  const queues = new Map();

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      setCors(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const segments = url.pathname.split("/").filter(Boolean);
    const roomId = segments[segments.length - 1];
    if (!roomId || !ROOM_ID_RE.test(roomId)) {
      send(res, 400, { error: "bad room id" });
      return;
    }

    if (req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "invalid JSON" });
        return;
      }
      const kind = body?.message?.kind;
      if (!kind || !KNOWN_KINDS.has(kind)) {
        send(res, 400, { error: "unknown kind" });
        return;
      }
      const items = pruneTtl(queues.get(roomId) ?? []);
      const id = nextId();
      items.push({ id, ts: Date.now(), message: body.message });
      queues.set(roomId, items);
      send(res, 200, { id, cursor: id });
      return;
    }

    if (req.method === "GET") {
      const since = url.searchParams.get("since") ?? "";
      let items = pruneTtl(queues.get(roomId) ?? []);
      if (since) {
        const idx = items.findIndex((it) => it.id === since);
        if (idx >= 0) items = items.slice(idx + 1);
      }
      queues.set(roomId, items);
      const cursor = items.length === 0 ? since : items[items.length - 1].id;
      send(res, 200, {
        messages: items.map((it) => ({ id: it.id, message: it.message })),
        cursor,
      });
      return;
    }

    send(res, 405, { error: "method not allowed" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        url: `http://${host}:${actualPort}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// CLI entry. Detect via import.meta.url vs argv[1].
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf("--port");
  const hostIdx = args.indexOf("--host");
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 8787;
  const host = hostIdx >= 0 ? args[hostIdx + 1] : "127.0.0.1";
  startServer({ port, host }).then(({ url }) => {
    console.log(`senn signaling endpoint listening on ${url}/signal/<roomId>`);
  });
}
