# ADR 0022: Local-first publish pipeline (no dependency on GitHub Actions or any CI vendor)

## Status

**Implemented** (2026-04-30). First publish via this flow:
`@sennjs/addon-sdk@0.1.0` (tag `addon-sdk-v0.1.0`, commit 295c87b,
published 2026-04-30T00:16:19Z). The script gate sequence (working-tree
clean → tag/HEAD/version equality → `private:false` → `pnpm install`
→ `pnpm conformance` → `pnpm pack` non-empty → operator confirm →
`pnpm publish --tag latest --access public --no-git-checks`) ran end-
to-end without operator intervention beyond the single `[y/N]` prompt.

Originally Accepted 2026-04-27. Supersedes ADR-0019 §5 (release flow).
The remainder of ADR-0019 — publishable scope, npm scope (amended
2026-04-30; see ADR-0019 §2 amendment), SemVer policy, runtime-
signing decision, and the §6 regression guards — stays authoritative.
The **tooling** landed in the same commit set as this ADR
(2026-04-27): `scripts/publish-addon-sdk.sh`, `pnpm release:addon-sdk`
script entry, removal of `.github/workflows/`, removal of
`publishConfig.provenance` from `packages/addon-sdk/package.json`, and
the renamed `scripts/stage-gallery-static.ts`. The **first publish via
that flow** landed three days later — see the Implemented header
above.

> **Scope rename note (2026-04-30):** wherever this ADR refers to the
> SDK as `@senn/addon-sdk`, the published npm name is now
> `@sennjs/addon-sdk` per [ADR-0019 §2 amendment](0019-publish-pipeline.md).
> The release script and tag namespace (`addon-sdk-v<semver>`) are
> unchanged; only the npm scope flipped.

## Context

ADR-0021 established that the **conformance** contract is local: the
project does not depend on GitHub Actions to certify that a branch is
green. That ADR retained `.github/workflows/publish-addon-sdk.yml` as
an "OPTIONAL mirror" because the publish flow ADR-0019 §5 still named
GitHub Actions explicitly (`id-token: write` for npm provenance,
`secrets.NPM_TOKEN`, `actions/checkout@v4`, etc.).

ADR-0021's mirror clause is structurally inconsistent with the rest of
the project's vendor-neutral stance:

- **ADR-0007** prohibits hardcoded dependencies on a single signaling /
  TURN vendor.
- **ADR-0021** prohibits a hardcoded dependency on a single CI vendor
  for *correctness*.
- The publish flow, however, was the one remaining surface that named
  GitHub Actions as a required runner: a fork that cannot enable
  Actions (billing lock, exhausted minutes, org-level restrictions, a
  network that cannot reach the GitHub API, or a self-hosted forge
  other than GitHub) cannot release `@senn/addon-sdk` without writing
  its own publish flow from scratch. That contradicts the same
  principle ADR-0021 set out to establish.

The repository also previously contained
`apps/addon-gallery`-related deploy guidance that named GitHub Pages
as the canonical static host. While Pages was always *one* possible
host, naming it in code comments and ADR text suggested a soft
dependency. Both this ADR and the cleanup that lands with it remove
that wording.

The maintainer cost of the Actions-based publish flow was also higher
than its benefit:

- npm provenance is the only Actions-specific feature it gained. As
  ADR-0019 §4 already notes, the runtime ALSO ships byte-equally inside
  every official add-on directory and is covered there by
  ADR-0008 manifest signing — which is the trust surface SENN actually
  ships, since manifest signatures are vendor-neutral by construction.
- The `NPM_TOKEN` secret on the repository created a new credential to
  manage and rotate, with no offsetting increase in trust beyond what
  the maintainer's npm 2FA-protected account already provides.

## Decision

The publish flow for `@senn/addon-sdk` (and any future publishable
package per ADR-0019 §1) MUST be runnable from a maintainer machine
with no CI vendor in the loop.

Specifically:

1. **`.github/workflows/` and any equivalent CI vendor configuration
   MUST NOT be committed to the canonical repository.** Both
   `conformance.yml` and `publish-addon-sdk.yml` are removed by the
   commit that lands this ADR.

2. **`scripts/publish-addon-sdk.sh`** is the single source of truth for
   the publish sequence. `pnpm release:addon-sdk <tag> [<dist-tag>]`
   invokes it. The script:
   1. refuses to run if the working tree is dirty,
   2. refuses to run if `HEAD` is not on the named tag (`addon-sdk-v<semver>`),
   3. asserts `packages/addon-sdk/package.json#version` equals the
      tag's version suffix,
   4. asserts the `private:true` flip (per ADR-0019 §6) is in place,
   5. runs `pnpm install --frozen-lockfile` followed by
      `pnpm conformance` (the same gate ADR-0021 names — no separate
      "publish-only" sequence),
   6. runs `pnpm pack` and asserts the resulting tarball is non-empty,
   7. prints the resolved package name + version + dist-tag + npm user
      and pauses for a `[y/N]` confirmation,
   8. runs `pnpm publish --tag <dist-tag> --access public --no-git-checks`,
   9. on success, prints the next step (`git push origin <tag>`).

3. **Tag annotation is the integrity surface.** The annotated tag MUST
   be created from a maintainer machine; `git tag -v` MUST verify
   against the maintainer's signed commit history. The publish script
   refuses to publish from a non-tag `HEAD`, so the tag is the
   non-bypassable handoff between "code review on `main`" and "tarball
   on npm."

4. **No npm provenance.** `publishConfig.provenance` MUST NOT be set
   in `packages/addon-sdk/package.json`. ADR-0019 §4 already chose to
   rely on ADR-0008 manifest signatures for the runtime's
   in-application integrity surface; this ADR extends the same logic
   to the npm tarball: trust the maintainer's release signature and
   the manifest signature, not an OIDC attestation chain that requires
   a CI runner. A future ADR MAY re-introduce provenance via a
   vendor-neutral mechanism (e.g., Sigstore via `cosign sign-blob`
   from the maintainer machine), but is out of scope here.

5. **Dist-tag policy** matches ADR-0019 §3:
   - `latest` for stable releases (default in
     `pnpm release:addon-sdk <tag>`).
   - `next` for pre-releases (`0.x.y-rc.N`); the script accepts the
     dist-tag as its second argument
     (`pnpm release:addon-sdk addon-sdk-v0.2.0-rc.1 next`).

6. **No new credentials in the repository.** The publish operator's npm
   2FA-protected account, with its own `~/.npmrc`, is the only
   credential surface. The repo MUST NOT carry an `NPM_TOKEN` secret.

7. **No GitHub Pages dependency in the gallery deploy path.**
   `scripts/stage-gallery-pages.ts` is renamed to
   `scripts/stage-gallery-static.ts`; the script content is host-
   neutral (it produces a self-contained `dist/` directory). The
   `GALLERY_BASE` env var stays — it generalises to *any* static host
   that serves under a subpath — but every code comment naming Pages is
   removed. The gallery's `npm`-script entry becomes
   `pnpm stage:gallery-static`.

## Rationale

- **Why move publish to a local script:** consistency with ADR-0021.
  If correctness is local, releases SHOULD be local too; otherwise a
  fork that cannot enable Actions can be conformant but cannot ship.
  A bash script with the same gates is portable to any forge or no
  forge at all.
- **Why drop npm provenance:** provenance attests "this tarball came
  from this CI workflow run." SENN already ships a stronger,
  vendor-neutral integrity surface for the runtime via ADR-0008
  manifest signatures (the runtime byte-equality is guarded by
  `pnpm verify:addon-sdk`). Adding provenance would re-introduce a CI
  vendor as a *trust* dependency, not just a build dependency, in
  exchange for redundant integrity. The maintainer-signed annotated
  tag is the substitute claim.
- **Why an interactive `[y/N]` confirmation:** a publish is the only
  step in the SENN flow that produces an irreversible external side
  effect (npm tarballs cannot be unpublished after 72 hours). Forcing
  one human-acknowledged moment before invoking `pnpm publish` is the
  cheapest defence against tag-shaped thinkos.
- **Why rename the gallery staging script:** "Pages" in the script name
  and comments was a soft vendor naming that contradicted ADR-0007 in
  spirit. The script body was always host-neutral (it just lays out
  files); the rename matches the body to its intent.
- **Why keep `pnpm conformance` as the gate the publish script invokes:**
  ADR-0021 already enumerates every check that defines "shippable."
  Re-running the same gate inside the publish script means there is
  exactly one definition of "green," and a stale checkout cannot
  silently publish.

## Consequences

### Positive

- Forks, including those on self-hosted forges or with no CI vendor
  enabled, can run the same publish flow as the canonical repo.
- One credential surface (the maintainer's npm 2FA-protected account)
  instead of two (npm account + repo `NPM_TOKEN` secret).
- The repo no longer ships YAML that names a single CI vendor; the
  Actions-specific permissions/OIDC concepts no longer leak into the
  spec corpus.
- The publish script's gates run inside `pnpm conformance`, so a
  publish from an old checkout fails fast — no path through which the
  CI mirror was green but the local checkout was not.

### Negative / accepted costs

- **No npm provenance.** Downstreams cannot consult a Sigstore
  transparency log to attest the tarball came from a specific git ref.
  Mitigation: ADR-0008 manifest signatures cover the runtime in
  application use; the maintainer-signed annotated tag covers the
  release identity; a future vendor-neutral provenance mechanism is
  not precluded.
- **One extra confirmation step in the publish flow.** Deliberate;
  see Rationale.
- **The maintainer must have a machine capable of running
  `pnpm conformance` + `npm publish`.** This is the same machine
  contributors already use; adds no new prerequisite.

### Out of scope

- A vendor-neutral provenance / attestation mechanism (e.g.,
  maintainer-signed Sigstore blobs). MAY be revisited if downstream
  demand is concrete.
- Republishing prior versions with annotated-tag attestations. Each
  past release stands on the integrity surface in force at its time.
- Republishing or re-deploying the gallery from a different host. The
  `dist/` produced by `pnpm build` + `pnpm stage:gallery-static` is
  the single deliverable; the choice of host is operator-local.

## Implementation pointers

- `scripts/publish-addon-sdk.sh` (new): the publish script described
  in §2. Executable bit set; depends only on `bash`, `git`, `node`,
  `pnpm`, and the `npm` CLI.
- `package.json` (root): add the `release:addon-sdk` script that
  invokes `bash scripts/publish-addon-sdk.sh`. Rename
  `stage:gallery-pages` to `stage:gallery-static`.
- `scripts/stage-gallery-static.ts` (renamed from
  `scripts/stage-gallery-pages.ts`): same code, host-neutral comments
  and error prefix.
- `apps/addon-gallery/vite.config.ts`: drop the GitHub Pages comment
  while keeping `GALLERY_BASE` as the generic subpath hook.
- `apps/addon-gallery/src/main.ts`: drop the two GitHub-Pages
  references in `defaultRegistryUrl` and `manifestUrlFor` comments.
- `.github/workflows/conformance.yml`,
  `.github/workflows/publish-addon-sdk.yml` (removed): no longer
  shipped from the canonical repo. Forks MAY add equivalents in their
  fork only.
- `docs/dev/release.md`: replace the "tag push triggers workflow"
  section with the `pnpm release:addon-sdk` runbook.
- `docs/dev/conformance.md`: replace the "CI (optional, not
  authoritative)" section with a "No CI vendor dependency" section.
- `CLAUDE.md`: drop the GitHub Actions paragraph; add the local
  publish + static-deploy summary.
- `docs/adr/0021-local-first-conformance.md`: amend Status to
  "Implemented (hardened by ADR-0022)"; rewrite Decision §5 to "no
  CI vendor configuration ships in the repository."
- `docs/adr/0019-publish-pipeline.md`: amend Status to indicate §5 is
  superseded by this ADR; the rest stays authoritative.
- `docs/adr/README.md`: add the index row for ADR-0022.
