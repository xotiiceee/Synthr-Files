# ADR-0007: Stripe Billing And Usage Metering

Status: accepted

## Context

Pulse currently bills through ClawNet credits. A standalone premium Pulse needs
direct customer billing, subscriptions, usage metering, invoices, refunds,
entitlements, and auditability.

## Decision

Stripe is the primary billing system for standalone Pulse.

The product should use subscription tiers plus metered usage for LLM, listening,
X actions, image generation, and other variable-cost automation. Provider keys
that customers bring themselves can reduce metered platform cost, but should not
remove the need for usage events and entitlements.

## Consequences

- ClawNet credit billing becomes legacy or provider-specific during migration.
- Usage events must be durable and idempotent.
- Spend caps must move out of process memory.
- Billing and action execution need reconciliation and audit trails.

## Related

- `docs/proposals/standalone-premium-pulse.md`
