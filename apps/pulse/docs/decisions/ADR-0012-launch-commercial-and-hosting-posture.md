# ADR-0012: Launch Commercial And Hosting Posture

Status: accepted

## Context

Pulse is moving from a ClawNet-attached tool to a standalone premium X
automation product. Several implementation choices depend on commercial and
hosting posture:

- whether SQL runtime state and Stripe are hosted-only or canonical
- whether self-host remains a supported product during the SaaS rehaul
- what customer-facing usage unit billing should expose
- which first customer profile should shape the product
- how Pulse should handle X listening costs and official API tiers

Leaving these undecided makes engineering slices harder to judge. It also risks
building a commodity scheduler instead of the serious X automation product the
repo is now targeting.

## Decision

Hosted Pulse is the canonical production product.

Stripe billing, first-party auth, SQL runtime state, usage events, audit events,
safety controls, durable jobs, and provider boundaries are canonical product
infrastructure. They are not temporary hosted-only experiments.

Self-hosted Pulse is not a launch-supported SaaS product tier during this
rehaul. Existing JSON/YAML and local compatibility paths may remain as migration,
development, backup, and rollback affordances, but customer-ready production
support targets the hosted product first.

The first ICP is agencies and multi-brand X operators managing client accounts.
B2B founders can be served by the same product at lower scale, but they should
not pull the roadmap away from agency-grade controls. Crypto-native X teams are
a secondary fit only when they accept the same safety posture.

The customer-facing commercial model is subscription plus included automation
and metered overage. Internally, Pulse keeps durable usage events for provider
cost and safety accounting. Externally, the product should avoid presenting a
low-trust commodity "credits only" model as the primary offer.

Initial pricing direction:

- Solo: about $49/month for one brand, draft-first, low included usage
- Studio: about $199/month for up to five brands and approval workflows
- Agency: about $699/month for up to twenty brands, RBAC, audit logs, client
  workflows, and higher included usage
- Enterprise: custom, SSO/SLA, official X Enterprise listening, dedicated
  support or infrastructure

X writes use official OAuth-backed APIs wherever possible. Listening and
discovery stay behind the `ListeningProvider` boundary with explicit risk and
cost labels. Pulse may use Serper, ClawNet, or other providers during migration,
but high-volume real-time listening and enterprise claims require an explicit
official X tier or a reviewed provider contract.

## Consequences

- Runtime state migrations should treat SQL as the hosted canonical store while
  preserving JSON/YAML import/export until rollback and migration risk is gone.
- Billing work should enforce plan entitlements, included usage, and overage
  policy instead of reviving ClawNet-style credits as the primary product model.
- UI and reporting work should prioritize multi-brand agency workflows: roles,
  approvals, auditability, account health, client reports, and safety controls.
- Self-host compatibility bugs should not block hosted launch unless they affect
  migration, backup/restore, or rollback paths.
- X listening provider selection remains a launch risk to validate before
  making real-time or high-volume claims to customers.

## Related

- `docs/proposals/standalone-premium-pulse.md`
- `docs/proposals/standalone-premium-pulse-execution-checklist.md`
- `docs/decisions/ADR-0005-standalone-premium-pulse.md`
- `docs/decisions/ADR-0007-stripe-billing-and-usage-metering.md`
- `docs/decisions/ADR-0008-x-access-policy.md`
- `docs/decisions/ADR-0009-runtime-state-moves-to-sql.md`
