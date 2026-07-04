# ADR-0008: X Access Policy

Status: accepted

## Context

Pulse is an X-only product. A premium agency-grade product must protect customer
accounts and be honest about automation risk.

Official X writes are materially different from X listening/discovery. Writes
can use official account-scoped APIs. Listening at useful multi-brand scale may
require expensive official tiers or third-party providers.

## Decision

Use a split X access policy:

- X writes use official OAuth-backed APIs wherever possible.
- Listening and discovery use an explicit provider interface.
- Listening providers must be risk-labeled and cost-visible.
- Follow/unfollow churn is not canonical premium automation.
- Draft mode is the default; full autopilot is opt-in, capped, monitored, and
  reversible.

## Consequences

- Current X read/listening behavior must move behind a `ListeningProvider`
  boundary.
- Posting, replying, liking, and media upload should move behind an `XWriteClient`
  boundary.
- Product claims must distinguish official writes from provider-backed
  listening.
- Safety events and account health must become first-class runtime data.

## Related

- `docs/proposals/standalone-premium-pulse.md`
- `docs/reference/x-integration.md`
