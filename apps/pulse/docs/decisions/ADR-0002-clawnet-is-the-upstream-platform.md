# ADR-0002: ClawNet Is Pulse's Upstream Platform

Status: superseded by ADR-0005

## Context

Pulse was previously treated as a product of ClawNet, not a parallel platform.

Without a durable boundary, Pulse can accidentally grow duplicate platform docs, runtime assumptions, or billing doctrine.

## Decision

Use `claw-net` as the canonical home for shared ClawNet provider behavior only.
Pulse product, auth, billing, deployment, and runtime doctrine now live in this
repo under ADR-0005 and the standalone ADR set.

Pulse should document only Pulse-specific use of the platform.

## Consequences

- Pulse remains product-focused.
- ClawNet can remain a transitional provider for selected capabilities.
- ClawNet is no longer the canonical home for Pulse auth, billing, deployment,
  or hosted runtime doctrine.
