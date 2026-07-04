# Standalone Premium Pulse Execution Checklist

Status: draft

This is the execution checklist for `standalone-premium-pulse.md`.

Use this as the parent implementation plan. Each checkbox should become an
issue or small PR slice before code changes. Larger slices can run in parallel
only when they have disjoint ownership and their risk gates are clear.

## Agent Operating Model

Use two planning/review tracks for serious slices:

- Claude Opus: proposal shape, migration narrative, product risk, high-level
  architecture review
- GPT-5.5: implementation plan, test design, threat modeling, adversarial code
  review

For each slice:

1. Author agent writes scope, implementation, tests, and rollback note.
2. Challenger agent checks tenant isolation, idempotency, migration reversibility,
   auditability, safety posture, and behavior preservation.
3. Merge only after verification passes and the relevant risk gate is satisfied.

## Safe Slice Rules

- [x] Wrap before moving behavior.
  - [x] Provider seams landed before cutover behavior: auth provider,
        billing provider, listening/search provider, billing-operation, usage
        event, durable scheduler, and operations-report boundaries.
- [x] Feature-flag behavior changes.
  - [x] `AUTH_PROVIDER`, `BILLING_PROVIDER`, `SCHEDULER_MODE`, and
        `PULSE_DURABLE_SCHEDULER_WRITES` gate standalone paths.
- [x] Use expand -> migrate -> contract for persistence changes.
  - [x] SQL tables and repositories were added while JSON/YAML compatibility
        stayed available for local development, migration, backup, and rollback.
- [x] Keep one boundary per PR.
  - [x] Completed slices stayed scoped by boundary: auth/session, billing,
        usage events, durable scheduler, audit/safety, UI operations, and docs.
- [x] Add characterization tests before risky refactors.
  - [x] Characterization coverage exists for billing, sessions, hosted routes,
        scheduler behavior, usage hooks, chat tool policy, tenant isolation, and
        production readiness.
- [x] Default flags preserve current behavior until a cutover is explicitly
      approved.
  - [x] Default auth/billing providers remain legacy rollback paths while
        production readiness requires first-party auth and Stripe for customer
        launch.
- [x] Every account-affecting action eventually emits an audit event.
  - [x] Audit event storage, export, operations UI, chat tool policy logging,
        settings/tool mutations, and privacy requests are covered by tests.
- [x] Every billable action eventually emits a durable usage event.
  - [x] Durable scoped usage events and hooks cover LLM, listening, X write,
        image, and scheduler paths with explicit idempotency.
  - [x] Added architecture guard so new source files cannot import raw
        `deductPulseCredits` directly; ClawNet deductions must stay behind the
        billing provider and idempotent billing-operation layer.

## Wave 0: Governance And Safety Gate

Do this before large implementation.

- [x] Confirm correct GitHub remote and branch strategy.
- [x] Decide whether current local commits should move to `claw-net/pulse`.
- [x] Accept, revise, or reject ADR-0005 through ADR-0009.
- [x] Add and resolve ADR-0010 for premium X safety posture.
- [x] Reconcile AGENTS stack rules with accepted ADRs.
- [x] Decide whether Stripe and SQL runtime state are hosted-only or canonical.
  - ADR-0012 makes hosted SQL runtime state and Stripe canonical product
    infrastructure for standalone production.
- [x] Decide whether ClawNet can remain a transitional hidden listening provider.
- [x] Decide whether self-hosted Pulse remains supported during the SaaS rehaul.
  - ADR-0012 does not make self-host a launch-supported SaaS tier; JSON/YAML
    compatibility remains for migration, development, backup, and rollback.
- [x] Decide customer-facing usage unit: credits, actions, included automation,
      transparent provider cost, or subscription plus overage.
  - ADR-0012 chooses subscription plus included automation and metered overage,
    backed internally by durable usage events.
- [x] Decide first ICP to validate: agency, B2B founder, or crypto-native X team.
  - ADR-0012 chooses agencies and multi-brand X operators as the first ICP.
- [x] Decide X listening economics and official X tier posture.
  - ADR-0012 keeps listening provider risk/cost labels and requires official X
    tier or reviewed provider contracts before high-volume real-time claims.
- [x] Decide runtime stack posture and Rust migration seam.
  - ADR-0011 keeps TypeScript as the standalone launch stack and defers Rust to
    a measured worker/runtime seam instead of a wholesale rewrite.

### Wave 0 Characterization Tests

- [x] Billing cost calculation and current ClawNet deduction behavior.
- [x] Scheduler task routing and due-task marking.
- [x] Chat tag parsing and current mutations.
- [x] Tenant isolation for secrets, state, chat, CRM, and active agent.
  - [x] Characterize chat, CRM, and active-agent isolation by tenant data directory.
  - [x] Characterize `withTenantContext()` secret, config-path, and sequential JSON state isolation by tenant.
  - [x] Make `src/core/state.ts` and `src/core/persona.ts` prefer AsyncLocalStorage tenant context, so overlapping tenant contexts do not mutate process-global data/config paths.
- [x] X write payload generation and OAuth header behavior.
- [x] Listening/search behavior including Serper fallback and real-time supplement.

Verification:

- [x] `npm run typecheck`
- [x] `npm test`
- [x] Document any behavior that cannot be characterized without refactoring.

## Wave 1: Parallel Foundations

These can run in parallel after Wave 0 because they should be additive or
behavior-preserving.

### WS-A: Provider Boundaries

Goal: make provider dependencies replaceable before changing providers.

- [x] Add `ListeningProvider` facade around current web search and ClawNet
      real-time X supplement.
- [x] Migrate remaining listening call sites through `ListeningProvider`.
- [x] Add listening provider risk label and cost profile.
- [x] Add `XWriteClient` around post, reply, like, media upload, and alt text.
- [x] Route X write call sites through `XWriteClient`.
- [x] Add `LLMProvider` boundary and usage metadata hook.
- [x] Add `ImageProvider` boundary around generated media.
- [x] Add lint or test guard against direct imports that bypass provider seams.

Likely files:

- `src/core/listening.ts`
- `src/core/search.ts`
- `src/core/clawnet-client.ts`
- `src/platforms/x.ts`
- `src/platforms/x-follow.ts`
- `src/core/llm.ts`
- `src/intelligence/image-gen.ts`
- `src/core/opportunity-engine.ts`
- `src/intelligence/auto-research.ts`
- `src/intelligence/mention-detector.ts`
- `src/intelligence/engagement-monitor.ts`
- `src/intelligence/thread-analyzer.ts`

Risk gates:

- [x] No behavior change in provider-wrapper PRs.
  - [x] Current provider-boundary characterization remains green in
        `tests/architecture/provider-boundaries.test.ts`,
        `tests/core/listening.test.ts`, `tests/platforms/x-write-client.test.ts`,
        `tests/core/llm-provider.test.ts`, and
        `tests/intelligence/image-provider.test.ts`.
- [x] No new follow/unfollow automation.
  - [x] ADR-0010 remains accepted, hosted follow/unfollow churn is disabled by
        default, and the full suite passes after the provider-boundary work.
- [x] Listening provider clearly separates official writes from risk-labeled
      listening.
  - [x] `ListeningProvider` exposes listening risk/cost metadata while X writes
        remain behind `XWriteClient`; covered by provider-boundary tests.

### WS-B: Identity And Brand Model

Goal: add standalone org/user/brand model without switching auth yet.

- [x] Add additive schema for `orgs`, `users`, `memberships`, `workspaces`,
      `brands`, and `brand_connections`.
- [x] Add repositories for new entities.
- [x] Add tenant-to-org and agent-to-brand migration source helpers.
- [x] Add role model: owner, admin, approver, operator, viewer.
- [x] Add RBAC helper without enforcing it globally.

Likely files:

- `hosted/db.ts`
- `hosted/context.ts`
- `hosted/tenant.ts`
- new `hosted/identity/*`
- new `hosted/repositories/*`

Risk gates:

- [x] Additive only.
  - [x] Identity tables, repositories, and role helpers are additive and preserve
        legacy tenant/auth data.
- [x] No auth route cutover.
  - [x] `AUTH_PROVIDER` keeps `clawnet` as the default rollback path; first-party
        auth is mounted only when explicitly enabled.
- [x] Existing ClawNet auth tests remain green.
  - [x] Full suite passed after first-party auth and role-permission work,
        including `tests/hosted/auth.test.ts`.

### WS-C: Audit And Safety Foundation

Goal: create the event trail before mutating more product state.

- [x] Add `audit_events` table and helper.
- [x] Add `safety_events` table and helper.
- [x] Add reusable scope fields: org, workspace, brand, actor, source.
- [x] Wire audit helper into one low-risk setting mutation as proof.
- [x] Add tests for event creation and scope isolation.

Likely files:

- `hosted/db.ts`
- new `hosted/audit.ts`
- new `hosted/safety.ts`
- selected low-risk route in `hosted/server.ts`

Risk gates:

- [x] No account-affecting cutover depends on audit later; audit lands first.
  - [x] `audit_events` and scoped helpers landed before standalone role/tool
        enforcement, and chat tool mutations log accepted/rejected decisions in
        `tests/hosted/chat-tool-policy.test.ts`.

### WS-D: Repository Layer Preparation

Goal: create a storage seam before moving JSON/YAML state.

- [x] Add SQL repository conventions.
- [x] Add test helpers for isolated temp databases.
- [x] Add repository interfaces for brand-scoped reads/writes.
- [x] Document SQLite-now/Postgres-later constraints.

Likely files:

- `hosted/db.ts`
- new `hosted/repositories/*`
- tests under `tests/hosted/`

Risk gates:

- [x] No destructive migration.
  - [x] Runtime SQL tables/repositories were added through additive migrations;
        rollback keeps JSON/YAML compatibility documented in
        `docs/operations/migration-rollback.md`.
- [x] No runtime reads switched until parity tests exist.
  - [x] Runtime approval queue, content queue, action log, profile export, and
        import/export paths have parity coverage before read-fallback/cutover
        behavior.

## Wave 2: Standalone Control Plane

### WS-E: First-Party Auth Behind Flag

- [x] Add `AUTH_PROVIDER=clawnet|firstparty`.
- [x] Add sessions table.
- [x] Add session cookie, CSRF token, origin, and TTL helper tests.
- [x] Add first-party email/password helper foundation.
- [x] Add first-party auth route-handler foundation.
- [x] Add first-party email/password or passkey route flow.
- [x] Fold PIN/OTP into standalone session posture.
  - [x] Keep legacy PIN gate and OTP recovery on ClawNet cookie sessions only; standalone first-party sessions stay on `pulse_session` + CSRF without consulting `pulse_pin_verified`.
- [x] Keep ClawNet auth as default until cutover.
- [x] Add CSRF/session fixation/cookie security tests.

Likely files:

- `hosted/auth.ts`
- `hosted/server.ts`
- `hosted/db.ts`
- `hosted/ui/src/hooks/useAuth.tsx`

Risk gates:

- [x] No production auth switch without rollback flag.
- [x] Cross-org denial test exists.

### WS-F: Usage Events And Billing

- [x] Add `usage_events` with unique idempotency key.
- [x] Emit usage events from LLM, listening, X write, image, and scheduler paths.
  - [x] Characterize hosted LLM usage hook installation through the provider path with durable persistence, retry idempotency, and uninstall behavior in `tests/hosted/usage-hooks.test.ts`.
  - [x] Characterize hosted image usage hook installation through the provider path with durable persistence, retry idempotency, and uninstall behavior in `tests/hosted/usage-hooks.test.ts`.
  - [x] Emit durable usage events from listening provider X realtime/profile reads and X write post/reply paths when callers provide explicit operation IDs.
  - [x] Emit durable usage events for completed scheduler monitor jobs with stable idempotency keyed to the scheduler job bucket.
  - [x] Emit durable usage events for successful legacy scheduler outreach, content, discovery, adaptation, and monitor tasks.
- [x] Move spend caps and cooldowns from memory maps to persistent storage.
- [x] Persist idempotency keys before external billing calls.
- [x] Add Stripe tables and webhook skeleton.
- [x] Add `BILLING_PROVIDER=clawnet|stripe`.
- [x] Add entitlements derived from subscriptions.
- [x] Enable Stripe billing provider against durable subscription entitlements
      while preserving idempotent billing operations and spend-ledger records.
- [x] Add reconciliation job.

Likely files:

- `hosted/billing.ts`
- `hosted/limits.ts`
- `hosted/db.ts`
- new `hosted/billing/*`
- provider wrappers from WS-A

Risk gates:

- [x] No double billing under retry.
- [x] Scheduler-generated work is metered.
- [x] Stripe fails closed without an active/trialing subscription entitlement.

## Wave 3: State Consolidation

### WS-G: Chat State To SQL

- [x] Move hosted chat conversations/messages out of global CRM DB.
- [x] Scope chat by tenant data directory and agent.
- [x] Preserve ordering, archive, reset, and export behavior.
  - [x] Preserve ordering, archive, reset, and export-tag behavior for tenant-scoped chat state.
  - [x] Characterize current export path narrowly: chat state stores the assistant reply without `[EXPORT_PROFILE]`, returns an `export_profile` action, and leaves payload generation to the hosted server response path.
- [x] Keep self-host compatibility path if still supported.
  - [x] Characterize self-host data-dir chat compatibility: reset archives only
        the active agent's conversation and keeps other agent conversations
        active in the same CRM database.

Likely files:

- `hosted/pages/chat-setup.ts`
- `hosted/server.ts`
- `hosted/db.ts`
- `src/crm/database.ts`

Risk gates:

- [x] Tenant/brand isolation tests pass.

### WS-H: Brand Memory To SQL

- [x] Move brand profile to SQL repository with JSON fallback.
- [x] Move knowledge notes to SQL.
- [x] Add source links, lock state, priority, and version fields.
- [x] Add import/export parity tests.
  - Added additive hosted SQL tables/repositories for brand profiles and
    knowledge notes. Current runtime reads remain on JSON until parity-backed
    cutover tests exist.
  - [x] Add structured privacy export parity coverage for hosted brand profiles
        and knowledge notes, preserving source, actor, lock state, version,
        confidence, decay, timestamps, profile JSON, and tags.
  - [x] Add a dedicated structured import path for hosted brand-memory export
        payloads through `/api/profile/import`, preserving profile/note
        metadata for matching hosted brand rows while leaving legacy self-host
        profile imports unchanged.
  - [x] Add hosted privacy export/import round-trip coverage proving note
        imports do not rewrite canonical structured brand profile payloads.

Likely files:

- `src/intelligence/brand-profile.ts`
- `hosted/pages/chat-setup.ts`
- `hosted/db.ts`
- `src/core/agent-state.ts`

Risk gates:

- [x] Brand profile remains source of truth.
- [x] Locked notes cannot be mutated by chat tools.

### WS-I: Runtime State To SQL

- [x] Move approval queue and content queue.
  - [x] Add additive `runtime_approval_queue` repository/table with org/workspace/brand/agent/tenant scope and parity tests; JSON approval queue reads remain primary.
  - [x] Add bounded hosted approval-queue dual-write/read fallback: `addToQueue()` and approval status mutations still persist JSON first for rollback/import-export compatibility, hosted reads prefer brand-scoped SQL when a legacy tenant/agent mapping resolves, and fall back to JSON when scope or SQL data is unavailable.
  - [x] Add bounded hosted autopost queue dual-write/read fallback: direct
        `autopost-queue` mutations still persist JSON first for rollback, while
        hosted reads and approval/edit/publish cleanup prefer brand-scoped
        `runtime_approval_queue` rows for `item_type = autopost` when scope
        resolves.
  - [x] Add additive `runtime_content_queue` repository/table with org/workspace/brand/agent/tenant scope and parity tests; self-hosted CRM queue remains intact.
  - [x] Add bounded hosted content-queue dual-write/read fallback: content queue mutations keep the tenant CRM path for self-host and compatibility, hosted reads prefer brand-scoped SQL when a legacy tenant/agent mapping resolves, and fall back to the tenant CRM queue when scope or SQL data is unavailable.
- [x] Move action log.
  - [x] Add additive `runtime_action_logs` repository/table with org/workspace/brand/agent scope and parity tests; JSON reads remain primary. Rollback: stop using the repo and retain JSON files until a later dual-write cutover is approved.
  - [x] Add bounded hosted action-log dual-write/read fallback: `logAction()` persists JSON first for rollback/import-export compatibility, hosted `getActions()` prefers brand-scoped SQL when a legacy tenant/agent mapping resolves, and falls back to JSON when scope or SQL data is unavailable.
- [x] Move schedule state.
  - [x] Hosted scheduler task completion state persists in `runtime_schedule_state` by tenant/agent/task; self-hosted mode retains JSON fallback.
- [x] Move outreach dedup.
  - [x] Hosted outreach replied-id dedup persists in `runtime_outreach_dedup` by tenant/agent/platform; JSON remains fallback for self-hosted counters and compatibility.
- [x] Move X rate counters.
  - [x] Hosted X post/reply monthly counters persist in `runtime_x_rate_counters` by tenant/account/month; self-hosted mode retains JSON fallback.
- [x] Keep JSON/YAML import/export compatibility.
  - [x] Include hosted SQL runtime state in structured privacy export:
        approval queue, content queue, action logs, schedule state, outreach
        dedup, X rate counters, and X write operation receipts with tenant
        isolation coverage.
  - [x] Add runtime export-shape parity tests for approval queue, content
        queue, and action logs so hosted privacy exports can still be
        projected back into the legacy JSON runtime shapes used for
        rollback/import-export workflows.
  - [x] Add hosted privacy export/import round-trip restore for runtime action
        logs, approval queue, content queue, schedule state, outreach dedup,
        and X rate counters through `/api/profile/import`.

Likely files:

- `src/core/state.ts`
- `src/core/scheduler.ts`
- `src/intelligence/approval-queue.ts`
- `src/intelligence/content-queue.ts`
- `src/modes/autopost.ts`
- `src/modes/outreach.ts`

Risk gates:

- [x] Dual-write parity before read switch.
  - [x] Approval queue, autopost approval queue, content queue, and action log
        have dual-write/read-fallback tests before any contract-only SQL read
        switch.
  - [x] Schedule state, outreach dedup, and X rate counters have scoped SQL
        repository parity coverage and self-host JSON fallback remains intact.
- [x] Backup before contract step.
  - [x] Document runtime-state export coverage and the remaining structured
        runtime restore seam in backup/privacy runbooks.
  - [x] Replace the runtime restore seam with a structured hosted privacy
        export/import round-trip for runtime SQL tables; full DB backups remain
        the rollback path for secrets and non-importable receipts.

## Wave 4: Memory And Typed Tools

### WS-J: Typed Chat Tools

- [x] Define schemas for all current chat tool actions.
- [x] Parse existing tags into typed tool calls as an intermediate step.
- [x] Whitelist allowed `UPDATE_SETTING` paths.
- [x] Add policy checks by org/workspace/brand/role.
  - [x] First-party chat tool permissions only apply when the session org matches the tenant's mapped org; cross-org sessions fall back to viewer policy while preserving audit scope.
- [x] Add dry-run output.
- [x] Wire hosted chat route to server-side policy and audit context.
- [x] Require confirmation for high-impact mutations.
- [x] Log every mutating tool call to audit events.
- [x] Replace prompt contract with typed tools when the intermediate layer is
      proven.
  - [x] Hosted chat now instructs models to emit a typed `pulse-tools` JSON
        tool-call block; legacy bracket tags remain parseable only for rollback
        compatibility and old stored/prompted replies.

Likely files:

- `hosted/pages/chat-setup.ts`
- `hosted/server.ts`
- new `hosted/chat-tools.ts`
- `src/intelligence/input-sanitizer.ts`

Risk gates:

- [x] Prompt injection cannot mutate state without policy passing.
- [x] Invalid JSON and path traversal are rejected.

### WS-K: Memory Retrieval

- [x] Define memory layers: identity, locked rules, knowledge, preferences,
      episodic, operational.
  - [x] Add hosted repository retrieval foundation for identity, locked rules,
        knowledge, preferences, and operational layers.
- [x] Add source-linked memory records.
  - [x] Preserve source and actor metadata on durable retrieval records.
- [x] Add confidence and decay for inferred preferences.
  - [x] Use confidence plus decay-aware ordering in repository retrieval
        helpers.
- [x] Add contradiction detection.
  - [x] Add bounded repository contradiction matching for title/topic overlap,
        negation conflicts, and manual-vs-automatic operational clashes.
- [x] Add retrieval only for dedup, voice exemplars, and relevance context.
  - [x] Add bounded repository helpers for dedup, voice exemplars, and
        relevance context without prompt wiring.
  - [x] Wire hosted chat setup context to tenant/agent-scoped SQL brand-memory
        retrieval with JSON knowledge-note fallback and cross-brand non-leak
        coverage.
  - [x] Wire hosted autopost knowledge context to tenant/agent-scoped SQL
        brand-memory retrieval, with tenant data-dir `knowledge.md` fallback
        for self-host and legacy compatibility.

Risk gates:

- [x] Memory does not overwrite locked rules.
- [x] Source and actor are retained for every durable memory.
- [x] Explicit knowledge-note ids cannot mutate memory across brand scopes.

## Wave 5: Durable Runtime

### WS-L: Jobs And Worker

- [x] Add `jobs` table with status, run_at, lease_until, attempts, last_error,
      idempotency_key, and dead-letter state.
- [x] Add enqueue, lease, complete, retry, and dead-letter repository functions.
- [x] Add worker loop behind `SCHEDULER_MODE=legacy|durable`.
- [x] Add durable monitor task bridge.
- [x] Migrate one task type at a time.
  - [x] Keep content/outreach on the legacy runner until `runAutopost` and `runOutreach` can thread scheduler-job-derived X write operation IDs and retry-safe local state transitions; enforce that guardrail in durable scheduler tests.
  - [x] Add hosted `x_write_operations` ledger and `XWriteClient`
        idempotency hook foundation so scheduler-originated X post/reply/like
        attempts are recorded before external calls, successful retries reuse
        existing receipts, and in-flight/ambiguous attempts block until
        reconciliation.
  - [x] Add durable scheduler crash-replay tests for content/outreach on top of
        the `x_write_operations` ledger before enabling durable execution for
        those write tasks.
  - [x] Add explicit `PULSE_DURABLE_SCHEDULER_WRITES=true` gate for durable
        content/outreach execution; strict customer launch now fails until that
        gate and a real domain are present, and passes when both are supplied.
- [x] Add per-brand fairness and quiet hours.
  - [x] Ship deterministic brand fairness/quota helper and quiet-hours guard as additive scheduler write helpers behind `SCHEDULER_WS_L_WRITE_GUARDS`.
- [x] Add crash/retry tests.

Likely files:

- `hosted/scheduler.ts`
- `src/core/scheduler.ts`
- new `hosted/jobs.ts`
- `hosted/db.ts`

Risk gates:

- [x] Restart cannot duplicate posts or charges.
  - [x] Characterize durable worker crash/retry with stable job-derived side-effect keys so a replayed job cannot create a second post or a second billing charge in `tests/hosted/job-worker.test.ts`.
  - [x] Keep billing-operation retries idempotent across persisted `pending`, `succeeded`, and explicit retry states in `tests/hosted/billing-operations.test.ts`.
- [x] Old scheduler remains rollback path until durable mode is proven.

### WS-M: X Safety And Account Protection

- [x] Add persistent rate buckets.
- [x] Add safety circuit breakers for repeated 401, 403, 429, and anomaly events.
- [x] Add global kill switch and per-brand pause.
- [x] Disable follow/unfollow churn by default.
- [x] Remove follow/unfollow from canonical hosted scheduler path after ADR-0010.
- [x] Gate hosted live autopilot post/reply endpoints on explicit Full Auto mode.
- [x] Make autopilot opt-in, capped, monitored, and reversible.
  - [x] Add explicit hosted autopilot pause/resume helpers backed by durable `autopilot_pause` safety controls so reversals do not clear manual brand pauses.
  - [x] Auto-pause hosted autopilot when Full Auto encounters an active X write circuit breaker; require explicit resume so the stop is durable and reversible.

Likely files:

- `hosted/limits.ts`
- `hosted/scheduler.ts`
- `src/platforms/x.ts`
- `src/core/follow-engine.ts`
- `src/core/unfollow-cron.ts`
- `src/intelligence/mention-detector.ts`
- `src/core/opportunity-engine.ts`

Risk gates:

- [x] No autonomous write bypasses account health.
- [x] Draft mode remains default.

## Wave 6: Premium Agency Surface

- [x] Multi-brand workspace UI.
- [x] Roles and approval workflow UI.
- [x] Audit log UI.
- [x] Usage and provider cost visibility.
- [x] Safety dashboard.
- [x] Account health and connection status.
- [x] Client-ready export/reporting.

Likely files:

- `hosted/ui/src/pages/*`
- `hosted/ui/src/lib/api.ts`
- `hosted/server.ts`

Verification:

- [x] `npm run build:ui`
- [x] CI-safe hosted route/API production-surface characterization in
      `tests/hosted/ui-production-surface.test.ts`
- [x] role-based e2e smoke tests
  - [x] Added CI-safe role smoke coverage for ClawNet rollback owner
        permissions, first-party missing-session fail-closed behavior,
        approver draft controls, and cross-tenant-org denial in
        `tests/hosted/account-permissions.test.ts`.

## Wave 7: Migration, Docs, And Release

- [x] Supersede or narrow ADR-0002 after ADR-0005 is accepted.
- [x] Update canonical docs from ClawNet-backed truth to standalone truth.
- [x] Update config docs for provider flags.
- [x] Add migration scripts and rollback docs.
- [x] Add backup/restore runbook.
- [x] Add GDPR export/delete path.
- [x] Add production-readiness checklist.
  - [x] Add `PULSE_CUSTOMER_LAUNCH=true` strict mode so final customer cutover
        fails closed while placeholder/ClawNet domains, non-standalone
        auth/billing, or disabled durable content/outreach writes remain.
- [x] Fix GitHub remote/source-of-truth mismatch before push.

Likely files:

- `docs/overview.md`
- `docs/architecture/*`
- `docs/reference/*`
- `docs/operations/*`
- `scripts/*`

Risk gates:

- [x] Docs match shipped behavior.
- [ ] No production deploy until remote/branch truth is resolved.
  - Repo-visible truth is narrowed to `origin=https://github.com/hey-vera/pulse.git`
    and local `master` tracking `origin/master`. `git ls-remote --symref origin
    HEAD` reports `refs/heads/master` as the remote default branch, but this
    workspace is not logged into `gh`, so it cannot verify GitHub
    branch-protection state, production-environment review rules, or the
    meaning/resolution of prior rule-bypass notices on pushes to
    `hey-vera/pulse` `master`. The gate stays open until that is confirmed
    outside the repo.
  - [ ] Remove the checked-in production deploy workflow's arbitrary branch
        input or enforce default-branch-only deploys in GitHub. A second local
        attempt was rejected because the current OAuth token lacks `workflow`
        scope.
  - [x] Add production-readiness guard for arbitrary production deploy branch
        selection so `npm run check:production` fails with
        `UNSAFE_PRODUCTION_DEPLOY_BRANCH_INPUT` until the workflow is pinned to
        the protected default branch.
  - [x] Add a server-side deploy branch allowlist so `scripts/deploy.sh`
        validates the target branch and allows only `master` or `main` by
        default unless an operator explicitly sets a reviewed override.
  - [x] Add ready-to-apply patch artifact at
        `docs/operations/deploy-production-pin.patch`; temporary local
        application of that patch makes strict customer-launch
        `npm run check:production` pass with production-shaped environment
        values. It remains unapplied in the repo because pushing
        `.github/workflows/deploy-production.yml` requires GitHub `workflow`
        scope.
  - [x] Add `npm run check:production-deploy-patch` so the workflow-scope patch
        can be verified without modifying the checked-in workflow file.

### Legacy Agent System Decommission

- [x] Do not delete the legacy file-backed agent system until hosted brand
      runtime context is explicit.
  - [x] Audit current legacy dependencies and confirm `src/core/agents.ts` and
        `src/core/agent-state.ts` still scope hosted brand selection, scheduler
        execution, and runtime state.
  - [x] Add an architecture guard freezing the current direct import inventory
        so new runtime code cannot deepen the dependency while the migration is
        underway.
  - [x] Introduce a compatibility boundary for current brand runtime context:
        tenant, org, workspace, brand, legacy agent id, and selected runtime
        config.
    - [x] Add initial hosted brand runtime resolver for tenant/legacy-agent to
          SQL brand scope and route hosted brand-memory scope through it.
    - [x] Consolidate runtime action-log, approval-queue, and content-queue
          tenant/legacy-agent scope resolution onto the hosted brand runtime
          resolver.
    - [x] Route chat-tool audit scope, account permissions, and Stripe billing
          subject resolution through the hosted tenant runtime resolver while
          preserving org-only fallback.
    - [x] Add hosted brand runtime context enumeration and use it for hosted
          brand-memory/profile import scope validation.
  - [x] Migrate hosted list/create/delete/switch/toggle-running behavior from
        file-backed agent presets to SQL-backed brands while keeping `/api/agents`
        as a temporary UI compatibility shim.
    - [x] Dual-write hosted agent creation into SQL org/workspace/brand runtime
          context so new brands have standalone rows while `/api/agents` remains
          file-backed for compatibility.
    - [x] Dual-write hosted agent running/deleted compatibility state into SQL
          brand runtime fields so later `/api/agents` reads can move without
          losing scheduler opt-in or deletion semantics.
    - [x] Backfill SQL brand runtime rows from existing file-backed agents
          during `/api/agents` reads before flipping the compatibility shim to
          SQL-first reads.
    - [x] Make `/api/agents` list return a SQL-first compatibility view:
          SQL brand rows define visible agents and runtime state, while legacy
          file presets only enrich fields not yet modeled in SQL.
    - [x] Make `/api/agents` delete/switch/toggle-running validate against SQL
          brand runtime context first, while preserving file preset mutation
          when the legacy row still exists.
    - [x] Persist `/api/agents` active selection in SQL tenant runtime context
          and stop hosted create/switch from rewriting `pulse.yaml`, leaving the
          legacy active-agent file as a compatibility side effect only.
    - [x] Route the legacy hosted HTML shell and `/api/agents` through a shared
          SQL-first agent compatibility read boundary so layout selection no
          longer reads file-backed agents directly.
    - [x] Add SQL runtime config payload storage on brand rows and dual-write
          hosted agent create/backfill data into it, so compatibility views can
          use SQL-owned persona/config fields before legacy preset enrichment.
    - [x] Stop hosted create/switch from writing the legacy active-agent file,
          and only use that file for one-time selection migration when SQL has
          no selected runtime agent yet.
    - [x] Stop hosted agent create from writing a legacy file preset; created
          agents now persist through SQL brand runtime context and config
          payload only.
    - [x] Stop hosted delete/toggle-running from mutating legacy file presets;
          legacy file backfill now seeds SQL only for missing rows and cannot
          revive deleted rows or overwrite SQL runtime state.
    - [x] Route hosted account/connection settings persistence into SQL runtime
          config payloads instead of saving them to the active legacy preset.
    - [x] Centralize the remaining hosted legacy file-preset reads behind an
          explicit migration boundary so server routes and schedulers no longer
          import the file-backed agent store directly.
    - [x] Route the hosted runtime-agent self-host fallback through the same
          migration boundary so hosted runtime state has one legacy preset
          contact point.
    - [x] Add `/api/brands` as the primary hosted runtime brand route set and
          move hosted UI callers to it, leaving `/api/agents` only as a
          temporary compatibility alias.
    - [x] Remove the hosted `/api/agents` compatibility alias after all hosted
          UI callers moved to `/api/brands`.
    - [x] Make hosted legacy file-preset backfill opt-in via
          `PULSE_ENABLE_LEGACY_AGENT_BACKFILL=true`, so normal runtime reads
          stay SQL-authoritative and do not touch file-backed agent presets.
    - [x] Remove hosted identity migration's type-only dependency on
          `src/core/agents.ts` by defining a local legacy migration input
          shape.
    - [x] Remove unused `src/core/agent-state.ts` compatibility wrapper after
          runtime code and tests moved to `src/core/runtime-agent-state.ts`.
    - [x] Remove the old self-host settings panel's direct file-backed agent
          preset editor dependency; the panel now shows read-only brand runtime
          identity from `pulse.yaml` while hosted brand management uses
          `/api/brands`.
    - [x] Inline the opt-in legacy JSON preset reader inside the migration
          boundary and remove the old `src/core/agents.ts` module.
    - [x] Delete the hosted legacy file-preset migration shim and remove
          server/scheduler backfill calls so hosted runtime brand state is
          SQL-only.
  - [x] Move scheduler execution off `listRunningAgents()` and
        `applyAgentToConfig()` so hosted work runs from explicit brand/runtime
        config without rewriting global `pulse.yaml`.
    - [x] Move hosted tenant scheduler agent enumeration off
          `listRunningAgents()` and onto SQL runtime-enabled brand contexts,
          with legacy file presets kept only as the current config-application
          compatibility source.
    - [x] Replace scheduler `applyAgentToConfig()` calls with an
          AsyncLocalStorage-scoped runtime config file so scheduled work no
          longer rewrites the tenant/global `pulse.yaml` before each agent run.
    - [x] Replace durable scheduler `applyAgentToConfig()` calls with the same
          scoped runtime config wrapper for queued monitor/content/outreach
          jobs.
    - [x] Let hosted and durable scheduler execution build scoped runtime config
          from SQL brand runtime payloads when the legacy file preset is absent.
    - [x] Remove durable scheduler's direct default dependency on the legacy
          file-backed agent preset store; compatibility preset resolution now
          exists only as an injected test/migration dependency.
    - [x] Remove hosted scheduler runtime config fallback reads from the legacy
          file-backed agent preset store; active scheduled work now builds
          runtime config from SQL brand payloads.
  - [x] Move remaining chat, memory, approval/content/action-log, knowledge
        context, profile export/import, and autopost state lookups to explicit
        brand scope.
    - [x] Add selected-agent async-local runtime context and route agent-state,
          knowledge-context, approval/content queue scope, autopost queue scope,
          topic discovery, brand-profile note fallback, and profile export/import
          note keys through it before falling back to the legacy active-agent
          file.
    - [x] Hydrate hosted request contexts from SQL selected-agent runtime state
          and route chat setup/history plus platform-setting audit scope through
          `currentAgentId()` instead of direct active-agent file reads.
    - [x] Move hosted route, chat setup, profile export/import, and scheduler
          state lookups off direct `src/core/agent-state.ts` imports and onto a
          hosted runtime-agent helper backed by SQL-selected tenant context.
    - [x] Move intelligence and autopost state lookups onto a runtime-agent
          state helper that resolves async-local brand context before optional
          legacy fallback, removing their direct `src/core/agent-state.ts`
          dependency.
  - [x] Rename remaining hosted UI "agent" copy/types to "brand" language
        where it does not conflict with runtime worker semantics.

## Wave 8: Compiled Runtime Decision

Do not start this until durable jobs exist and have real measurements.

- [x] Measure job throughput, memory, latency, duplicate-prevention behavior,
      queue depth, and per-brand fairness.
  - [x] Add local `npm run measure:durable-jobs` benchmark for synthetic durable
        job throughput, queue depth, attempts/dead letters, and RSS delta.
  - [x] Extend the local durable-job benchmark with tick p50/p95/max latency
        and idempotency duplicate-suppression reporting; baseline on
        2026-05-26 with `--jobs 1000 --workers 8`: 25.44 jobs/s, p95 42.99ms,
        0 dead, 8/8 duplicate enqueues suppressed, RSS +6.09MB.
  - [x] Add per-brand fairness reporting to the local durable-job benchmark;
        baseline on 2026-05-26 with `--jobs 1000 --workers 8`: 8 brands,
        expected 125 completions per brand, min 125, max 125, max skew 0,
        27.08 jobs/s, p95 41.59ms, 0 dead, RSS +9.99MB.
- [x] Decide TypeScript versus Go versus Rust for worker/control-plane seam.
  - ADR-0011 keeps the control plane in TypeScript and evaluates Rust only for a
    future measured worker/runtime seam.
- [x] If compiled runtime is chosen, extract only the worker/control-plane seam.
  - Not applicable for this launch decision: ADR-0011 keeps TypeScript as the
    production control plane and defers Rust to a later measured worker seam.
- [x] Do not rewrite intelligence/prompt/UI layers without a separate proposal.
  - Current backend work preserved the TypeScript intelligence/UI runtime; the
    chat prompt changed only to use the proven typed tool-call contract.

## Recommended First Parallel Batch

After Wave 0:

- [x] Track 1: migrate remaining listening call sites through `ListeningProvider`.
- [x] Track 2: add `XWriteClient` wrapper without changing behavior.
- [x] Track 3: add identity schema/repositories only.
- [x] Track 4: add `audit_events`/`safety_events` helpers only.
- [x] Track 5: add characterization tests for chat tag parsing and tenant
      isolation.

These tracks are large enough to move quickly and separated enough for safe
parallel work.
