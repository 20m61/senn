/**
 * @senn/signaling-http-poll
 *
 * Tier-1 SENN signaling adapter. Posts and polls a small key/value
 * endpoint to ferry SignalingMessage payloads between peers.
 *
 * Spec: docs/signaling-http-poll-spec.md.
 */

import type {
  RoomId,
  SignalingHandler,
  SignalingMessage,
  SignalingTransport,
  Unsubscribe,
} from "@senn/protocol";

const DEFAULT_INTERVAL_MS = 1_000;
const MIN_INTERVAL_MS = 200;
const MAX_INTERVAL_MS = 60_000;

const ADAPTER_INFO = {
  id: "http-poll-v1",
  name: "HTTP poll (Tier 1)",
  requiresInfrastructure: true,
  description:
    "SENN Tier-1 adapter. Polls a tiny per-room queue endpoint at a configurable interval.",
} as const;

export class HttpPollClosedError extends Error {
  constructor() {
    super("senn: http-poll adapter closed");
    this.name = "HttpPollClosedError";
  }
}

export class HttpPollServerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`senn: http-poll endpoint returned ${status}: ${message}`);
    this.name = "HttpPollServerError";
    this.status = status;
  }
}

export interface HttpPollOptions {
  /**
   * Endpoint base URL. The adapter will issue:
   *   POST <endpoint>/<roomId>
   *   GET  <endpoint>/<roomId>?since=<cursor>
   * No trailing slash.
   */
  readonly endpoint: string;
  readonly intervalMs?: number;
  /** Override fetch (used by tests). */
  readonly fetcher?: typeof fetch;
}

interface PostResponseBody {
  readonly id: string;
  readonly cursor: string;
}

interface PollResponseBody {
  readonly messages: ReadonlyArray<{ readonly id: string; readonly message: SignalingMessage }>;
  readonly cursor: string;
}

interface RoomState {
  readonly handlers: Set<SignalingHandler>;
  readonly delivered: Set<string>; // de-dup ids
  cursor: string;
  controller: AbortController;
  task: Promise<void> | null;
}

export class HttpPollSignaling implements SignalingTransport {
  static readonly info = ADAPTER_INFO;

  private readonly endpoint: string;
  private readonly intervalMs: number;
  private readonly fetcher: typeof fetch;
  private readonly rooms = new Map<RoomId, RoomState>();
  private closed = false;

  constructor(opts: HttpPollOptions) {
    if (!opts.endpoint) {
      // The adapter is vendor-neutral by ADR-0007. Construction with no
      // endpoint MUST fail loudly — do not silently fall back.
      throw new Error("HttpPollSignaling: `endpoint` is required");
    }
    const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (interval < MIN_INTERVAL_MS || interval > MAX_INTERVAL_MS) {
      throw new Error(
        `HttpPollSignaling: intervalMs ${interval} outside allowed range [${MIN_INTERVAL_MS}, ${MAX_INTERVAL_MS}]`,
      );
    }
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.intervalMs = interval;
    this.fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async publish(roomId: RoomId, message: SignalingMessage): Promise<void> {
    if (this.closed) throw new HttpPollClosedError();
    const url = `${this.endpoint}/${encodeURIComponent(roomId)}`;
    const res = await this.fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpPollServerError(res.status, text.slice(0, 200));
    }
  }

  subscribe(roomId: RoomId, handler: SignalingHandler): Unsubscribe {
    if (this.closed) throw new HttpPollClosedError();
    let state = this.rooms.get(roomId);
    if (!state) {
      state = {
        handlers: new Set(),
        delivered: new Set(),
        cursor: "",
        controller: new AbortController(),
        task: null,
      };
      this.rooms.set(roomId, state);
      state.task = this.runPollLoop(roomId, state);
    }
    state.handlers.add(handler);
    return () => {
      const live = this.rooms.get(roomId);
      if (!live) return;
      live.handlers.delete(handler);
      if (live.handlers.size === 0) {
        live.controller.abort();
        this.rooms.delete(roomId);
      }
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const tasks: Promise<void>[] = [];
    for (const state of this.rooms.values()) {
      state.controller.abort();
      if (state.task) tasks.push(state.task.catch(() => undefined));
    }
    this.rooms.clear();
    await Promise.all(tasks);
  }

  private async runPollLoop(roomId: RoomId, state: RoomState): Promise<void> {
    while (!this.closed && !state.controller.signal.aborted) {
      try {
        await this.pollOnce(roomId, state);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Swallow transient errors; do not log message bodies. Caller-visible
        // errors come from publish() only.
      }
      if (this.closed || state.controller.signal.aborted) return;
      await this.delay(this.intervalMs, state.controller.signal);
    }
  }

  private async pollOnce(roomId: RoomId, state: RoomState): Promise<void> {
    const params = new URLSearchParams();
    if (state.cursor) params.set("since", state.cursor);
    const qs = params.toString();
    const url = `${this.endpoint}/${encodeURIComponent(roomId)}${qs ? `?${qs}` : ""}`;
    const res = await this.fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: state.controller.signal,
    });
    if (!res.ok) {
      throw new HttpPollServerError(res.status, "");
    }
    const body = (await res.json()) as PollResponseBody;
    if (!body || !Array.isArray(body.messages)) return;
    for (const item of body.messages) {
      if (!item || typeof item.id !== "string") continue;
      if (state.delivered.has(item.id)) continue;
      state.delivered.add(item.id);
      for (const handler of state.handlers) {
        try {
          handler(item.message);
        } catch (err) {
          // Per the SignalingTransport contract, swallow handler exceptions.
          console.error("senn: http-poll handler threw", err);
        }
      }
    }
    if (typeof body.cursor === "string" && body.cursor) {
      state.cursor = body.cursor;
    }
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

// Internal type re-exports for convenience in tests.
export type { PostResponseBody, PollResponseBody };
