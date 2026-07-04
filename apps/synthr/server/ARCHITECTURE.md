# Architecture Notes for Synthr Cyber x402

## Core Principles
- Retrieval-augmented synthesis only (no ungrounded generation).
- Agent-first: predictable schemas, rich metadata (EPSS, agentSurface, actions, sources).
- Dual interface: x402 REST + MCP tools.
- Modern portable stack (Hono + Bun primary).

## Layers
1. **Edge/Payment**: Hono + @x402/hono middleware (enforces 402 before handler).
2. **API Layer**: Zod-validated routes + OpenAPI generation.
3. **Synthesis Layer**: Retrieve (OSV/EPSS) → Enrich → (optional x402 distillation) → Grounded output.
4. **Data Layer (future)**: Postgres + pgvector for cached vulns/advisories + embeddings. Redis for hot cache. Workers for ingestion.
5. **Observability**: Structured logs (pino), health endpoints, future OTel traces + metrics.

## Extensibility
- Add new endpoint: schema + service function + payment config entry.
- MCP: Mirror functions in a separate MCP server module using x402 paidTool patterns.
- Scaling: Horizontal via load balancer + shared cache/DB. Edge via Cloudflare Workers (Hono native).

See main plan doc for diagrams and build instructions.
