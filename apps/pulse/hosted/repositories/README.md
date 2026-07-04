# Hosted SQL Repository Conventions

Pulse is SQLite-first for the standalone hosted control plane. Repositories
should keep SQL access explicit, scoped, and easy to port if a later Postgres
move is justified by load.

## Rules

- Keep persistence functions small and domain-named.
- Require the strongest available scope id on every read and write.
- Prefer idempotent `upsert` APIs for migration and external-event paths.
- Store provider payloads as JSON strings at the edge, not as untyped objects
  leaking through the app.
- Return database row shapes from repository functions unless a caller-specific
  DTO is clearly needed.
- Use additive migrations first; destructive contract steps require a separate
  migration script and rollback note.
- Add temp-database tests for every repository that mutates durable state.

## Current Scope Id Order

Use the narrowest scope available:

1. `brand_id`
2. `workspace_id`
3. `org_id`
4. `tenant_id` during legacy migration only

## Idempotency

External effects and migration writes need a stable natural key or explicit
idempotency key. Retry should not create duplicate billable events, duplicate
jobs, duplicate brands, or duplicate provider connections.

## SQLite Now, Postgres Later

SQLite is the current production foundation. Repository APIs should avoid
SQLite-only assumptions that would make a later Postgres move expensive:

- Keep transactions inside repository functions; do not leak connection-specific
  behavior to callers.
- Use explicit column lists on inserts and selects that back public repository
  contracts.
- Store timestamps as ISO strings at repository boundaries.
- Avoid depending on rowid ordering, SQLite date functions, or pragma behavior
  for product semantics.
- Keep JSON columns as serialized edge fields with tests for the decoded shape.
- Model concurrency through durable leases, unique keys, and idempotency keys,
  not process memory.

If Postgres becomes necessary, the intended migration path is to keep these
repository contracts stable, add a second adapter behind the same tests, then
move one bounded repository at a time.
