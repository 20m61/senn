# ADR 0001: SENN Project Principles

## Status

Accepted

## Context

SENN aims to provide a browser-native P2P experience platform where static add-ons create communication experiences and Core manages all dynamic data flow.

## Decision

SENN will follow these principles:

- Core is open source.
- Add-ons are static files.
- Dynamic data flows through Core-managed P2P APIs.
- Servers do not store dynamic communication data.
- Local persistence is user-controlled.
- Third-party add-ons are sandboxed and permissioned.

## Consequences

This keeps the system lightweight, extensible, and privacy-preserving, while enabling a trusted ecosystem around add-ons.
