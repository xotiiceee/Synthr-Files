# Pulse

**Pulse is a sovereign AI agent for X (and beyond).** You describe goals in plain language; it researches, plans, creates, posts, engages, spends (safely), learns, and reports — with approvals where it matters.

This is the Pulse product repo (brand logic, intelligence, execution, hosted surfaces, X model). It is **not** a generic multi-platform framework or the canonical ClawNet/Soma home.

## Current State (as of mid-2026)
This project is in the aftermath of an incomplete reorganization:
- `frontend/` — Modern React (currently Vite-based; see plan) UI shell (create agents, autopilot, chat, settings, operations, etc.).
- `backend/` — Rust (Axum) with agent CRUD + a strong **PulseXDataGateway** (exact + semantic cache with full cost/savings/trace metadata).
- `archive/` — Contains the previous working legacy TS core + hosted runtime (the real intelligence, scheduler, safety, billing, X ops, etc.).

**Important**: The split app is now runnable in demo mode with Rust-backed agents, credits/usage stubs, X intel cost metadata, and a Temporal-ready goal execution foundation. Some production surfaces remain simulated while Phase 2 moves execution into a full Temporal worker.

## Quick Links
- **Actualization Plan** (research-backed path to 10/10 for millions of users): [PULSE_ACTUALIZATION_PLAN.md](./PULSE_ACTUALIZATION_PLAN.md)
- Vision: [PULSE_VISION.md](./PULSE_VISION.md)
- Backend (Rust intel + agents): [backend/README.md](./backend/README.md)
- Archive (historical working code + golden plan): `archive/`

## Current "Run" Options (Limited)
- Frontend dev: See `frontend/` (pnpm dev) + backend on :3457. Expect auth/credits errors and stubs.
- Rust backend demo: `cd backend && cargo run` (agents + /v1/x-intel with cache economics demo).
- Goal execution demo: Autopilot → Goal Runner, or `POST /v1/goal/start`; progress is persisted in Postgres and exposed at `GET /v1/goal/:id/status`.
- Best visual of intended UI: `pulse-home-mock.html`.

## Deploying the Desired Modern Frontend + Backend (VPS ready)
We copied the polished frontend from the previous deployed version (the one that powered pulse.claw-net.org — React UI with Chat tab, Create Agent, Play/Pause).

The current `frontend/` now has **that** UI (honestly good parts only: clean, functional SPA).

### Quick way to prepare a drop-in package for VPS
```bash
chmod +x build-deploy.sh
./build-deploy.sh
```

This:
- Builds the **polished modern React frontend** (copied from the claw-net version: Create Agent button, full nav with Chat, agent Play/Pause in Settings).
- Copies the built static assets.
- Builds the Rust backend binary (with wired APIs for agents, chat, etc.).
- Creates a `deploy/` folder ready to copy to your VPS.

### On the VPS (after copying the deploy/ contents)
```bash
# Setup Postgres (example using the provided docker-compose or install system postgres)
# Edit .env with DATABASE_URL=postgres://...  and other keys

# Run
./pulse-backend
```

The Rust binary will serve:
- The modern frontend UI (SPA)
- All the APIs for Create Agent, toggle running (play/pause), etc.

This gives you the real product experience on one service.

See `backend/README.md` for more (including how to set PULSE_STATIC_DIR if needed).

For systemd service, reverse proxy (nginx), SSL, etc., use standard VPS practices.

Run `./build-deploy.sh` every time you want an updated drop for VPS.

**Do not use legacy root scripts** (they target archived paths).

## Tech Direction (High Level from Plan)
- Keep/enhance Rust for perf/safety seams (intel gateway is a strength).
- Move to durable execution (Temporal) for real agent goals/autopilot.
- Current goal execution uses the same persisted API contract a Temporal worker will own next; the demo runner checkpoints research, draft generation, approval wait, and cost metadata.
- Modernize frontend toward full-stack patterns (Next.js considerations).
- Unified Postgres + vector (pgvector) + targeted Qdrant.
- x402 + Stripe, strong tenancy, observability from day one.

See the plan for phased roadmap, specific recommendations, and why we are going "beyond" the current skeleton.

## Development Posture
We are moving from "reorg shell" → production-grade agent platform. Every change should improve runnability, reliability, or cost transparency.

Reference ADRs and golden plan in `archive/decisions/` and `archive/pulse-as-a-service-backend-golden-plan.md` for original intent (adapt, don't cargo-cult).
