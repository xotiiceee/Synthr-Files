# Pulse Migration And Rollback

Status: active runbook

Pulse migrations should follow expand, migrate, contract.

## Expand

- Add tables, columns, repositories, flags, or route handlers without switching
  runtime reads.
- Keep current behavior as the default.
- Add characterization or parity tests before changing the runtime path.

## Migrate

- Enable the new path behind an explicit flag.
- Prefer dual-write before read switching for runtime state.
- Add idempotency keys before any retryable external call.
- Record audit or usage events before relying on them for billing or compliance.

## Contract

- Remove old paths only after rollback is no longer needed.
- Document the date, commit, and verification that made the old path obsolete.
- Keep backups long enough to recover from delayed data issues.

## Current Rollback Flags

| Area         | Flag                       | Rollback value |
| ------------ | -------------------------- | -------------- |
| Auth         | `AUTH_PROVIDER`            | `clawnet`      |
| Billing      | `BILLING_PROVIDER`         | `clawnet`      |
| Scheduler    | `SCHEDULER_MODE`           | `legacy`       |
| Follow churn | `PULSE_ALLOW_FOLLOW_CHURN` | unset          |

## Release Gate

Before toggling a production flag:

1. `npm run typecheck`
2. `npm test`
3. `npm run build:ui`
4. `npm run check:production`
5. `npm run check:customer-launch` for final customer cutover flags
6. Take a backup using `docs/operations/backup-restore.md`
7. Record the current commit SHA and env flag values
