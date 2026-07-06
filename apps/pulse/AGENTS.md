# Pulse AGENTS.md

Follow the **PULSE_ACTUALIZATION_PLAN.md** for all work.

## Current Development Rules (Phase 0+)
- Work from the writable Mac SSD copy at `/Users/garrett/Projects/Pulse NEW`; the old `/Volumes/New Volume/Pulse NEW` copy may be read-only.
- Prioritize making the split runnable: frontend/ (Vite/Next considerations) + backend/ (Rust).
- Use demo mode (?demo=true or auto in dev) for local iteration.
- Do not revive the old monolith scripts/tests at root (archived).
- Enhance the Rust gateway for cost transparency.
- All agent execution will move to Temporal in Phase 2.
- Reference archive/ for logic specs (safety, prompts, approval queues, X client) — reimplement cleanly.
- Update docs when changing run instructions or architecture.
- Tests: add for new code; legacy tests are archived.

## Deployment Rule
- After finishing fixes in `/Users/garrett/Projects/Pulse NEW`, build and deploy from that folder to the VPS before reporting done, unless the user explicitly says not to deploy.
- Current `build-deploy.sh` only creates a local `deploy/` bundle.
- **VPS target**: `/home/deploy/pulse` (scp `deploy/*` there, then run `./pulse-backend` on the server).

## Quick Dev
- `cd backend && docker compose up -d`
- Backend: `cargo run`
- Frontend: `cd frontend && pnpm dev`
- Open http://localhost:5000?demo (or login)
- See root README and the plan.

## Philosophy
Build for millions: durable (Temporal), cheap intel (gateway + cache), safe X actions, transparent costs, great UX.
