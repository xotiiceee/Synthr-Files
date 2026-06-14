# Standalone Premium Pulse

Status: accepted, execution mostly complete

The execution source of truth is
[`standalone-premium-pulse-execution-checklist.md`](standalone-premium-pulse-execution-checklist.md).
All implementation phases below have been completed or narrowed to the linked
checklist evidence. The remaining pre-launch blocker is external to this
proposal: production deploy workflow branch pinning requires a GitHub token with
`workflow` scope before final domain setup and end-to-end testing.

## Title

Standalone Premium Pulse: agency-grade X automation.

## Problem

Pulse is currently shaped as a ClawNet-backed product: auth, billing, credits,
X data, image generation, deploy assumptions, and docs all point back to
ClawNet. That is not the right foundation for a standalone customer-ready
product.

The current runtime also has scale and trust risks that matter more than
frontend polish:

- tenant execution still depends on legacy global state mutation
- runtime state is split across SQLite, JSON files, YAML files, and memory maps
- scheduler work is single-process and not durable
- spend caps and cooldowns reset on process restart
- chat can request product-state mutations through parsed LLM text tags
- agency accountability needs RBAC, audit logs, approvals, and per-brand safety

## Why Now

Pulse should move from "AI marketing agent attached to ClawNet" to "serious X
automation platform agencies can trust with client accounts." That requires
first-party product foundations before more UI polish or growth features.

## Broad Idea

Make Pulse a standalone, premium, X-only automation product for agencies and
multi-brand operators.

Pulse should not compete as a cheap post scheduler. It should sell controlled
automation: brand memory, safe discovery, draft/full-auto guardrails, approval
workflows, learning loops, per-client auditability, and account protection.

## What 10/10 Looks Like

- agencies can manage many brands from one workspace
- each brand has isolated X credentials, memory, settings, jobs, usage, and logs
- X writes use official OAuth-backed flows wherever possible
- listening/discovery is pluggable and clearly separated from writes
- draft mode is the default; autopilot is opt-in with hard guardrails
- every billable action is metered and auditable
- every account-affecting action has an audit trail
- memory is source-linked, versioned, scoped, and reversible
- scheduler work is durable, retryable, idempotent, and per-brand fair
- ClawNet is removed from product truth or demoted to an optional provider

## Fitness Check

- X-only vision fit: yes. This narrows Pulse around X automation and avoids
  broader social-platform claims.
- real user/operator need: agencies and multi-brand operators need safer,
  auditable automation more than another content calendar.
- security exposure: high. Pulse handles social credentials, billing, generated
  content, customer memory, and autonomous account actions.
- evidence this is needed now: current code embeds ClawNet auth/billing and has
  single-process state/runtime assumptions that block credible premium launch.
- keep / reshape / pause / remove: reshape. Keep the intelligence assets, but
  rebuild product foundations and runtime state.

## Evidence Ledger

- current status: standalone backend/control-plane foundation is implemented and
  tested behind explicit launch gates.
- upstream dependencies: ClawNet is demoted to an optional/transitional provider
  where configured; Soma/provenance remains optional product trust
  infrastructure, not a launch blocker.
- missing evidence: final standalone domain, real production secrets, GitHub
  production workflow branch pinning, and post-domain end-to-end launch test.
- blocks current work: no for repo-local backend work; yes for production deploy
  until the workflow branch-input gate is cleared.
- next gate: remove or pin the production deploy workflow branch input, then run
  final customer-launch readiness with the real domain and production secrets.
- terminal condition: shipped standalone Pulse with first-party auth/billing,
  per-brand durable runtime, docs/tests, rollout plan, pinned production deploy,
  final domain, and end-to-end launch verification.

## X-Only Check

Yes. Pulse remains X-only. Non-X surfaces stay non-canonical unless a future ADR
explicitly expands scope.

## Repo Ownership

- Pulse product truth: standalone X automation product, brand intelligence,
  memory, agency workflows, X runtime, hosted product docs.
- ClawNet platform truth: no longer canonical for Pulse auth, billing, deploy, or
  product model after the standalone ADR is accepted.
- Soma protocol truth: optional provenance/trust layer; protocol semantics stay
  outside Pulse.

## First Consumer

Primary ICP: agencies and multi-brand X operators managing client accounts.

Secondary ICPs:

- B2B founders who want high-trust X growth support
- crypto/native teams only if their needs fit X-only Pulse and do not force
  unsafe automation or protocol-first scope

## Positioning

Pulse is the X automation platform agencies trust with client accounts.

It is not a cheap scheduler. It is a controlled X growth operator with memory,
approval workflows, auditability, account protection, and learning loops.

## Pricing Direction

Pricing should reinforce premium trust and avoid commodity positioning.

- Solo: about $49/month for one brand, draft-first, low included usage
- Studio: about $199/month for up to five brands, approval workflows, small team
- Agency: about $699/month for up to twenty brands, RBAC, audit logs, BYO keys,
  client workflow, higher included usage
- Enterprise: custom, SSO, SLA, official X Enterprise listening, dedicated
  support or infrastructure

Usage should be metered for LLM, search/listening, image, and high-volume
automation costs. BYO provider keys can reduce metered cost but should be framed
as agency cost control, not a low-end product mode.

## Architecture Target

Keep TypeScript where product iteration matters:

- Hono API
- React/Vite UI
- prompts, brand intelligence, content generation, preference learning
- fast-changing product workflow logic

Rebuild the product foundations:

- first-party org/workspace/brand/user model
- first-party auth and sessions
- Stripe billing and entitlements
- per-brand usage ledger
- SQL-backed runtime state
- durable per-brand job queue
- audit log and safety events
- provider interfaces for X writes, listening, LLMs, image generation, and
  optional provenance

Use Rust or Go only where it earns the complexity:

- durable scheduler and worker runtime
- idempotent X execution
- rate-limit enforcement
- metering and ledger reconciliation
- provenance or crypto-heavy modules

Do not rewrite the intelligence layer in Rust before behavior is stable and
covered by characterization tests.

ADR-0011 makes this explicit for launch: TypeScript remains the canonical
standalone control plane, and Rust is evaluated later only for a measured
worker/runtime seam with parity tests and rollback.

## Data Model Direction

Core entities:

- `orgs`
- `users`
- `memberships`
- `workspaces`
- `brands`
- `brand_profiles`
- `brand_connections`
- `knowledge_items`
- `memory_items`
- `conversations`
- `messages`
- `tool_calls`
- `drafts`
- `approvals`
- `published_posts`
- `jobs`
- `usage_events`
- `subscriptions`
- `entitlements`
- `audit_events`
- `safety_events`

SQLite can remain during early migration if a repository layer makes a future
Postgres cutover mechanical. Runtime-critical state should move out of JSON and
YAML. YAML/JSON should become import/export and self-host compatibility formats.

## X Access Policy

Split writes from listening.

- X writes: official OAuth-backed X APIs wherever possible.
- Listening/discovery: provider interface with explicit provider risk and cost
  profile. Potential providers include official X tiers, ClawNet as transitional
  provider, or third-party providers.
- Follow/unfollow churn should not be part of the premium safety posture.
- Draft mode remains default. Autopilot is opt-in, capped, monitored, and
  reversible.

## Memory And Chat Intelligence

Replace parsed text tags with typed tools.

Memory layers:

- brand identity: human-editable source of truth
- locked rules: explicit high-confidence constraints
- knowledge items: source-linked facts
- adaptive preferences: inferred from approvals, edits, rejections, and outcomes
- episodic context: recent posts, replies, failures, and decisions
- operational state: limits, queue status, safety events, account health

Tool execution rules:

- schema-validated
- policy-checked
- scoped to org/workspace/brand
- dry-run capable
- confirmation-required for high-impact changes
- logged to audit events

## Security / Reliability Requirements

- per-brand credential isolation and encryption at rest
- session security suitable for standalone SaaS
- RBAC for agency teams
- audit log for all account-affecting changes
- durable usage ledger and idempotency keys
- persistent spend caps and rate-limit buckets
- durable job retries and leases
- account-protection circuit breakers
- tenant isolation tests
- backup and restore plan
- GDPR deletion/export path per org and brand

## Delivery Shape

### Phase 0: Decision And Safety Gate

- [x] Accept or reject this proposal
- [x] Decide pricing posture: premium agency product versus low-cost solo tool
- [x] Decide standalone posture: full standalone versus ClawNet-backed transition
- [x] Decide X listening policy and provider risk disclosure
- [x] Write required ADRs
- [x] Add characterization tests around current billing, scheduler, chat, and
      tenant isolation behavior

### Phase 1: Provider Boundaries

- [x] Add `ListeningProvider` around current ClawNet/Serper discovery
- [x] Add `XWriteClient` around posting/reply/like flows
- [x] Add `LLMProvider` and usage-metering hooks around LLM calls
- [x] Add `ImageProvider` boundary around generated media
- [x] Keep behavior unchanged behind interfaces

### Phase 2: Standalone Product Model

- [x] Add org/workspace/brand/user/membership schema
- [x] Add first-party auth behind an `AUTH_PROVIDER` flag
- [x] Add Stripe billing, webhooks, subscriptions, and entitlements
- [x] Add `usage_events`
- [x] Add audit events

### Phase 3: State Consolidation

- [x] Move chat conversations/messages to tenant/brand-scoped SQL tables
- [x] Move brand profiles and knowledge notes to SQL
- [x] Move approval queue/content queue/action log to SQL
- [x] Move spend caps, cooldowns, and rate-limit buckets to persistent storage
- [x] Keep JSON/YAML import/export compatibility

### Phase 4: Durable Runtime

- [x] Replace single-process scheduler scan with durable per-brand jobs
- [x] Add leases, retries, backoff, idempotency, and dead-letter handling
- [x] Add per-brand budgets and quiet hours
- [x] Remove follow/unfollow churn from premium automation path
- [x] Add safety events and circuit breakers

### Phase 5: Premium Agency Surface

- [x] Add multi-brand workspace UI
- [x] Add approval workflow and roles
- [x] Add audit log UI
- [x] Add safety dashboard
- [x] Add account health and provider-cost visibility

### Phase 6: Compiled Runtime Decision

- [x] Measure scheduler/job load after state consolidation
- [x] Decide whether worker runtime should remain TypeScript, move to Go, or move
      to Rust
- [x] If compiled runtime is chosen, extract only the worker/control-plane seam
      first

Decision: keep TypeScript for launch and defer Rust to a measured worker/runtime
seam. No compiled runtime extraction is required before customer launch.

## First Ten PR Slices

1. Add `ListeningProvider` interface and wrap current discovery providers.
2. Add `XWriteClient` interface and route X writes through it.
3. Add org/workspace/brand/user/membership schema and repositories.
4. Add first-party auth behind `AUTH_PROVIDER`, with ClawNet fallback unchanged.
5. Add Stripe products/webhook skeleton and entitlements table.
6. Add `usage_events` metering around LLM, search/listening, and X actions.
7. Move chat conversations/messages into tenant/brand-scoped SQL.
8. Move runtime JSON state for scheduler-critical paths into SQL.
9. Add durable per-brand jobs table and worker loop.
10. Add approval workflow and audit log for publishing.

## ADR Needed?

Yes.

- ADR-0005: Pulse becomes standalone; ClawNet becomes optional provider
- ADR-0006: first-party identity and org/workspace/brand model
- ADR-0007: Stripe billing and usage metering replace ClawNet credits
- ADR-0008: X writes use official APIs; listening is pluggable and risk-labeled
- ADR-0009: runtime state moves from JSON/YAML to SQL
- ADR-0010: premium safety posture removes follow/unfollow churn from canonical
  automation

## Open Questions

- What exact X API tier is economically viable for official listening?
- Is ClawNet allowed as a hidden transitional listening provider during launch?
- Should self-hosted Pulse remain supported during the standalone SaaS rehaul?
- What is the first paid ICP to validate: agency, B2B founder, or crypto-native
  operator?
- Which usage unit should customers see: credits, actions, included automation,
  or transparent provider cost plus margin?
- What compliance promises are required before agency launch?

## Links

- `docs/overview.md`
- `docs/architecture/product-model.md`
- `docs/architecture/adaptive-engine.md`
- `docs/reference/clawnet-dependency.md`
- `docs/reference/x-integration.md`
- `docs/decisions/ADR-0001-pulse-is-an-x-only-product-for-now.md`
- `docs/decisions/ADR-0002-clawnet-is-the-upstream-platform.md`
