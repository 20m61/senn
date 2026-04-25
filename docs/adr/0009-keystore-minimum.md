# ADR 0009: Keystore minimum (signing-key file format)

## Status

Accepted

## Context

ADR-0008 picked Ed25519 detached signatures for SENN add-on manifests
and put `@senn/manifest` in charge of `signManifest` / `verifyManifest`.
We now need a way for an add-on author to **persist their signing key**
so the CLI (`pnpm sign:manifest`) can sign the same key across runs.

The full Verified Registry will eventually want hardware-backed keys,
operator passphrases, and key rotation. None of that should block the
minimum useful CLI.

## Decision

1. The v1 keystore is a **single JSON file** with this shape, encoded
   in plain text — no passphrase, no encryption:

   ```json
   {
     "v": 1,
     "alg": "Ed25519",
     "publicKey": "<base64url 32 bytes>",
     "privateKey": "<base64url PKCS#8 SubjectPrivateKeyInfo>"
   }
   ```

2. The CLI tooling MUST refuse keystores whose `v` is not `1` or whose
   `alg` is not `Ed25519`.
3. Tooling that touches keys MUST use Web Crypto's `pkcs8` import/export
   only. No third-party crypto code is added.
4. SENN tooling (`scripts/sign-manifest.ts`) MUST:
   - refuse to overwrite an existing keystore unless given `--force`,
   - refuse to commit keystores: the repo `.gitignore` MUST include
     `*.key.json`,
   - not log private key bytes (only the derived public key may be
     printed).
5. Encryption-at-rest, hardware-key support, multi-key keystores, and
   passphrase prompts are EXPLICITLY out of scope for v1. They will be
   added under future ADRs once a real Verified Registry exists.

## Rationale

- A plain JSON file is good enough for solo developers and CI runners
  that already protect secrets via the surrounding system. SENN is not
  trying to replace pass / age / 1Password — it is trying not to need
  them in the simple case.
- PKCS#8 SubjectPrivateKeyInfo is the format Web Crypto exports
  natively for Ed25519, so importing/exporting in the same package
  needs zero additional code.
- Refusing to overwrite without `--force` keeps `--generate-key` from
  wiping a real key with one careless re-run.

## Consequences

- Keystore files are credentials. The repo's `.gitignore` carries the
  rule; every CLI mention reminds operators to keep them off the
  network.
- Adding encryption later is a non-breaking change: the v1 unencrypted
  format stays valid; a future v2 adds an `enc` discriminator and the
  reader chooses based on `v`.
- Hardware/OS-keystore support (Touch ID, Yubikey) becomes a separate
  ADR layered on top — it does not invalidate the file format.
