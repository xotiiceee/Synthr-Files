# ADR-0010: Premium X Safety Posture

Status: accepted

## Context

Pulse is moving toward a premium agency-grade X automation product. That product
promise is incompatible with unsafe growth tactics, unclear account risk, or
automation that can harm client accounts.

Current Pulse has follow and unfollow automation paths. Those may have been
useful in earlier experiments, but they do not fit the proposed premium safety
posture.

## Decision

Hosted premium Pulse removes follow/unfollow churn from canonical automation.

Pulse should default to draft mode, use official X write APIs wherever possible,
make autopilot opt-in, cap autonomous actions, expose account-health controls,
and pause automation when safety events indicate risk.

## Consequences

- Follow/unfollow code may remain archived or self-host-only during migration,
  but should not be part of hosted premium automation by default.
- Scheduler tasks for follow/unfollow should be disabled or removed from the
  canonical hosted path after this ADR is accepted.
- Safety events, circuit breakers, and kill switches become launch requirements.
- Product positioning shifts from aggressive growth automation to controlled,
  auditable X operation.

## Related

- `docs/proposals/standalone-premium-pulse.md`
- `docs/proposals/standalone-premium-pulse-execution-checklist.md`
- `docs/decisions/ADR-0008-x-access-policy.md`
