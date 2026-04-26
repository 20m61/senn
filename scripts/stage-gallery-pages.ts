#!/usr/bin/env tsx
/**
 * pnpm stage:gallery-pages
 *
 * Pre-stages the official publisher index + per-addon manifest pairs
 * into `apps/addon-gallery/dist/` so a GitHub Pages deploy of the
 * gallery is self-contained: the user does not have to type a URL on
 * first visit. The gallery's `defaultRegistryUrl` resolves to
 * `<origin><base>registry/official/index.json`, and `manifestUrlFor`
 * resolves manifests as a sibling of the registry directory, so this
 * script just mirrors the `apps/web/public/{registry,addons}` layout
 * into the gallery's dist.
 *
 * Run AFTER `vite build` (which writes the rest of dist/), and before
 * uploading the artifact to Pages.
 */
import { copyFile, cp, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_SRC = resolve(REPO_ROOT, "addons/official");
const ADDONS_PUBLIC = resolve(REPO_ROOT, "apps/web/public/addons");
const DIST = resolve(REPO_ROOT, "apps/addon-gallery/dist");
const REGISTRY_DEST = resolve(DIST, "registry/official");
const ADDONS_DEST = resolve(DIST, "addons");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface RegistryShape {
  readonly addons: ReadonlyArray<{ readonly path: string }>;
}

async function main(): Promise<void> {
  if (!(await exists(DIST))) {
    throw new Error(
      `${DIST} does not exist — run \`pnpm --filter @senn/addon-gallery build\` first`,
    );
  }
  await mkdir(REGISTRY_DEST, { recursive: true });
  await mkdir(ADDONS_DEST, { recursive: true });

  // Copy index.json + meta.json (meta.json is optional).
  await copyFile(resolve(REGISTRY_SRC, "index.json"), resolve(REGISTRY_DEST, "index.json"));
  console.log("copied  registry/official/index.json");
  if (await exists(resolve(REGISTRY_SRC, "meta.json"))) {
    await copyFile(resolve(REGISTRY_SRC, "meta.json"), resolve(REGISTRY_DEST, "meta.json"));
    console.log("copied  registry/official/meta.json");
  }

  // Walk the index and stage each addon's manifest.json + manifest.sig.json
  // under <dist>/addons/<basename>/. The basename matches what the gallery's
  // `manifestUrlFor` resolves at runtime.
  const indexJson = JSON.parse(
    await readFile(resolve(REGISTRY_SRC, "index.json"), "utf8"),
  ) as RegistryShape;
  for (const a of indexJson.addons) {
    const src = resolve(REPO_ROOT, a.path);
    const slug = a.path.replace(/\/+$/, "").split("/").pop();
    if (!slug) throw new Error(`addon path has no basename: ${a.path}`);
    const dest = resolve(ADDONS_DEST, slug);
    await mkdir(dest, { recursive: true });
    // Copy the entire addon directory (manifest.json, manifest.sig.json,
    // and any addon.js / static assets shipped alongside).
    await cp(src, dest, { recursive: true });
    console.log(`copied  addons/${slug}/  (from ${a.path})`);
  }

  // The web app also ships @senn/addon-sdk runtime under
  // apps/web/public/addons/senn-addon-sdk.js (referenced by addons that
  // import the runtime). Mirror it if present so addon iframes loaded
  // from the gallery deploy can find it at <base>addons/senn-addon-sdk.js.
  const sdkSrc = resolve(ADDONS_PUBLIC, "senn-addon-sdk.js");
  if (await exists(sdkSrc)) {
    await copyFile(sdkSrc, resolve(ADDONS_DEST, "senn-addon-sdk.js"));
    console.log("copied  addons/senn-addon-sdk.js");
  }
}

main().catch((err) => {
  console.error(`stage-gallery-pages: ${(err as Error).message}`);
  process.exit(1);
});
