#!/usr/bin/env tsx
/**
 * Walk every add-on tree and grep its .html / .js / .ts / .mjs / .cjs files
 * for forbidden APIs. See docs/dev/writing-an-addon.md and
 * docs/dev/ai-driven-addon-development.md.
 *
 * Add-ons MUST NOT touch the network themselves; all dynamic data flow
 * crosses the trust boundary through the postMessage bridge to the host.
 *
 * Usage: pnpm check:addon-forbidden
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();

const SCAN_ROOTS: readonly string[] = [
  "addons/official",
  "addons/community",
  "examples",
  "apps/web/public/addons",
];

const FILE_EXTS: ReadonlySet<string> = new Set([".html", ".js", ".ts", ".mjs", ".cjs"]);

interface Rule {
  readonly pattern: RegExp;
  readonly reason: string;
}

const RULES: readonly Rule[] = [
  {
    // \b matches a word-boundary; we exclude "this.fetch" / "instance.fetch"
    // by requiring the preceding char to NOT be a `.`. Likewise for the others.
    pattern: /(?<![.\w])(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/g,
    reason: "add-ons MUST NOT open their own network",
  },
  {
    pattern: /(?<![.\w])navigator\.sendBeacon\s*\(/g,
    reason: "add-ons MUST NOT exfiltrate via sendBeacon",
  },
  {
    pattern: /(?<![.\w])new\s+(RTCPeerConnection|RTCDataChannel|RTCRtpSender|RTCRtpReceiver)\s*\(/g,
    reason: "add-ons MUST NOT take direct WebRTC handles; route through Core",
  },
  {
    pattern: /(?<![.\w])new\s+(MediaStream|MediaRecorder|MediaSource)\s*\(/g,
    reason: "add-ons MUST NOT construct MediaStreams / recorders; media flows through Core",
  },
  {
    pattern: /(?<![.\w])navigator\.mediaDevices\.\s*(getUserMedia|getDisplayMedia)\s*\(/g,
    reason:
      "add-ons MUST NOT call getUserMedia / getDisplayMedia; the host owns capture (ADR-0015)",
  },
  {
    pattern: /(?<![.\w])(localStorage|sessionStorage)\s*[.[]/g,
    reason: "add-ons MUST use Core's namespaced storage, not raw web storage",
  },
  {
    pattern: /(?<![.\w])indexedDB\s*\.\s*open\s*\(/g,
    reason: "add-ons MUST NOT open IndexedDB directly; use Core's storage",
  },
  {
    pattern: /(?<![.\w])eval\s*\(/g,
    reason: "no eval in add-ons",
  },
  {
    pattern: /(?<![.\w])new\s+Function\s*\(/g,
    reason: "no Function constructor in add-ons",
  },
];

interface Hit {
  readonly path: string;
  readonly line: number;
  readonly col: number;
  readonly snippet: string;
  readonly reason: string;
}

async function findAddonRoots(scanRoot: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(scanRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const candidate = join(scanRoot, entry.name);
    // An "add-on directory" is any directory containing a manifest.json.
    try {
      await readdir(candidate);
    } catch {
      continue;
    }
    const inside = await readdir(candidate);
    if (inside.includes("manifest.json")) {
      out.push(candidate);
    } else {
      // recurse one level (for examples/* nesting)
      out.push(...(await findAddonRoots(candidate)));
    }
  }
  return out;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot >= 0 && FILE_EXTS.has(entry.name.slice(dot))) out.push(full);
    }
  }
  return out;
}

function scanContents(path: string, body: string): Hit[] {
  const hits: Hit[] = [];
  const lines = body.split("\n");
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    while (true) {
      const m = rule.pattern.exec(body);
      if (m === null) break;
      const idx = m.index;
      let line = 1;
      let col = 1;
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineLen = (lines[i] ?? "").length + 1;
        if (acc + lineLen > idx) {
          line = i + 1;
          col = idx - acc + 1;
          break;
        }
        acc += lineLen;
      }
      hits.push({
        path,
        line,
        col,
        snippet: (lines[line - 1] ?? "").trim().slice(0, 120),
        reason: rule.reason,
      });
    }
  }
  return hits;
}

async function main(): Promise<void> {
  const addonRoots: string[] = [];
  for (const rel of SCAN_ROOTS) {
    addonRoots.push(...(await findAddonRoots(resolve(ROOT, rel))));
  }
  addonRoots.sort();

  if (addonRoots.length === 0) {
    console.error("check-addon-forbidden: no add-on directories found");
    process.exit(1);
  }

  const allHits: Hit[] = [];
  let filesScanned = 0;
  for (const addonDir of addonRoots) {
    const files = await listFilesRecursive(addonDir);
    filesScanned += files.length;
    for (const file of files) {
      const body = await readFile(file, "utf8");
      allHits.push(...scanContents(file, body));
    }
  }

  const display = (p: string) => relative(ROOT, p);
  if (allHits.length === 0) {
    console.log(
      `ok: scanned ${filesScanned} file(s) across ${addonRoots.length} add-on dir(s); no forbidden APIs.`,
    );
    return;
  }

  for (const hit of allHits) {
    console.error(
      `FAIL: ${display(hit.path)}:${hit.line}:${hit.col} — ${hit.reason}\n      ${hit.snippet}`,
    );
  }
  console.error("");
  console.error(`scanned ${filesScanned} file(s); ${allHits.length} forbidden API hit(s).`);
  process.exit(1);
}

void main();
