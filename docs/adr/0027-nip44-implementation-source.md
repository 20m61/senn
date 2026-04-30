# ADR 0027: NIP-44 v2 implementation source for `@senn/signaling-nostr` v2

## Status

**Implemented** (2026-04-30). All Status-flip preconditions are met:

- `@senn/signaling-nostr` v2 send/receive paths shipped at commit
  ff0c619 (PR #30) and route through the `nostr-tools/nip44` sub-path
  per §2.
- `nostr-tools/nip44.encrypt` / `.decrypt` are called with a 32-byte
  HKDF-derived `conversationKey` per §3; `getConversationKey` is not
  invoked anywhere in the adapter source.
- The construction-time KAT (§5) lives in
  `packages/signaling-nostr/src/v2.ts` and runs against the bundled
  fixture at `packages/signaling-nostr/test/fixtures/nip44-v2-vector.json`
  on every adapter instantiation that enables v2.
- The license-policy amendment (§6) shipped at commit b23061e
  (PR #29).
- The cipher-name correction in ADR-0024 §1 (§8) shipped at commit
  f0fee8a (PR #24).
- `pnpm verify:nostr-self-test` covers the §7 drift-detection round-
  trip and the four ADR-0024 §8 MUST clauses, surfaced as 9 ok lines
  in the conformance summary.

Originally Proposed 2026-04-29. This ADR selects the implementation
source for the v2 cipher contracted by
[ADR-0024](0024-encrypted-nostr-signaling-nip44.md). The decision
(Option A: route through `nostr-tools/nip44`) is unchanged.

## Context

[ADR-0024](0024-encrypted-nostr-signaling-nip44.md) commits the
`@senn/signaling-nostr` adapter to an OPTIONAL v2 wire variant that
encrypts the kind-25556 `content` field with NIP-44 v2 keyed off a
room-derived symmetric secret. It does not name the implementation
source for the cipher itself. This ADR closes that gap.

Constraints to satisfy:

- **License-policy compliance** ([`docs/license-policy.md`](../license-policy.md)).
  Allowed licenses (at the time this ADR was authored 2026-04-29):
  MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0.
  Disallowed: GPL/AGPL/SSPL/BUSL/no-license/unknown. "Unlicense" was
  unlisted and fell under "Custom licenses" → Review Required at
  authoring time; this Context bullet records the constraint as
  originally stated. The §6 Decision below resolves it; the
  amendment shipped at commit b23061e (PR #29). The Status block
  above reflects the resolved state.
- **Vendor neutrality** ([ADR-0007](0007-vendor-neutral-signaling-and-relay.md)).
  No SENN-project trust point on the signaling path; no relay-specific
  dependency.
- **Static add-on policy** ([ADR-0006](0006-static-addon-policy.md)).
  The cipher runs inside the adapter, not inside add-ons; add-ons see
  only `senn.<namespace>.<method>(...)`. This ADR is internal to the
  adapter package.
- **Browser-standard preference**
  (CLAUDE.md "Prefer browser standard APIs over dependencies").
  Where WebCrypto can do the job, it should.
- **Bundle-size discipline.** `@senn/signaling-nostr` is opt-in; its
  dependency surface must remain small enough that web-app deployments
  that do not use Nostr can tree-shake or skip-import it cleanly.
- **Spec conformance.** The output must round-trip with any compliant
  NIP-44 v2 implementation, including ones outside the SENN ecosystem.

### What the v2 cipher actually is

The NIP-44 v2 specification mandates **ChaCha20 + HMAC-SHA256
(encrypt-then-MAC), with HKDF-SHA256 key derivation, padding to
power-of-two-minus-2 plaintext lengths, and a base64-standard envelope
of the form `version || nonce || ciphertext || mac`**. The cipher is
**not** XChaCha20-Poly1305 (which is what AEAD libraries default to);
it is plain 12-byte-nonce ChaCha20 followed by an HMAC-SHA256 tag.

This identification is grounded in:

- The reference NIP-44 specification at
  https://github.com/nostr-protocol/nips/blob/master/44.md (§Encryption
  and §"v2 specification").
- The current `nostr-tools/nip44` implementation, which imports
  `chacha20` (12-byte nonce variant) from `@noble/ciphers/chacha`,
  `hmac` from `@noble/hashes/hmac`, `sha256` from
  `@noble/hashes/sha2`, and `hkdf_extract` / `hkdf_expand` from
  `@noble/hashes/hkdf`.

ADR-0024 §1 states "XChaCha20-Poly1305 with HKDF-SHA256". This is a
naming error in ADR-0024 — the HKDF-SHA256 part is correct, but the
authenticated-encryption part is ChaCha20 + HMAC-SHA256 in the
encrypt-then-MAC composition, not XChaCha20-Poly1305 AEAD. A small
follow-up correction to ADR-0024 §1 and the corresponding §"v2 content
cipher" header in `docs/signaling-nostr-spec.md` ships alongside or
immediately after this ADR; the wire shape itself is unchanged because
both sides of ADR-0024's contract delegate the cipher envelope to "NIP-44
v2 exactly as the NIP-44 specification defines it" — only the prose
naming is wrong.

### What is already in the dependency tree

`@senn/signaling-nostr` already declares `nostr-tools@^2.7.2` as a
direct dependency (current resolved: `2.23.3`). That installation
transitively provides:

| Package              | Version | License   | Used for                                 |
|----------------------|---------|-----------|------------------------------------------|
| `nostr-tools`        | 2.23.3  | Unlicense | NIP-01 frame encoding, signing, NIP-44 module |
| `@noble/ciphers`     | 2.1.1   | MIT       | ChaCha20                                 |
| `@noble/hashes`      | 2.0.1   | MIT       | HMAC-SHA256, HKDF, SHA-256               |
| `@noble/curves`      | 2.0.1   | MIT       | secp256k1 (used by NIP-01, not by v2)    |
| `@scure/base`        | n/a     | MIT       | base64 standard encoding                 |

`nostr-tools` exports a `nip44` module (`nostr-tools/nip44`) with
`encrypt(plaintext, conversationKey)` and `decrypt(ciphertext,
conversationKey)`. The module also exposes `getConversationKey(privA,
pubB)` (an ECDH helper SENN does NOT use — see Decision §3).

`scripts/check-licenses.ts` is currently a stub and does not block on
any license. Whether or not "Unlicense" is permitted under
`docs/license-policy.md` has not yet been decided in writing; this ADR
forces that decision because the choice is on the critical path to
shipping ADR-0024.

### Ruled-out option: hand-roll on WebCrypto

WebCrypto (`crypto.subtle`) supports `AES-*`, `HMAC`, `HKDF`,
`PBKDF2`, `ECDH`, `ECDSA`, `RSA-*`. It does **not** support ChaCha20
in any form. NIP-44 v2 mandates ChaCha20. Therefore a fully
browser-standard implementation of the cipher core is not possible
today. WebCrypto can still provide HMAC-SHA256 and HKDF-SHA256, but
the ChaCha20 stream must come from a JavaScript implementation. This
removes "WebCrypto-only" from the option set; a JS dependency is
unavoidable.

### Options considered

| Option | Description | Direct deps added to `@senn/signaling-nostr` | Adapter LOC | Bundle delta | Drift risk vs NIP-44 spec |
|--------|-------------|-----------------------------------------------|-------------|--------------|---------------------------|
| **A** | Call `nostr-tools/nip44.encrypt`/`decrypt` with SENN's HKDF-derived key as `conversationKey`; bypass `getConversationKey` (no ECDH) | None (already vendored) | ~30 (HKDF + sentinel + glue) | ≈0 KB (the module is already pulled by current `nostr-tools` usage) | Low — official Nostr lib; passes upstream NIP-44 test vectors |
| **B** | Re-implement the NIP-44 v2 envelope (padding, ChaCha20 stream, HMAC-SHA256 MAC, base64) on top of `@noble/ciphers` + `@noble/hashes` directly | `@noble/ciphers`, `@noble/hashes` (already transitively present) | ~100–120 (envelope + tests) | +~15 KB (sub-module imports only) | Medium — SENN re-derives envelope; clean-room obligation; needs official test-vector replay |
| **C** | WebCrypto-only | — | — | — | **Ruled out** (no ChaCha20 in WebCrypto) |

## Decision

Adopt **Option A**: `@senn/signaling-nostr` v2 calls
`nostr-tools/nip44.encrypt` and `nostr-tools/nip44.decrypt` directly,
passing the 32-byte HKDF-SHA256 output specified by ADR-0024 §2 as the
`conversationKey` argument. SENN does NOT use
`nostr-tools/nip44.getConversationKey` (which performs ECDH between two
Nostr identities); the room-key derivation lives in
`@senn/signaling-nostr` and produces a synthetic conversation key that
is structurally identical (32 bytes, used as the `conversationKey` slot
in NIP-44's per-message HKDF expansion).

Specifically:

### 1. No new direct dependency

`@senn/signaling-nostr` MUST NOT add a direct dependency on
`@noble/ciphers`, `@noble/hashes`, or `@scure/base` for v2. The cipher
implementation is reached transitively through the existing
`nostr-tools` dependency.

Any future ADR that removes `nostr-tools` MUST re-evaluate the v2
implementation source and either adopt Option B from §"Options
considered" or name a new option. The migration ADR MUST cite this
clause and MUST NOT silently swap the cipher source.

### 2. Sub-path import

Imports MUST be sub-path imports of the public NIP-44 module:

```ts
import { encrypt, decrypt } from "nostr-tools/nip44";
```

Implementations MUST NOT reach into `nostr-tools/lib/esm/...` or
`nostr-tools/cjs/...` paths. The sub-path module surface is the
contract; deep paths break on `nostr-tools` minor upgrades.

Implementations MUST NOT use the umbrella import
`import { nip44 } from "nostr-tools"` either. The umbrella pulls the
full `nostr-tools` index module (NIP-01 helpers, secp256k1, base
encodings, etc.) into the bundler's static graph, defeating the
bundle-size discipline §1 names. The `nostr-tools/nip44` sub-path is
the only permitted entry point.

### 3. Bypass ECDH; pass the SENN room key as `conversationKey`

The room key produced by ADR-0024 §2's HKDF-SHA256 derivation is a
32-byte array. NIP-44 v2 expects a 32-byte `conversationKey`
(structurally, the output of HKDF-extract over an ECDH shared secret).
Both are 32 random-looking bytes; the cipher does not care how they
were produced.

The argument passed as `conversationKey` to
`nostr-tools/nip44.encrypt` and `nostr-tools/nip44.decrypt` MUST be a
`Uint8Array` of length **exactly 32**. The upstream type signature
(`Uint8Array`) does not pin the length; SENN pins it here. Passing
any other length is a programmer error and MUST throw at the SENN
boundary before reaching `nip44.encrypt`.

`@senn/signaling-nostr` MUST therefore call:

```ts
const ciphertext = encrypt(plaintext, sennRoomKey);
const plaintext  = decrypt(content,   sennRoomKey);
```

and MUST NOT call `getConversationKey(privA, pubB)`. Calling
`getConversationKey` would re-introduce a Diffie-Hellman step on the
signaling path, contradicting ADR-0024 §2 ("No Diffie-Hellman step
is performed").

### 4. Sentinel handling stays in SENN code

The `nv44` sentinel (ADR-0024 §3) is a SENN-internal framing decision,
not part of NIP-44. `@senn/signaling-nostr` MUST prepend / strip the
sentinel **outside** the call to `nostr-tools/nip44.encrypt` /
`decrypt`:

```
plaintext  = "nv44" || JSON.stringify(signalingMessage)
ciphertext = nip44.encrypt(plaintext, sennRoomKey)
```

`nostr-tools/nip44` MUST NOT be patched, monkey-patched, or wrapped to
inject the sentinel at the cipher layer.

### 5. Adapter MUST verify the upstream contract on construction

To guard against a future `nostr-tools` major bump silently changing
the cipher (e.g., switching to a v3 envelope), `@senn/signaling-nostr`
MUST run a single round-trip self-check against a known-answer test
(KAT) vector when the v2 path is enabled. If the self-check fails,
the adapter MUST throw at construction time and MUST NOT fall back to
v1 plaintext; the operator chose v2 explicitly and a silent downgrade
would mislead them.

The KAT MUST pass an **explicit fixed `nonce`** to
`nip44.encrypt(plaintext, key, nonce)` to obtain a deterministic
ciphertext. Without an explicit nonce, the upstream `encrypt`
defaults to `randomBytes(32)` and the comparison against a stored
ciphertext is impossible. Implementations MUST therefore exercise
the optional third parameter of the upstream signature
(`encrypt(plaintext: string, conversationKey: Uint8Array, nonce?:
Uint8Array): string`) for the construction-time self-check, even
though normal v2 encryption SHOULD continue to use the upstream
default (random nonce).

The known-answer vector lives in
`packages/signaling-nostr/test/fixtures/nip44-v2-vector.json` and is
sourced from the NIP-44 specification's published test vectors (CC0,
clean-room imported by reference, not by code copy). The fixture
record MUST contain at minimum:

```jsonc
{
  "plaintext":       "...",         // string
  "conversationKey": "...",         // 64-char hex (32 bytes)
  "nonce":           "...",         // 64-char hex (32 bytes)
  "ciphertext":      "..."          // base64 NIP-44 v2 envelope
}
```

The construction-time KAT executes a single ChaCha20 round-trip on
the (typically small) fixture payload; the cost is sub-millisecond
on commodity hardware and MUST run on every adapter instantiation
that enables v2. The cost is acceptable in exchange for catching
an upstream regression at the adapter boundary rather than at the
first peer-to-peer message.

### 5a. Wrong implementations the adapter MUST NOT ship

The following code patterns are non-conformant. They are listed so
an AI coder generating the v2 path can be screened against the
intended contract:

```ts
// 1. Deep-path import (§2). Breaks on `nostr-tools` minor upgrades
// and is not part of the upstream `exports` map.
import { encrypt } from "nostr-tools/lib/esm/nip44.js"; // ❌

// 2. Umbrella import (§2). Pulls the full `nostr-tools` graph into
// the bundle, defeating §1's bundle-size discipline.
import { nip44 } from "nostr-tools"; // ❌

// 3. ECDH path (§3). Re-introduces a Diffie-Hellman step on the
// signaling path; contradicts ADR-0024 §2.
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { getConversationKey, encrypt } from "nostr-tools/nip44";
const ck = getConversationKey(generateSecretKey(),
                              getPublicKey(generateSecretKey())); // ❌
const ciphertext = encrypt(plaintext, ck);

// 4. Sentinel injected at the cipher layer (§4). The `nv44`
// sentinel is a SENN-internal framing concern and MUST live
// outside `nip44.encrypt`.
import { encrypt } from "nostr-tools/nip44";
const wrapped = (pt: string, k: Uint8Array) =>
  encrypt("nv44" + pt, k); // ❌ if SENN code calls this thinking
                           //    it is the cipher; sentinel must be
                           //    visible in SENN code, not buried
                           //    in a wrapper.

// 5. Skipped construction-time KAT (§5). Adapter ships v2 without
// any guard against an upstream cipher regression.
class NostrAdapter {
  constructor(opts: { v2: boolean }) {
    if (opts.v2) {
      // ❌ no `runConstructionTimeKAT()` call
    }
  }
}

// 6. v1 silent fallback after KAT failure (§5). The adapter
// downgrades the operator's explicit v2 choice without surfacing it.
try {
  runConstructionTimeKAT();
} catch {
  this.v2 = false; // ❌ MUST throw, not downgrade.
}
```

Each pattern is forbidden by the corresponding clause; `verify:nostr-self-test`
MUST include a regression check that scans the shipped
`@senn/signaling-nostr` build output
(`packages/signaling-nostr/dist/**/*.{js,mjs,cjs}`) for
`from "nostr-tools/..."` import specifiers and fails any specifier
outside the allow-list `{ "nostr-tools/nip44", "nostr-tools/pure" }`.
Adding a new permitted sub-path requires amending this clause.

The allow-list rationale: `nostr-tools/nip44` is the §2-named cipher
sub-path; `nostr-tools/pure` provides `finalizeEvent`,
`generateSecretKey`, `getPublicKey` for NIP-01 frame signing
(ADR-0014). Any other sub-path (`nostr-tools/lib/...`,
`nostr-tools/cjs/...`, the umbrella `nostr-tools`, or an unlisted
sibling like `nostr-tools/nip04`) silently widens the dependency
surface §1 names, and so MUST be rejected at the gate. The check
runs against the build output rather than the source so a future
build-tool change that rewrites or inlines an import is also
caught.

### 6. License treatment of `nostr-tools` (Unlicense)

The `nostr-tools` package's SPDX license is `Unlicense`. At the time
this ADR was authored (2026-04-29), SENN's license-policy listed
allowed (MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, CC0-1.0),
review-required, and disallowed (GPL/AGPL/SSPL/BUSL/no-license/unknown)
tiers. `Unlicense` was not on any list.

This ADR records that `Unlicense` is acceptable for SENN dependencies
**under the same handling as `CC0-1.0`** (effective public-domain
dedication; OSI-approved as of 2020; commonly accepted alongside MIT
in permissive-only stacks). The follow-up `docs/license-policy.md`
amendment that adds `Unlicense` to the Allowed list with a one-line
note citing this ADR shipped at commit b23061e (PR #29).

This is not a license-policy weakening: the policy already permits
`CC0-1.0`, which is functionally equivalent. The omission of
`Unlicense` from the original list was an oversight, not a deliberate
exclusion.

**Scope-bundling note.** This ADR's primary Decision is the
implementation-source choice. The `Unlicense` policy amendment is a
project-wide license-policy decision and would normally deserve its
own ADR (potential ADR-0028 "Add `Unlicense` to allowed dependency
licenses"). It is bundled here for two reasons: (a) it is on the
critical path of ADR-0024 (we cannot ship the v2 path without
clearing the policy first) and (b) the amendment is mechanical
(`Unlicense` ≈ `CC0-1.0`, both already-OSI-approved
public-domain-equivalent), so an independent ADR would be a single
sentence cross-referencing this one. If the maintainer prefers
orthogonal scope, §6 SHOULD be split into ADR-0028 and ADR-0027 §6
SHOULD become a one-line "depends on ADR-0028 landing first" note.
Flag this preference during ADR-0027 review.

### 7. Drift detection

`pnpm verify:nostr-self-test` MUST be extended (alongside the v2
implementation in the implementation PR) to:

- Run the §5 known-answer test on every gate invocation.
- Round-trip a `SignalingMessage` through `nostr-tools/nip44.encrypt`
  ➜ `decrypt` to confirm the upstream module is loadable and the
  sub-path import resolves.

The intent is to catch a `nostr-tools` upgrade that breaks the
`nostr-tools/nip44` sub-path or the `(plaintext, conversationKey)`
signature before that upgrade lands on `develop`.

### 8. Concurrent correction to ADR-0024 §1 + spec

A separate, small-scope follow-up titled `docs(adr): correct ADR-0024
§1 cipher name` MUST correct the cipher name in ADR-0024 §1 (and the
matching introductory paragraph in the `docs/signaling-nostr-spec.md`
v2 section) from "XChaCha20-Poly1305 with HKDF-SHA256" to "ChaCha20 +
HMAC-SHA256 (encrypt-then-MAC) with HKDF-SHA256". The wire shape is
unchanged; only the prose name is wrong.

This ADR does not itself amend ADR-0024 — that change is a separate
PR scoped to the cipher-name correction so the fix is reviewable
independently of the implementation-source decision.

**Sequencing note.** The `docs/signaling-nostr-spec.md` v2 section
ships in PR #24 (`feature/adr-0024-spec-v2-cipher`). If PR #24 has
not yet landed at the time the cipher-name correction PR is opened,
the spec change is folded into PR #24 (one new commit on that branch)
and the standalone correction PR amends only ADR-0024 §1. This avoids
shipping a spec correction that references a section that does not
yet exist on `develop`.

## Rationale

- **Why Option A over Option B.** Option A inherits an
  upstream-maintained NIP-44 v2 envelope, including the padding rules
  that are the most error-prone part of NIP-44 v2 (power-of-two-minus-2
  with a leading 2-byte length field). Re-implementing those in SENN
  would absorb the maintenance cost without any user-visible benefit.
  Option A's only structural cost is the `Unlicense` policy decision,
  which §6 settles cleanly.
- **Why bypass `getConversationKey`.** ADR-0024 §2 explicitly forbids
  a Diffie-Hellman step. `getConversationKey` performs secp256k1 ECDH
  between two Nostr identities. Reusing it would either require
  fabricating two keypairs (purely to derive a shared secret SENN
  ignores) or feeding it real keypairs (which would couple the
  signaling identity to the encryption identity, contradicting
  ADR-0024 §7). Passing SENN's room-key directly as `conversationKey`
  is both simpler and more faithful to ADR-0024.
- **Why a known-answer self-check on construction.** `nostr-tools` has
  a permissive license and a high churn rate (current `2.23.3`,
  starting `2.7.2` in the workspace declaration). A v3 envelope or
  signature change in a minor release would otherwise ship silently
  and break SENN rooms after `pnpm install`. The construction-time
  self-check makes that breakage immediately visible at the adapter
  boundary.
- **Why not add `@noble/ciphers` + `@noble/hashes` as direct
  dependencies anyway.** Even though the licenses are MIT (clean for
  SENN), every direct dependency is a future maintenance vector and a
  future supply-chain surface. Keeping the v2 path on the existing
  `nostr-tools` import minimises both. If `nostr-tools` is ever
  removed, the ADR explicitly hands off the re-evaluation to that
  future ADR.
- **Why surface the cipher-name drift now.** The drift was discovered
  during the implementation-source survey; documenting it in this ADR
  while it is still fresh prevents it from leaking into the
  implementation PR (where it would be harder to catch in review). The
  fix itself is small and ships as its own PR for clean reviewability.

## Consequences

### Positive

- Zero new direct dependencies on `@senn/signaling-nostr`. The package
  remains opt-in and tree-shakeable.
- `nostr-tools/nip44`'s upstream test vectors and CI cover the cipher
  envelope; SENN is responsible only for the room-key derivation and
  sentinel framing.
- The construction-time self-check (§5) catches the most plausible
  supply-chain regression (a `nostr-tools` minor that breaks the
  sub-path or signature).
- No change to ADR-0014's vendor-neutrality posture: Nostr is already
  the named relay surface; `nostr-tools` was already the chosen
  implementation library.
- The license-policy amendment (§6) is additive and reflects the
  existing intent of the policy (`CC0-1.0` is already allowed).

### Negative

- SENN takes a slightly tighter coupling to `nostr-tools`: not just
  the package itself, but the `nostr-tools/nip44` sub-path module's
  call signatures. A `nostr-tools` major-version migration that
  reshapes the sub-path is now a SENN-visible event. Mitigated by
  the construction-time self-check (§5) and by the migration handoff
  clause (§1).
- Adopting `Unlicense` formally requires a license-policy doc update.
  This is a deliberate, reviewable change to a normative document
  rather than an implicit acceptance.
- The cipher-name correction in ADR-0024 §1 is a normative-prose
  amendment. It does not affect any wire shape, but it does require
  re-reading by anyone who relied on the original wording.
- **Install-footprint vs bundle-footprint asymmetry.** §1's "≈0 KB
  bundle delta" is true for the *bundle* — the `nostr-tools/nip44`
  sub-path tree-shakes cleanly because production builds already
  include that module via the v1 path. It is not true for the
  *install footprint*: `nostr-tools` continues to bring along
  `@noble/curves`, `bip39`/`bip32`-related modules, and other
  upstream sub-modules SENN's v2 path does not exercise. An
  audit-conscious reader who weighs install size (e.g., for
  reproducible-build provenance or supply-chain SBOM minimisation)
  should know the cipher source is "free" only at the bundle layer,
  not at the install layer.
- **Non-deterministic ciphertext (NIP-44 v2 default).** A v2 send
  with no explicit nonce produces a fresh ciphertext for the same
  plaintext (random 32-byte nonce per call). This is correct NIP-44
  v2 behaviour and is fine for a signaling channel, but a future
  feature that needs deterministic content (e.g., content-addressed
  event IDs or replay-windowing keyed off the ciphertext) would have
  to introduce its own nonce-management policy outside the cipher.
  Documented here because the option to fork to Option B (so SENN
  controls the nonce path directly) is the smaller maintenance lift
  if such a feature lands later.

### Neutral / follow-up

- `scripts/check-licenses.ts` is a stub and does not yet enforce the
  policy. Hardening it is out of scope for this ADR but is a desirable
  follow-up so future Unlicense-or-similar drift is caught at the
  gate.
- A future ADR that migrates `@senn/signaling-nostr` off `nostr-tools`
  inherits §1's obligation to re-evaluate the v2 implementation source.
- The known-answer test vector adopted in §5 is sourced from the
  NIP-44 specification; if the spec publishes new vectors, SENN
  SHOULD adopt them in a maintenance PR.

## Implementation PR plan

The work this ADR authorises lands across a sequence of small,
independently reviewable PRs. The order is load-bearing: an earlier
PR's correction prevents an artefact in a later PR from referencing
content that does not yet exist on `develop`.

| # | PR title | Lands | Depends on |
|---|----------|-------|------------|
| P1 | `docs(adr): ADR-0027 NIP-44 v2 implementation source` | This ADR (`Proposed`) | — |
| P2 | `docs(adr): correct ADR-0024 §1 cipher name` (per §8) | Renames "XChaCha20-Poly1305 with HKDF-SHA256" to "ChaCha20 + HMAC-SHA256 (encrypt-then-MAC) with HKDF-SHA256" in ADR-0024 §1 and the matching `docs/signaling-nostr-spec.md` v2 paragraph (folded into PR #24 if PR #24 is still open) | P1 Accepted; PR #24 status known |
| P3 | `docs(license-policy): add Unlicense to allowed dependency licenses` (per §6) | Adds `Unlicense` to the Allowed list with a one-line ADR-0027 cite. May be split into ADR-0028 first if maintainer prefers orthogonal scope | P1 Accepted |
| P4 | `feat(signaling-nostr): NIP-44 v2 send/receive paths` | `@senn/signaling-nostr` v2 implementation routed through `nostr-tools/nip44`, KAT fixture (§5), construction-time KAT, sentinel handling (§4), `verify:nostr-self-test` extensions (§7), regression check for deep-path / umbrella imports (§5a) | P1 Accepted, P2 landed, P3 landed |
| P5 | `docs(adr): promote ADR-0024 / ADR-0027 to Implemented` | Status flip on both ADRs; cite the merge commit of P4 | P4 landed and `pnpm conformance` green |

A maintainer who deviates from this ordering (e.g., lands P4 before
P3) re-introduces a license-policy gap that ADR-0027 §6 is meant to
close at the point of decision, and the gap becomes invisible in
`git log`. The ordering is therefore SHOULD-grade discipline
(deviation is observable but not auto-blocked) rather than MUST
(no automated gate enforces it; the conformance gate's
license-check is a stub today, per §"What is already in the
dependency tree").

## Related

- ADR-0007: [Vendor-neutral signaling and relay](0007-vendor-neutral-signaling-and-relay.md) — vendor-neutrality constraint this ADR satisfies.
- ADR-0014: [Nostr signaling adapter](0014-signaling-nostr.md) — the existing v1 adapter that already vendors `nostr-tools`.
- ADR-0024: [Encrypted Nostr signaling content via NIP-44](0024-encrypted-nostr-signaling-nip44.md) — defines the v2 wire shape this ADR provides the cipher source for; §1 cipher name will be corrected in a separate PR per §8.
- Spec: [docs/signaling-nostr-spec.md](../signaling-nostr-spec.md) — normative wire shape, including the v2 §"v2 content cipher (NIP-44, OPTIONAL)" section.
- Policy: [docs/license-policy.md](../license-policy.md) — to be amended to add `Unlicense` to the Allowed list per §6.
- NIP-44: https://github.com/nostr-protocol/nips/blob/master/44.md — normative cipher specification (ChaCha20 + HMAC-SHA256, HKDF-SHA256, base64 envelope).
