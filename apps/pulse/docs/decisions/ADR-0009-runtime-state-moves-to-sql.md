# ADR-0009: Runtime State Moves To SQL

Status: accepted

## Context

Pulse currently stores important runtime state in a mix of hosted SQLite,
tenant JSON files, YAML config, per-agent JSON files, process memory, and a
global CRM SQLite database. That shape is hard to scale, hard to audit, and
risky for multi-brand agency use.

## Decision

Move runtime-critical state to SQL-backed repositories.

JSON and YAML should remain useful as import/export and self-host compatibility
formats, but should not be the canonical concurrent runtime store for hosted
Pulse.

## Consequences

- Chat, memory, brand profile, jobs, content queues, usage, spend caps, rate
  limits, audit events, and safety events should be SQL-backed.
- A repository layer should hide whether the immediate backend is SQLite or
  Postgres.
- A future Postgres migration should be planned before multi-node production
  scale.

## Related

- `docs/proposals/standalone-premium-pulse.md`
