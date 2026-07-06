# Pulse Backend (Rust) — Intelligence Gateway

This is the high-performance, cost-aware core for **Pulse as a Service**.

Current focus (first actualized slice per golden plan):
- `ClawAPIsXRouter` / `PulseXDataGateway`
- Exact + semantic caching (moka L1 + Qdrant)
- Typed results (`XPost` with rich engagement)
- Full cost metadata + decision trace on every response
- Pluggable sources, ClawAPIs x402 as primary cheap native path

Dual-mode parity note (actualized): TS hosted layer ( /v1/pulse/intel/* + /goal/* via agent-routes ) + unified TS gateway
provide thin x402 intel surface + GitHub/knowledge for both x402 agent calls and sub partner surfaces.
Rust gateway remains the perf core; comments align the two.

## Quick Start (Local Dev - Phase 0)

**See root PULSE_ACTUALIZATION_PLAN.md for the full roadmap.**

1. Start supporting services (Postgres for future agents persistence + Qdrant):
   ```bash
   cd backend
   docker compose up -d
   ```

2. (Optional) Set env for full gateway (copy .env.example or set):
   ```bash
   OPENAI_API_KEY=sk-...
   QDRANT_URL=http://localhost:6334
   DATABASE_URL=postgres://pulse:pulse@localhost:5432/pulse   # for future sqlx
   ```

3. Run Rust backend (agents + intel gateway + many UI-saving stubs):
   ```bash
   cargo run
   # listens on :3457 (PULSE_RUST_PORT=3457)
   ```

4. Run frontend (separate terminal):
   ```bash
   cd ../frontend
   pnpm install
   pnpm dev
   ```
   - Opens on :5000, proxies to backend.
   - For local demo auth, set `PULSE_ALLOW_DEMO_AUTH=true` in the backend env.
   - You should see working agent create/switch/toggle, some activity/config, credits, and intel cost metadata.

## Clerk Auth

Production should not silently fall back to demo mode.

Set these in the backend environment:
```bash
PULSE_ALLOW_DEMO_AUTH=false
CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
# or let the backend fetch Clerk's signing keys directly:
# CLERK_JWKS_URL=https://your-instance.clerk.accounts.dev/.well-known/jwks.json
# Optional but recommended:
CLERK_AUTHORIZED_PARTIES=https://pulse.synthr.online
```

Behavior:
- If `PULSE_ALLOW_DEMO_AUTH=true`, the backend accepts demo fallback for local testing.
- If `PULSE_ALLOW_DEMO_AUTH=false`, missing Clerk tokens or a missing `CLERK_JWT_KEY` now return unauthorized instead of pretending the user is `demo-user`.

5. Test intel (with cost transparency):
   ```bash
   curl -X POST http://localhost:3457/v1/x-intel/mentions \
     -H 'Content-Type: application/json' \
     -d '{"brand_id":"sweet-treats","query":"recent mentions of sweet treats or @sweettreatsbakery","purpose":"monitor"}'
   ```

   Look for cache hits, costs, savings on repeat calls.

6. Start a checkpointed goal execution:
   ```bash
   curl -X POST http://localhost:3457/v1/goal/start \
     -H 'Content-Type: application/json' \
     -d '{"brandId":"sweet-treats","goal":"Create one useful X post from recent audience signals","approvalRequired":true}'
   ```

   Poll `GET /v1/goal/{id}/status` with the returned `planId`. This is the Phase 2 Temporal-ready contract: the current demo runner persists workflow checkpoints in Postgres, and the full Temporal worker will take over the same shape.

   To hand new goals to a Temporal worker, set:
   ```bash
   PULSE_GOAL_WORKER_URL=http://localhost:8787
   PULSE_GOAL_WORKER_TOKEN=replace-with-shared-secret
   ```
   Then `/v1/goal/start` will call `POST /workflows/goal-decompose-and-execute` on that worker with the persisted goal id and `workflowId`. If the worker is missing or rejects the request, local development falls back to the demo runner unless `PULSE_GOAL_WORKER_FALLBACK_DEMO=false`.

For one-service static UI: build frontend then set PULSE_STATIC_DIR.

See the Actualization Plan for moving to Next.js, Temporal, real persistence, etc.

## Integration (TS side)

The TS side talks to this via `src/core/x-intel-gateway.ts`.

- `getXIntelMentions(brandId, query, opts)`
- Automatically logs measurements with `logXIntelMeasurement`
- Used in `mention-detector.ts` for X (the first real consumer wiring)

Set these in your main `.env`:
```
PULSE_X_INTEL_URL=http://localhost:3457
PULSE_X_INTEL_ENABLED=true
```

When the gateway is live you get dramatically better X data (native objects + engagement) at near-zero marginal cost thanks to caching.

## Architecture Alignment

See the golden plan:
`docs/proposals/pulse-as-a-service-backend-golden-plan.md`

This module is the "Pulse Intelligence Gateway":
- One place for all expensive/fresh X data.
- Cache first (exact → semantic).
- Cost transparency everywhere.
- Foundation for chat efficiency (sub-queries, facts from cache, LLM only for synthesis), GitHub context, proactive partner mode, and x402 intelligence endpoints.

## Running as One Service (UI + APIs) — Recommended for VPS

The Rust backend is wired to serve the **desired modern frontend** (the React one with Create Agent button, play/pause toggles, etc.) + the backend APIs.

### Build & Serve (dev or deploy)
1. Build the modern frontend:
   ```
   cd frontend
   pnpm install
   pnpm build
   ```

2. Copy built UI for the backend to serve:
   ```
   mkdir -p static
   cp -r ../frontend/dist/* static/
   ```
   (Or set PULSE_STATIC_DIR=/path/to/dist when running the binary)

3. Run the backend:
   ```
   cargo run --release
   # or ./target/release/pulse-backend after build
   ```

The single `pulse-backend` binary will serve:
- The full modern React UI at `/` (create agents, Settings with Play/Pause for running state, etc.)
- All APIs the frontend calls (/api/brands, /api/brands/toggle-running, auth, etc.)

This is the clean way to deploy to VPS without separate frontend server.

See the root `build-deploy.sh` for an automated script that produces a ready-to-scp `deploy/` folder containing the binary + static assets.

## Next Actualization Work (in progress)

- Implement the worker process behind `PULSE_GOAL_WORKER_URL` and have it start the real Temporal `GoalDecomposeAndExecute` workflow.
- Real ClawAPIs x402 client + deferred payments
- More data types (search, timeline, profile)
- Full chat/autopilot flows in Rust (or thin proxy)
- Replace the demo runner fallback once the Temporal worker owns goal checkpoints end-to-end
- GitHub linkage ingestion
- Measurement + cost dashboards
- Persistent store (sqlx) + tenant isolation

See the golden plan for the full vision: docs/proposals/pulse-as-a-service-backend-golden-plan.md

Run with real Qdrant + embeddings for the cache wins.

This is how we deliver the best service affordably at scale.
