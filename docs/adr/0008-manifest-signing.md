# ADR 0008: Add-on manifest signing

## Status

Accepted

## Context

The SENN ecosystem distributes add-ons as static files served from any
host. The Trust Layer in
[ecosystem-business-model.md](../ecosystem-business-model.md) — the
"SENN Verified" designation — depends on a way for a SENN host
application to prove that a given manifest came from a publisher whose
key it trusts.

We need a signing scheme that is:

- Vendor-neutral (no Apple/Google/CA-backed identities required).
- Browser-native (Web Crypto, no extra runtime dependency).
- Detached from the manifest body so canonicalisation problems do not
  silently break verification.
- Optional at the host application level (some host apps load only
  signed add-ons; others accept unsigned community add-ons with a UI
  warning).

## Decision

1. SENN add-on manifests MAY be signed using **Ed25519** (RFC 8032).
2. The signature is **detached**: a separate file
   `manifest.sig.json` MUST live alongside `manifest.json` and MUST be
   served from the same origin.
3. The signed bytes are the **raw bytes of `manifest.json`** as served.
   No canonicalisation is performed.
4. `manifest.sig.json` carries the algorithm identifier, the public key,
   the detached signature, and a timestamp — all encoded as
   **base64url without padding**.
5. The host application supplies the set of trusted public keys at
   AddonHost construction time (`trustedKeys: ReadonlySet<string>`).
   SENN Core does not embed a default trust root. (See ADR-0007 for the
   parallel decision on signaling adapters.)
6. The AddonHost exposes three verification modes:
   - `none` (default): no signature is fetched or verified.
   - `optional`: a signature is fetched if available; presence + invalid
     signature still rejects, absence is accepted.
   - `required`: a signature MUST exist and verify against
     `trustedKeys` for the load to proceed.

## Rationale

- Ed25519 has tiny keys (32 B) and signatures (64 B), is in Web Crypto
  on every supported browser SENN targets, and avoids X.509 / CA
  ceremony.
- Detached signatures keep the manifest readable and side-step the
  classic JSON canonicalisation hazards: any later formatter or comment
  removal that touches `manifest.json` invalidates the signature, which
  is the right behaviour for a content signature.
- Host-supplied trusted keys preserve vendor neutrality. Each operator
  picks their root of trust — the SENN Project, an enterprise's own
  signing key, or a federation-style aggregation.

## Consequences

- A new `@senn/manifest` package owns sign / verify primitives. SENN
  Core consumes the verifier only — signing is a tooling concern that
  lives next to the package.
- Add-on publishers MUST keep their private key off the network. The
  reference flow uses Web Crypto's non-extractable keys; CLI flows use
  encrypted keystores out of scope for this ADR.
- Key rotation, revocation, and registry-side aggregation are deferred
  to a future ADR. For now, host applications rotate keys by editing
  their `trustedKeys` set.
- This ADR opens the path to "SENN Verified" — a SENN-Project-operated
  signing service that countersigns reviewed add-ons. That service is
  out of scope here; the format below is the substrate it will sign on.
