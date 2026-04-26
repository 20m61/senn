# Architecture Decision Records

This directory holds ADRs for SENN. New ADRs follow the existing template:

```
# ADR NNNN: <title>

## Status
Proposed | Accepted | Superseded by ADR-XXXX | Deprecated

## Context
<what problem are we solving and what constraints apply>

## Decision
<what we decided>

## Rationale
<why we made this decision>

## Consequences
<expected positive and negative outcomes>
```

## Index

| ID   | Title | Status |
|------|-------|--------|
| 0001 | [Project Principles](0001-project-principles.md) | Accepted |
| 0002 | [License Strategy](0002-license-strategy.md) | Accepted |
| 0003 | [Add-on Sandbox Model](0003-addon-sandbox-model.md) | Accepted |
| 0004 | [P2P Transport Strategy](0004-p2p-transport-strategy.md) | Accepted |
| 0005 | [Local-first Persistence](0005-local-first-persistence.md) | Accepted |
| 0006 | [Static Add-on Policy](0006-static-addon-policy.md) | Accepted |
| 0007 | [Vendor-neutral signaling and relay](0007-vendor-neutral-signaling-and-relay.md) | Accepted |
| 0008 | [Manifest signing](0008-manifest-signing.md) | Accepted |
| 0009 | [Keystore minimum](0009-keystore-minimum.md) | Accepted |
| 0010 | [Key rotation](0010-key-rotation.md) | Accepted |
| 0011 | [Binary peer transfer](0011-binary-peer-transfer.md) | Accepted |
| 0012 | [Chunked binary peer transfer](0012-chunked-binary-peer-transfer.md) | Accepted |
| 0013 | [Tier 2 TURN — vendor-neutral relay strategy](0013-tier-2-turn.md) | Accepted |
| 0014 | [Nostr signaling adapter](0014-signaling-nostr.md) | Accepted |
| 0015 | [Cross-peer media tracks (audio + video)](0015-media-tracks.md) | Implemented |
| 0016 | [Add-on gallery — discovery, trust display, install hand-off](0016-addon-gallery.md) | Accepted (design only) |
| 0017 | [Registry schema v2 — categorisation, deprecation, meta-registries](0017-registry-schema-v2.md) | Accepted (design only) |
| 0018 | [Add-on SDK type distribution](0018-addon-sdk-types.md) | Accepted |
| 0019 | [Public npm publish pipeline](0019-publish-pipeline.md) | Accepted (design only; release flow lands as a follow-up) |
| 0020 | [Registry schema v3 — version histories, submissions, audits](0020-registry-schema-v3.md) | Accepted |
