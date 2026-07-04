# Synthr Cyber x402 Server (Scaffold)

Modern, production-ready foundation for Synthr Tools' flagship cybersecurity intelligence service on x402.

## Stack Choices (2026 Modern & Long-term)
- **Hono** (ultrafast web framework, official x402 support via `@x402/hono`).
- **Bun preferred** (or Node 20+ via tsx). Native fetch, fast.
- **TypeScript + Zod** for strict schemas (agent predictability + validation).
- Payment via official x402 middleware.

This is a **strong foundation**: live data fetching from OSV.dev + EPSS + CISA, smart agentSurface scoring, EPSS prioritization, in-memory caching, multiple real endpoints, discovery files. External builder can run locally immediately.

**NO VPS/DEPLOY FOCUS YET** - everything local first.

## Quick Local Start
1. `cd server`
2. `cp .env.example .env` (at minimum set a PAY_TO_ADDRESS like 0xYourTestWallet)
3. Install: `bun install` or `npm install`
4. Dev: `bun run dev` or `npm run dev:node` (may need `npm i -D tsx`)
5. Test health: `curl http://localhost:3000/health`
6. Test intelligence (no payment): `npx tsx test-local.ts`
7. For paid calls: Use testnet USDC + x402 client libs once wallet funded.

## VPS Readiness
- Copy `.env.example` to `.env` and set `PAY_TO_ADDRESS`.
- For Ubuntu 24.04, follow [UBUNTU-24.04-DEPLOY.md](./UBUNTU-24.04-DEPLOY.md).
- Set `CORS_ORIGIN` before public deployment.
- Follow [DEPLOY-CHECKLIST.md](./DEPLOY-CHECKLIST.md) for Docker/VPS rollout.

## Core Implemented Features (Smart)
- Live OSV.dev batch queries + EPSS enrichment
- CISA KEV active exploit marking
- AgentSurface scoring (HIGH for auth/LLM/tool patterns)
- EPSS-based prioritization + patchPriority
- In-memory caching (TTL)
- Basic in-memory rate limiting for public deployment
- Full endpoints: stack-brief, audit-deps, advice, vulns
- Breaking intel endpoint: recent KEV additions with EPSS + agent relevance
- Discovery: llms.txt, x402-catalog.json
- OpenAPI discovery endpoint: `/openapi.json`
- MCP stub for agent tool exposure
- Test script proving data flow

## Adding New Endpoints
1. Define schema in `src/lib/schemas.ts`
2. Add handler in `src/services/intel.ts` (retrieve first, ground, cite).
3. Register route + payment config in `src/index.ts`
4. Update root info + docs.

## MCP Support (Critical for 2026 Agents)
See main plan: Expose the same tools via MCP server wrapper using x402 paid tools. Many harnesses (Claude Code, etc.) prefer MCP.

## Harness Examples
- Basic paid-client example: `examples/client-example.ts`
- Integration notes for agent harnesses: `examples/harness-integration.md`

## Next for Best-in-Class Service
- Real OSV.dev + EPSS + CISA integration (no rate limits on OSV).
- Vector cache of advisories (pgvector) for semantic search.
- Internal distillation calls to other x402 (social signals).
- Evals + observability (OTel).
- Daily EPSS cron job.

This scaffold + plan = 10/10 buildable by external AI or human.

<!-- auto-push smoke test -->
