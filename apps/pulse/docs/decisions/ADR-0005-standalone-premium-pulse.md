# ADR-0005: Standalone Premium Pulse

Status: accepted

## Context

Pulse is currently documented as a product of ClawNet. That was useful while
Pulse depended on ClawNet for auth, billing, deploy posture, and platform
capabilities.

The product direction is changing: Pulse should become a standalone, premium,
X-only automation product for agencies and multi-brand operators.

This changes product ownership, billing assumptions, runtime assumptions, and
the way upstream ClawNet and Soma dependencies should be treated.

## Decision

Pulse becomes a standalone product with first-party product truth in this repo.

ClawNet should no longer be the canonical home for Pulse auth, billing, deploy,
or runtime doctrine. During migration, ClawNet may remain an optional provider
for specific capabilities such as listening/discovery or provenance-backed data,
but it should not define the Pulse product model.

Pulse remains X-only unless a later ADR expands scope.

## Consequences

- `docs/reference/clawnet-dependency.md` and ADR-0002 must be superseded or
  narrowed if this ADR is accepted.
- Pulse needs first-party auth, billing, usage metering, account model,
  deployment doctrine, and support/operations docs.
- Provider boundaries are required before removing existing ClawNet calls.
- The premium product promise raises the bar for tenant isolation, auditability,
  scheduler durability, and account safety.
- Soma/provenance can remain a trust feature, but should not block the
  standalone product foundation.

## Related

- `docs/proposals/standalone-premium-pulse.md`
- `docs/decisions/ADR-0001-pulse-is-an-x-only-product-for-now.md`
- `docs/decisions/ADR-0002-clawnet-is-the-upstream-platform.md`
