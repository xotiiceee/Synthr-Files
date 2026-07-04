# Pulse Actualization Plan — Path to 10/10 for Millions of Users

**Date**: 2026-06-24 (initial)  
**Execution Log** (full plan actualization in order):
- Phase 0: COMPLETE (cleanup of root, runnable with demo auth/credits/activity, docs, CI, docker+Postgres, seed).
- Phase 1: MAJOR PROGRESS (real sqlx Postgres persistence for agents + schema; goal decompose using gateway; frontend enhanced for demo flow and modern DX).
  - Frontend: Kept Vite/React19 as enhanced shell (per velocity decision); "beyond" via integration and DX. Ready for Next.js spike.
- Phase 2: FOUNDATION (Temporal in docker; goal decompose as entry to durable execution; checkpointed `/v1/goal/start` demo runner now persists workflow-shaped goal progress for the future Temporal worker).
- Phase 3/4: PREPARED in docs + some primitives (intel, goal execution).

**10/10 Status Update**: The plan has been actualized in order through substantial code changes. The Pulse app is now in a much stronger state: real DB persistence, functional goal decompose with cost-aware intel, clean runnable split, modern backend foundation. It is "production skeleton" ready for the remaining hard parts.

To reach full 10/10 for millions:
- Replace the checkpointed demo goal runner with the full Temporal worker + workflows for full autopilot/goal execution.
- Port full safety/X write from archive.
- Real auth (Clerk), billing, x402 production.
- Full frontend polish or Next migration.
- Production testing, keys, deploy.

Current state is the best it has been - usable, with real architecture for scale. Run it to see.

## Phase 1 Decision (executed)
**Decision**: For velocity in Phase 0/early 1, **enhance current frontend/ (Vite + React 19)** rather than immediate full destructive Next.js migration (preserves runnable state).
- "Go beyond" applied via: auto-demo auth, better stubs for lively UI, modern comments, prepare for TanStack patterns + future RSC/streaming.
- Next.js 16 migration to be done as follow-up spike (or parallel dir) once core is stable.
- shadcn/ui adoption: recommend `npx shadcn@latest init` in frontend when ready (current custom is fine for now).
See updated frontend useAuth and stubs for examples of modernized dev flow.

**Context**: Post brutally honest review of current state (mid-reorg: frontend/ + backend/ split exists with polished React shell + Rust intel gateway skeleton; real working intelligence/runtime in archive/legacy-ts-*; root polluted; integrated runnability broken; heavy stubs).  
**Goal**: Transform into a reliable, cost-efficient, delightful, trustworthy AI agent platform (sovereign X-focused co-founder agent) that can serve millions of users/brands safely at scale. Focus on production realities: durability, cost control, security/isolation, observability, DX, real execution.

This plan is informed by:
- Current codebase audit (structure, api surface, Rust gateway strengths, stubs, archived logic).
- 2026 research on AI agent SaaS stacks, frameworks, vector DBs, durable execution, auth, micropayments.
- Honest assessment: Current frontend (React 19 + Vite) is **not bad** but leaves value on table. Rust Axum direction is **strong**. The missing pieces (durable execution, unified data, typed full integration, real runtime) are addressable with modern primitives that go *beyond* the legacy monolith and the current skeleton.

## 1. Honest Research + Brainstorm Summary (Modern Tech Suggestions)

### Frontend (Current: React 19 + Vite SPA + custom hooks + Tailwind + proxy)
**Assessment**: Fast dev experience. Components (Layout, modals, pages for Chat/Autopilot/Create/Settings/Operations etc.) are comprehensive and look professional. But the SPA + proxy to 3457 creates the "blank page + errors" experience. Streaming for agent thinking is clunky. No server-side data co-location.

**Go beyond** (2026 best practices for complex AI SaaS dashboards/agents):
- **Primary recommendation: Next.js 16+ (App Router, React 19 RSC, Server Actions, streaming responses)**. Dominant in 2026 AI agent SaaS stacks. Enables:
  - Co-located data fetching + mutations (no proxy hell, simpler auth).
  - Native streaming for chat/agent "thinking" / step progress (Vercel AI SDK shines here).
  - Better perf (RSC reduces client JS, edge where appropriate).
  - Built-in auth patterns, API routes for thin orchestration.
- UI library: Adopt **shadcn/ui** (Radix + Tailwind) — production-ready, accessible, huge ecosystem vs custom cards.
- State: TanStack Query (server state) + Zustand (client) over heavy context.
- Real-time: Streaming + Server-Sent Events (or WebSockets via next-ws or PartyKit). Optimistic updates for agent actions.
- Extras: Framer Motion for delightful transitions; better form handling (React Hook Form + Zod).
- Alternative if staying SPA: Vite + TanStack Router + tRPC (strong typing to Rust/TS services). But full-stack wins for velocity + integrated feel.
- Why better for millions: Faster iteration on UX trust signals, lower bundle for global users, easier A/B and personalization.

Current is usable as base for incremental migration (keep components).

### Backend / Core Services (Current: Rust Axum + Tokio + moka + Qdrant client + stubs + in-mem agents)
**Assessment**: Axum is excellent — ergonomic, composable (Tower), modern default in 2026 Rust web comparisons. The PulseXDataGateway (exact L1 + semantic + full IntelMeta cost/savings/trace) is a **highlight** and ahead of many stacks for affordable X-scale. Agents CRUD + toggle works for stubs.

**Go beyond**:
- Keep Rust for **high-value seams** (intel gateway, X safety/write enforcement, low-latency status, perhaps native tool impls).
- Do **not** force Rust to be the full user-facing + execution server. Use it where Rust wins (perf, safety, cost).
- Strong API surface: utoipa for OpenAPI, or gRPC (tonic) for internal. Typed clients from frontend.
- Alternatives considered: Actix-web (raw speed), but Axum preferred for maintainability. Hono/Bun if more TS wanted (not here).

### Agent Execution / Orchestration / Durability (Biggest current gap)
Legacy had jobs, durable-scheduler, approval-queue, runtime-state, modes (autopost etc.). Current: stubs + no real engine.

**Top modern recommendation: Temporal.io (durable execution)**.
- Production-proven for AI agents in 2026 (OpenAI Codex web agent, Replit Agent 3, Retool production examples, dedicated Replay 2026 conference talks).
- Perfect fit: Long-running goal plans/autopilot, dynamic LLM-driven steps (non-deterministic decisions inside Activities; deterministic orchestration in Workflows for replay on crash), human-in-the-loop checkpoints (approvals), retries/timeouts, child workflows for sub-tasks, full history/observability.
- Workflow code is deterministic (replay-safe); LLM/tool calls + side effects are Activities (can be wild).
- Polyglot: Use TS/Python workers for LLM-heavy, call Rust services for intel/X safety.
- Replaces much of archived scheduler/jobs complexity with battle-tested reliability.
- Alternatives: Inngest/Trigger.dev (more TS), custom pgmq + workers (weaker durability), Step Functions (lock-in).
- Why for millions: Agents that don't lose state on deploy/crash, safe autonomous loops, auditable.

Thin orchestration (Vercel AI SDK or custom) in the user layer + heavy durable execution in Temporal.

### Data & Intelligence Layer
- **Current strength**: Gateway design with cache economics.
- Vector DB research (2026):
  - **pgvector (+ pgvectorscale)**: Frequently recommended default for new prod RAG/agent work. Simplicity (one DB for relational + vectors: agents, knowledge, audit, usage, some cache). Strong benchmarks (hundreds QPS at 50M vectors). ACID transactions with app data.
  - **Qdrant**: Excellent for perf, payload filtering, hybrid, Rust-native, cost at dedicated scale. Your current design fits perfectly.
  - Recommendation: **Hybrid or consolidate**. Primary app state + knowledge in Postgres + pgvector (unify with sqlx). Use/keep Qdrant specifically for high-volume X intel semantic cache (mentions, research). Or benchmark pgvector for the cache first.
- Add: Redis (sessions, rate limits, hot L1 beyond moka).
- Embeddings: Multi (OpenAI text-embedding-3 + cheaper/faster options). Fastembed for local/Rust paths.
- Why better: Fewer services, transactional safety for brand state + vectors, cheaper ops.

### LLM, Tools, Memory
- Model gateway/router (multi-provider fallback, cost routing — OpenRouter pattern common 2026).
- Thin by default (Vercel AI SDK) + structured outputs/tool calling. Reach for graphs only when needed.
- MCP emerging as neutral tool standard.
- RAG/memory: Your knowledge + intel unified.
- Evals + quality gates: Add early (skipped in many stacks, #1 prod barrier).

### Auth, Tenancy, Security
- Current: First-party stubs + legacy mentions.
- Modern: **Clerk** (very popular with Next.js, first-class orgs/roles/SSO/multi-tenancy, easy components). Or Ory (self-hosted control/cost for serious scale).
- Enforce tenant isolation at DB (RLS or app + row scoping) + gateway.
- PIN/idle, approval roles, safety — port and harden from archive.

### Payments & x402
- x402: Real, production-relevant protocol (Coinbase-backed, Stripe integrations noted, Linux Foundation, millions of txns cumulatively by mid-2026). Perfect for Pulse (per-intel call, per-agent action, micropay data). Combine with Stripe subscriptions + usage metering.
- Implement deferred + real facilitator paths.

### Deployment, DX, Scale
- Monorepo: pnpm + Turborepo.
- Dev: One-command start (Next + Rust services + Temporal dev server + Qdrant/Postgres).
- Deploy: Next (Vercel or container), Rust (Fly.io great for low-overhead), Temporal (Cloud for simplicity or self-managed), managed Postgres.
- Observability: OpenTelemetry (Axum has good support), Temporal UI + history, custom cost dashboards, Prometheus/Grafana.
- CI: Fix .github/workflows for actual layout.
- Scale: Horizontal workers, budget enforcement, caching everywhere, rate limiting at edges, graceful degradation.
- Testing: Durable workflow tests, load/chaos for agents, property-based for intel.

**Overall philosophy**: Keep the "boring reliable SaaS shell" + powerful agent layer. Thin where possible, durable/reliable where it matters (Temporal + Rust seams). Your intel gateway economics + X focus are differentiators — amplify them.

## 2. Target Architecture (High Level)

```
Users / Agents (external via x402/REST)
          |
Next.js (frontend + thin API layer / streaming chat / Vercel AI SDK)
   - Auth (Clerk or first-party)
   - UI (shadcn, real-time agent views)
   - Calls to services / starts Temporal workflows
          |
Temporal (durable agent runtime)
   - Workflows: Goal decompose/execute, Autopilot loops, multi-step plans
   - Activities: LLM calls, tool use, call Rust services (intel, X ops)
   - Checkpoints for approvals / human-in-loop
   - History, retries, visibility
          |
Rust Services (Axum on 3457 or internal)
   - /v1/x-intel/* (gateway: moka + Qdrant/pgvector, cost meta)
   - /api/brands, keys/status, operations
   - X-write safety, rate counters, write ops (port from archive)
   - Knowledge upsert/search
          |
Data:
  - Postgres (sqlx) + pgvector : brands, agents, knowledge, usage, audit, approvals, tenant state
  - Qdrant (optional dedicated): high-volume X intel cache
  - Redis: sessions, hot cache, limits
  - (Legacy dbs for migration reference only)
          |
External:
  - LLMs (via gateway/router: Groq/Claude/OpenAI/etc.)
  - X API (user keys or app, heavily cached)
  - Stripe + x402 (micropay + subs)
  - GitHub (context)
```

One service possible for simple deploys (Rust serves static Next build + APIs), but service separation for scale.

## 3. Phased Actualization Roadmap

### Phase 0: Stabilization & Quick Wins (1-2 weeks, make it "usable today")
- Ruthless root cleanup: Move/archive/delete dead direct-*.ts, most root scripts/tests (keep useful ones), root node_modules/package-lock if not needed, update .gitignore. Make pnpm workspace clean.
- Fix immediate runnability:
  - Implement critical missing endpoints in Rust (or thin Next proxy): `/api/credits`, `/api/usage`, basic `/auth/session` that supports demo login or first-party stub that "works".
  - Update vite.config (or move to Next) and launch scripts (.bat/.ps1).
  - Add a `dev` script or docker-compose that starts Postgres/Qdrant + Rust + (Next or current FE).
- Update docs: New root README with "current state + how to run", accurate status.
- Make agents persist minimally (sqlx + simple table).
- Fix .github/workflows/ci.yml + deploy to match reality (build frontend, cargo test, etc.).
- Wire basic "create → list → toggle" end-to-end with fake X status.
- Preserve mock.html as demo vehicle.
- Extract useful logic notes from archive (e.g., safety patterns, approval flow) into new ADRs or plan.

**Success**: `pnpm dev` (or equivalent) + `cargo run` shows logged-in-ish UI with working agent CRUD and no proxy/auth crash loops. ProductionReadinessPanel and basic Chat render meaningful data.

### Phase 1: Modern Shell + Foundations (4-8 weeks)
- Migrate/integrate frontend to Next.js 16 (or strong incremental with tRPC if full migration risky). Port components/pages. Add streaming chat skeleton.
- Adopt Clerk (or finalize first-party with better security) + multi-tenant org model.
- Data model: Full Postgres schema (tenants, brands/agents with running state, usage, audit/safety events, knowledge items, approvals). Migrations via sqlx or diesel. Start with pgvector for unified knowledge.
- Enhance Rust intel gateway: Real (or better mocked) Claw source or fallback; more data types (timeline, profiles); integrate with Postgres for persistence of cache metadata.
- Typed contract: OpenAPI (utoipa) or tRPC-like between layers. Strong Zod validation.
- Basic x402 surface + Stripe integration stubs (leverage archive patterns).
- Observability: OTel in Axum + Next; basic dashboards.
- Update PULSE_VISION.md and create living ARCHITECTURE.md.

**Success**: Real auth flow, credits/usage visible, agent create + basic chat that calls intel gateway and shows cost meta. UI feels integrated.

### Phase 2: Durable Execution Engine (core value, 6-10 weeks)
- Introduce Temporal (dev server easy; plan prod self or Cloud).
- Define key Workflows:
  - GoalDecomposeAndExecute (plan generation + step execution with dependencies).
  - AutopilotLoop (monitor → decide → propose/approve → act).
  - ContentApproval + Publish (with safety checks calling Rust).
- Activities: LLM plan/decompose (structured), research via gateway, generate content (port voice/prompt logic from archive/intelligence), X actions (via safe Rust client), evaluation.
- Port/adapt from archive (safely): x-write-safety, approval-queue, human-behavior, content generators, mention-detector, scheduler concepts → into Temporal + activities.
- Wire UI: Show live workflow progress (use Temporal visibility or streams), approval UI that signals workflows.
- Safety & limits: Enforce in activities + pre-write Rust checks.
- Testing: Workflow unit + integration tests (Temporal has excellent support).

**Success**: User can set "autopilot" or give a natural goal; see durable execution, approvals, real (or safe simulated) actions, resumption after "crash". Intel cost transparency on every step.

### Phase 3: Full Features, Polish, x402 & Scale Prep (ongoing)
- Complete pages: Billing real (Stripe + usage), Operations full audit/safety, Growth, Media, Knowledge with real RAG.
- Advanced intel: GitHub linkage, competitor, deeper semantic.
- x402 production (deferred, facilitator, test vectors).
- Evals: Automated quality + cost gates before publish.
- Real X integration (user OAuth/keys with scopes; heavy caching).
- Multi-brand, roles/RBAC, export/privacy (port from archive).
- UI/UX beyond: Real-time activity feed via streams, voice calibration, presets in new model.
- Load testing, budget enforcement per tenant, multi-region considerations.
- CI/CD overhaul, blue-green or canary deploys, monitoring alerts.

### Phase 4: Production Hardening & Millions Path
- Horizontal scaling (workers, gateway replicas).
- Advanced caching/hybrid search.
- Compliance (GDPR export already sketched), security audits, rate limits everywhere.
- Analytics + learning loops (port adaptation from archive).
- Marketplace/agent API exposure.
- Cost dashboards and user-visible savings.
- Performance budgets, chaos engineering for agents.

## 4. Specific Tech Choices & Tradeoffs

| Area              | Current                  | Recommended                  | Why (from research + needs) |
|-------------------|--------------------------|------------------------------|-----------------------------|
| FE Shell         | React 19 + Vite SPA     | Next.js 16 (RSC/streaming) + shadcn | Full-stack wins for agent UX, no proxy, streaming, velocity. Dominant 2026 pattern. |
| Backend API      | Rust Axum (stubs)       | Keep Rust + thin Next layer | Rust for perf/safety seams. |
| Execution        | None / stubs            | Temporal (durable)          | Production AI agents standard 2026. Solves reliability, approvals, state. |
| Primary DB       | sqlite remnants + in-mem| Postgres + sqlx + pgvector | Unified relational+vector, simplicity, ACID. |
| Vector           | Qdrant (gateway)        | Qdrant (intel cache) + pgvector (app/knowledge) | Best of both: perf for cache, simplicity elsewhere. |
| Auth             | Stubs                   | Clerk (or Ory)              | Fast, secure multi-tenant for SaaS. |
| Payments         | x402 sketched           | Stripe + full x402          | Real protocol; fits agent economics. |
| Orchestration    | Legacy modes            | Thin (Vercel SDK) + Temporal | Thin until complex; durable for prod. |
| LLM              | Various stubs           | Gateway + router + structured | Cost control, fallback, modern. |
| Observability    | Tracing partial         | OTel + Temporal + cost meta | Essential for millions + trust. |

**Migration**: Archive is gold — treat as reference implementation for logic (safety, prompts, approval, X client patterns, scheduler). Do not run it; reimplement concepts cleanly in new primitives.

## 5. Risks, Tradeoffs, Mitigations
- Effort of migration/rebuild: High. Mitigate with incremental (Phase 0 first), heavy use of archive for specs/tests.
- Learning Temporal + Next + Rust: Invest in spikes.
- x402 maturity: Use alongside Stripe; volumes still ramping but protocol solid.
- Performance of pgvector: Benchmark your X cache workload early.
- Team skills: Rust strength is asset; add Temporal/Next skills.
- Scope creep: Strict phases; "thin until proven".

## 6. Immediate Next Actions (Start Today)
1. Review/approve this plan (or specific slice).
2. Create root cleanup PR or branch (delete obvious dead files, update README with "see this plan").
3. Phase 0 spike: Implement `/api/credits` + minimal auth in Rust (or Next proxy) + update frontend proxy or switch a page to test Next.
4. Spin up Temporal dev server + simple "hello goal" workflow demo calling existing Rust intel.
5. Write data model migration (first tables for agents + knowledge).
6. Update CLAUDE.md / add AGENTS.md with new stack notes.
7. Benchmark: Simple Qdrant vs pgvector for your intel query pattern.
8. Decide auth provider (Clerk trial?).

**Success metrics for "10/10"**:
- Developer can `start everything` and see end-to-end goal → approved post with cost shown.
- Agent survives restarts, approvals are enforced, no duplicate unsafe actions.
- Cache hit rate + savings visible and high.
- Real users (or realistic load) can run without constant babysitting.
- CI green, deploy repeatable, costs predictable per brand.
- UI feels fast, trustworthy, proactive.

This is ambitious but achievable. The pieces (your gateway vision, archived logic, modern primitives like Next/Temporal) align well.

Reference: `archive/pulse-as-a-service-backend-golden-plan.md` and ADRs for original intent.

---

**Status**: Plan drafted. Ready for discussion, refinement, or slice-by-slice execution (e.g. "start with Next.js spike" or "Temporal + Rust integration first").

Tell me the priority slice and I'll begin implementing (using research-backed choices).
