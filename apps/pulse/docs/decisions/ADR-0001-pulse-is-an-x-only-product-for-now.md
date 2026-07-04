# ADR-0001: Pulse Is An X-Only Product For Now

Status: accepted

## Context

Pulse previously carried broader multi-platform marketing language that no longer matched the real current product.

That drift makes onboarding harder and increases the chance of building against the wrong mental model.

## Decision

Treat Pulse as an X.com marketing agent for now.

Docs, proposals, and implementation planning should assume X is the active product surface unless an explicit product decision expands scope again.

## Consequences

- repo language becomes more honest and easier to reason about
- future platform expansion must be explicit, not implied
- historical broader ideas should live in proposals or archive rather than canonical docs
