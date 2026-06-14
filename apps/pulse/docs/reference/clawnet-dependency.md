# Pulse Dependency On ClawNet

Status: narrowed by ADR-0005

Pulse is now a standalone product. ClawNet may remain a provider dependency
during migration, but it is no longer the canonical source of truth for Pulse
auth, billing, deployment, or hosted runtime behavior.

## Dependency Rules

- ClawNet-specific API behavior stays in `claw-net`.
- Pulse documents how it uses any remaining ClawNet provider capability.
- Standalone Pulse product, billing, auth, deploy, and runtime doctrine stays in
  this repo.

## Practical Meaning

- If a ClawNet provider capability changes, Pulse docs should reference that
  provider contract rather than copy its internals.
- If Pulse auth, billing, deployment, or runtime behavior changes, this repo is
  canonical.
- Standalone replacements should keep rollback paths until migration is proven.
