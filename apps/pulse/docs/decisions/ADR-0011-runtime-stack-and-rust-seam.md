# ADR-0011: Runtime Stack And Rust Seam

Status: accepted

## Context

Pulse is becoming a standalone, many-customer X automation product. The long-term
runtime must be efficient, restart-safe, observable, and trustworthy under
agency multi-brand load.

Rust is a strong candidate for CPU-bound, high-concurrency, correctness-heavy
runtime components. The current Pulse codebase, however, still has fast-moving
product logic in TypeScript: Hono routes, React UI, provider seams, prompt
assembly, chat tools, billing integration, and migration shims.

Rewriting broadly before behavior is stable would spend engineering time on
translation instead of reducing the current launch risks: billing idempotency,
job durability, tenant isolation, account safety, auditability, and deploy
truth.

## Decision

Keep TypeScript as the canonical product and control-plane stack for the
standalone launch.

Do not rewrite Pulse wholesale in Rust before production cutover.

Evaluate Rust only at a narrow worker/runtime seam after durable jobs have real
measurements. The candidate seam is:

- job leasing and worker execution
- idempotent X write orchestration
- rate-limit and quota enforcement
- usage metering and reconciliation workers
- CPU-heavy analysis that can be isolated behind a typed service boundary

The intelligence, prompt, chat, provider-integration, billing-webhook, and UI
layers remain TypeScript until a separate ADR proves a stronger reason to move
them.

## Required Evidence Before A Rust Extraction

- sustained job throughput under representative tenant and brand counts
- queue depth and lease contention under retry
- memory usage for hosted API and worker processes
- p50/p95/p99 latency for scheduler and X write execution
- duplicate-prevention behavior across restart, retry, and partial failure
- operational complexity estimate for build, deploy, logs, migrations, and local
  development
- clear interface contract that avoids sharing mutable product state across
  language boundaries

## Consequences

- Production readiness work stays focused on correctness and customer safety
  before language migration.
- Rust remains a serious option for the worker seam, not a blanket rewrite goal.
- The repository layer and durable job contracts must stay typed and narrow so a
  future Rust worker can consume them without importing product logic.
- Any compiled runtime extraction must preserve TypeScript rollback until the
  worker has parity tests and production measurements.

## Related

- `docs/proposals/standalone-premium-pulse.md`
- `docs/proposals/standalone-premium-pulse-execution-checklist.md`
- `docs/decisions/ADR-0009-runtime-state-moves-to-sql.md`
