# ADR-0006: Standalone Identity And Brand Model

Status: accepted

## Context

Current hosted Pulse tenants are shaped around ClawNet API keys. That model does
not fit a standalone agency product where one organization can manage many
users, workspaces, brands, clients, approvals, and X connections.

## Decision

Use a first-party identity and account model:

- organization as the billing and ownership boundary
- workspace as an optional grouping boundary for teams or clients
- brand as the unit of automation, memory, X connection, jobs, safety events,
  usage, and audit logs
- user membership with RBAC roles
- first-party sessions instead of using a ClawNet API key as the product session

## Consequences

- Existing tenant tables become migration source data, not the long-term product
  model.
- All chat, memory, jobs, X credentials, content queues, and billing events must
  be brand-scoped and organization-owned.
- Agency features such as approvals, audit logs, and roles become canonical
  product requirements.

## Related

- `docs/proposals/standalone-premium-pulse.md`
