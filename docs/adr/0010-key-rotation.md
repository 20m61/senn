# ADR 0010: Key rotation policy for the official add-on registry

## Status

Accepted

## Context

ADR-0008 introduced detached Ed25519 signatures over add-on manifests,
ADR-0009 specified the minimal keystore format, and the registry index
(`addons/official/index.json`) pinned a `trustedKeys` array as the
publisher's trust root.

We now need a procedure for **rotating that key** without breaking
already-deployed hosts:

- A scheduled rotation (every N months / before the holder changes).
- An emergency rotation (suspected compromise of the keystore).
- Multi-publisher futures (more than one human can publish add-ons).

Hosts that cache the registry MUST keep working while old and new
signatures coexist. We do NOT want to ship migration logic in
`@senn/manifest` — verification stays a pure function of (manifest
bytes, signature, trustedKeys).

## Decision

1. **Rotation is registry-driven, not protocol-driven.** The wire
   format (`manifest.sig.json`) does not change. Only the registry's
   `trustedKeys` array and the on-disk signatures change.

2. **Overlap window.** A scheduled rotation MUST proceed in three
   commits:

   1. **Add new key** — the new public key is appended to
      `trustedKeys`; existing signatures stay valid (the old key is
      still listed). Hosts that pull this version trust both.
   2. **Re-sign all add-ons** with the new keystore (one commit, via
      `pnpm sign:all-official keys/<new>.key.json`). Both keys remain
      trusted in the registry, so verification keeps passing
      throughout the change.
   3. **Remove the old key** from `trustedKeys` after the documented
      grace period (default: **30 days** for scheduled rotation).
      After this point, any sig still bearing the old key is rejected.

3. **Emergency rotation (suspected compromise).** The grace period is
   skipped. Steps 1–3 collapse into a single commit:

   - Generate new key.
   - Replace the compromised entry in `trustedKeys` with the new key
     (do NOT keep the compromised one for any window).
   - Re-sign all add-ons.
   - File a `SECURITY-ADVISORY-<date>.md` under `docs/advisories/`
     describing the suspected scope.

4. **`trustedKeys` ordering is informational only.** Verifiers MUST
   treat the array as a set; order does not imply preference. The
   first entry is, by convention, the *active* signing key, but the
   verifier does not enforce this.

5. **Tooling guarantees.** `pnpm sign:all-official` MUST sign every
   add-on listed in `addons/official/index.json` with the supplied
   keystore. It MUST NOT mutate the registry — adding/removing keys
   is a deliberate human edit. `pnpm verify:official` is the gate
   that proves the registry + on-disk sigs are consistent.

6. **Old signatures are not preserved.** Each add-on has at most one
   `manifest.sig.json` at a time. After re-signing, the previous
   signature is overwritten. Hosts that wanted to pin a specific
   signature must do so in their own configuration.

## Rationale

- The verifier is already key-set-driven (`trustedKeys: ReadonlySet`).
  Rotation falls out of the existing verification model — no protocol
  change is needed.
- The three-commit scheduled flow keeps every commit individually
  green: at each step, both the registry and the on-disk sigs are
  internally consistent, so `pnpm verify:official` passes.
- A 30-day grace is long enough for downstream hosts to refresh a
  cached registry and short enough to bound exposure. The number is
  configurable per rotation in the announcement note; the ADR pins
  the default.
- Conflating "rotate" with "advisory" in the emergency case keeps the
  audit trail explicit.

## Consequences

- The registry holds the policy; the verifier stays oblivious. Future
  policy changes (e.g. `notBefore` / `notAfter` per key) require a
  registry schema bump and a verifier change at the same time.
- A compromised key invalidates **every** old signature on rotation.
  Add-on authors need to be ready to re-sign promptly, but since the
  CLI is one command and the keystore is a JSON file, this is cheap.
- `pnpm sign:all-official` becomes a load-bearing tool. It MUST stay
  deterministic and refuse to run if any addon directory is missing
  a `manifest.json`.
- Hardware-backed keys (Touch ID, Yubikey, KMS) are a future ADR. The
  rotation policy here is independent of where the private key lives.
