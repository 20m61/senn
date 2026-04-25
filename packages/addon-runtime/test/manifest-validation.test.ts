import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AddonHost, AddonValidationError } from "../src/index.ts";

const VALID_MANIFEST = {
  id: "dev.senn.test",
  name: "Test",
  version: "0.0.1",
  entry: "index.html",
  license: "Apache-2.0",
  network: false,
  permissions: ["ui.panel"],
  capabilities: ["test-v1"],
};

function fakeFetcher(
  manifestBytes: Uint8Array,
  sigStatus: "missing" | "ok" = "missing",
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/manifest.json")) {
      return new Response(new Blob([manifestBytes as BlobPart]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/manifest.sig.json")) {
      return new Response("", { status: sigStatus === "missing" ? 404 : 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

describe("@senn/addon-runtime — manifest validation", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  function manifestBytes(overrides: Partial<typeof VALID_MANIFEST> = {}): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ ...VALID_MANIFEST, ...overrides }));
  }

  it("loads a valid manifest", async () => {
    const host = await AddonHost.load({
      manifestUrl: "https://example.test/addons/test/manifest.json",
      container,
      fetcher: fakeFetcher(manifestBytes()),
    });
    expect(host.manifest.id).toBe("dev.senn.test");
    expect(host.manifest.version).toBe("0.0.1");
    expect(host.manifest.permissions).toEqual(["ui.panel"]);
    await host.close();
  });

  it("rejects a manifest whose id is not reverse-DNS", async () => {
    await expect(
      AddonHost.load({
        manifestUrl: "https://example.test/addons/test/manifest.json",
        container,
        fetcher: fakeFetcher(manifestBytes({ id: "not-rdn" })),
      }),
    ).rejects.toThrow(AddonValidationError);
  });

  it("rejects a manifest whose version is not SemVer", async () => {
    await expect(
      AddonHost.load({
        manifestUrl: "https://example.test/addons/test/manifest.json",
        container,
        fetcher: fakeFetcher(manifestBytes({ version: "v0.1" })),
      }),
    ).rejects.toThrow(/version must be SemVer/);
  });

  it("rejects a manifest with an unknown permission", async () => {
    await expect(
      AddonHost.load({
        manifestUrl: "https://example.test/addons/test/manifest.json",
        container,
        fetcher: fakeFetcher(manifestBytes({ permissions: ["unknown.permission"] })),
      }),
    ).rejects.toThrow(/unknown permission/);
  });

  it("rejects a manifest with network !== false", async () => {
    await expect(
      AddonHost.load({
        manifestUrl: "https://example.test/addons/test/manifest.json",
        container,
        fetcher: fakeFetcher(manifestBytes({ network: true as unknown as false })),
      }),
    ).rejects.toThrow(/network must be false/);
  });

  it("accepts the new binary peer permissions", async () => {
    const host = await AddonHost.load({
      manifestUrl: "https://example.test/addons/test/manifest.json",
      container,
      fetcher: fakeFetcher(
        manifestBytes({ permissions: ["ui.panel", "peer.send.bin", "peer.receive.bin"] }),
      ),
    });
    expect(host.manifest.permissions).toContain("peer.send.bin");
    expect(host.manifest.permissions).toContain("peer.receive.bin");
    await host.close();
  });

  it("verify mode 'required' demands trustedKeys", async () => {
    await expect(
      AddonHost.load({
        manifestUrl: "https://example.test/addons/test/manifest.json",
        container,
        fetcher: fakeFetcher(manifestBytes()),
        verify: { mode: "required" },
      }),
    ).rejects.toThrow(/trustedKeys is required/);
  });

  it("verify mode 'required' rejects when sig is absent (404)", async () => {
    await expect(
      AddonHost.load({
        manifestUrl: "https://example.test/addons/test/manifest.json",
        container,
        fetcher: fakeFetcher(manifestBytes(), "missing"),
        verify: { mode: "required", trustedKeys: new Set(["dummy"]) },
      }),
    ).rejects.toThrow(/required signature missing/);
  });

  it("verify mode 'optional' accepts when sig is absent (404)", async () => {
    const host = await AddonHost.load({
      manifestUrl: "https://example.test/addons/test/manifest.json",
      container,
      fetcher: fakeFetcher(manifestBytes(), "missing"),
      verify: { mode: "optional", trustedKeys: new Set(["dummy"]) },
    });
    expect(host.manifest.id).toBe("dev.senn.test");
    await host.close();
  });

  it("adds allow-downloads to the iframe sandbox iff manifest declares file.write.user_approved", async () => {
    const without = await AddonHost.load({
      manifestUrl: "https://example.test/addons/a/manifest.json",
      container,
      fetcher: fakeFetcher(manifestBytes()),
    });
    const iframeA = container.querySelector("iframe");
    expect(iframeA?.sandbox.contains("allow-scripts")).toBe(true);
    expect(iframeA?.sandbox.contains("allow-downloads")).toBe(false);
    expect(iframeA?.sandbox.contains("allow-same-origin")).toBe(false);
    await without.close();

    const with_ = await AddonHost.load({
      manifestUrl: "https://example.test/addons/b/manifest.json",
      container,
      fetcher: fakeFetcher(
        manifestBytes({
          permissions: ["ui.panel", "file.write.user_approved"],
        }),
      ),
    });
    const iframeB = container.querySelector("iframe");
    expect(iframeB?.sandbox.contains("allow-scripts")).toBe(true);
    expect(iframeB?.sandbox.contains("allow-downloads")).toBe(true);
    expect(iframeB?.sandbox.contains("allow-same-origin")).toBe(false);
    await with_.close();
  });
});
