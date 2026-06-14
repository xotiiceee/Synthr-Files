# Pulse Architecture Context

Status: canonical

## Role In The System

Pulse is a standalone X.com marketing automation product.

It owns the X.com marketing-agent product surface, hosted runtime, first-party
customer experience, and standalone auth/billing/deployment posture. ClawNet can
remain a configured provider for selected capabilities during migration, but it
is not the canonical product home for Pulse.

## Context

```text
Soma
  -> protocol and trust primitives

ClawNet
  -> optional/transitional provider capabilities where configured

Pulse (this repo)
  -> standalone X.com marketing automation product
  -> hosted runtime, brand logic, engagement workflow
  -> first-party auth, Stripe billing, durable usage posture
```

## Major Internal Surfaces

- Hosted runtime in `hosted/`
- Product logic in `src/`
- Scripts and operator workflows in `scripts/`
- Product and operational docs in `docs/`

## Canonical References

- Product model: [product-model.md](product-model.md)
- Adaptive engine: [adaptive-engine.md](adaptive-engine.md)
- ClawNet dependency: [../reference/clawnet-dependency.md](../reference/clawnet-dependency.md)
- X integration: [../reference/x-integration.md](../reference/x-integration.md)
