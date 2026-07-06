# Next Phases: VPS Setup, Production, Discovery & Beyond

**Date**: June 2026  
**Status**: Post-local-actualization roadmap  
**Audience**: Builders following the Synthr Tools repo.  
**Context**: The local implementation (`server/`) is now actualized with **real working intelligence**:
- Live OSV.dev + EPSS + CISA data fetching.
- Smart features: EPSS prioritization, `agentSurface` scoring, grounded outputs.
- Functional endpoints: `stack-brief`, `audit-deps`, `advice`, `vulns`.
- Discovery assets (`llms.txt`, catalog) and MCP stub.
- Testable locally: `cd server && npx --yes tsx test-local.ts`

**This document** focuses on **next phases** (starting with VPS since local is solid). It provides concrete, actionable steps, commands, configs, and decisions.

See root [README.md](../README.md) and [docs/SYNTHR-TOOLS-VISION-AND-PLAN.md](./SYNTHR-TOOLS-VISION-AND-PLAN.md) for vision and current local state.

---

## Current State Summary (What Is Actualized)

- **Repo Structure**: Clean, with `.gitignore`, functional `server/`.
- **Core Service**: Production-quality local code (Hono + TS). Real data, no stubs for main logic.
- **Testing**: `test-local.ts` proves the value without payments.
- **Agent Ready (Local)**: Structured JSON, provenance, agentActions, harnessNotes.
- **No VPS/Deploy Yet**: Everything runnable locally on Windows/Linux with Node 20+ or Bun.

**Next Goal**: Get a real, payable x402 service live on your VPS, listed on x402scan, usable by agents.

---

## Phase 1: Local Polish & Validation (Do This First)

1. **Verify Locally**
   ```bash
   cd server
   cp .env.example .env
   # Edit at least: PAY_TO_ADDRESS (any 0x... for local test; use real test wallet later)
   # Optional: npm install -D tsx   (if using Node without Bun)

   # Quick intel test (no server, no crypto)
   npx --yes tsx test-local.ts

   # Start server (local)
   npm run dev:node   # or bun run dev
   curl http://localhost:3000/health
   curl http://localhost:3000/llms.txt
   ```

2. **Test a Paid Flow Locally (Testnet)**
   - Get Base Sepolia USDC + ETH from CDP faucet.
   - Use x402 client examples (see `examples/client-example.ts`).
   - Call `POST /v1/cyber/stack-brief` with a real x402-aware client.
   - Verify 402 challenge → payment → response.

3. **Polish Ideas**
   - Add more sample deps in `test-local.ts`.
   - Extend `searchVulns` or add `/breaking` endpoint if desired.
   - Optional: Wire basic LLM for advice text (add `LLM_API_KEY` and simple fetch to OpenAI/Anthropic in `intel.ts`).
   - Run with real x402 test client multiple times.

**Deliverable**: You can call the live endpoints locally and get high-quality, sourced security intel.

---

## Phase 2: VPS Setup & Basic Deployment

**Assumptions**: You have a VPS (Ubuntu/Debian recommended, as mentioned). Public IP, SSH access. We will use Docker (already in repo) for consistency.

### 2.1 Prepare VPS

```bash
# On VPS (SSH in)
sudo apt update && sudo apt install -y curl git docker.io docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # logout/login after

# Clone
git clone https://github.com/YOUR-USER/Synthr-tools.git   # or your fork
cd Synthr-tools/server
cp .env.example .env
```

Edit `.env` (production test first):
```
PAY_TO_ADDRESS=0xYourRealTestWallet
FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402   # or test one first
NETWORK=eip155:84532   # Base Sepolia to start
DEFAULT_PRICE_USD=0.005
PORT=3000
LOG_LEVEL=info
# LLM_API_KEY=... (optional)
```

**Important**: For real payments later, use Coinbase CDP mainnet setup + funded USDC wallet.

### 2.2 Deploy with Docker

```bash
cd /path/to/Synthr-tools/server
docker compose up -d --build

# Check
docker logs synthr-cyber --tail 50
curl http://YOUR_VPS_IP:3000/health
```

### 2.3 HTTPS + Domain (Recommended)

Use **Caddy** (easiest auto HTTPS):

```bash
# On VPS
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
# Add repo + install caddy (see caddyserver.com for one-liner)

# Caddyfile (in /etc/caddy/Caddyfile or project)
yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

Test: `https://yourdomain.com/health`

**Alternative**: nginx + certbot.

### 2.4 Make Persistent (systemd alternative if not using Docker)

If you prefer bare Bun/Node:

```bash
# After building or using pm2
npm install -g pm2
pm2 start "bun run src/index.ts" --name synthr-cyber
pm2 save
pm2 startup
```

### 2.5 Basic Monitoring

- `docker logs -f ...`
- Add UptimeRobot or similar on `/health`.
- Simple log rotation in Docker compose (already has some).

**Checkpoint**: Service reachable over HTTPS, returns real intel on calls.

---

## Phase 3: Production Hardening & Real Payments

1. **Switch to Mainnet**
   - `NETWORK=eip155:8453` (Base mainnet)
   - Real `PAY_TO_ADDRESS` with USDC.
   - Update prices if desired.
   - Use Coinbase CDP facilitator with API keys (add to env, update client code if needed).

2. **Secrets & Security**
   - Never commit `.env`.
   - Use VPS secrets manager or Docker secrets.
   - Add basic auth or IP allowlist temporarily if wanted.
   - Enable HSTS, proper CORS in code (`cors` middleware already present — tighten origins).

3. **Rate Limiting & Protection**
   - Add rate limiter middleware (e.g. `hono-rate-limiter`).
   - Log paying wallets (from x402 headers) for abuse analysis.
   - Fair usage per payer.

4. **Observability**
   - Structured logs (pino already).
   - Add Prometheus metrics endpoint (optional quick win).
   - Error tracking (Sentry or simple).

5. **Testing Real x402**
   - Fund wallet with real (small) USDC.
   - Use x402scan composer or a real agent client to call.
   - Verify settlement to your address.

**Deliverable**: Live, payable endpoint on public HTTPS.

---

## Phase 4: Discovery, Listing & Agent Adoption

1. **Prepare Discovery Assets**
   - Ensure `/llms.txt` and `/x402-catalog.json` return full content (already wired).
   - Update descriptions with real examples from test runs.
   - Add OpenAPI spec (can generate from Hono + zod with `hono-openapi` or manually).

2. **Register on x402scan**
   - Go to https://www.x402scan.com/resources/register
   - Provide:
     - Server URL (your domain)
     - Description: "Agent-optimized cybersecurity intel. OSV + EPSS + KEV. Stack briefs & dep audits for builders & harnesses."
     - Sample endpoints + prices.
     - Links to llms.txt / catalog.
   - This is key for agents to discover you.

3. **MCP Full Integration**
   - Expand `server/src/mcp-server.ts` using `@modelcontextprotocol/sdk`.
   - Register tools that call the same synthesis functions.
   - For payments on MCP: See x402 docs / Cloudflare examples (`withX402`, paidTool).
   - Expose MCP at a separate port or path.
   - Provide example connection strings for Claude Desktop / other harnesses.

4. **Harness Examples**
   - Add `examples/harness-integration.md` or code snippets (Claude Code, custom agent, LangGraph, etc.).
   - Show "add synthr_cyber as tool".

5. **Marketing / Visibility**
   - Post on X about the x402 cyber service with example output.
   - Target agent builders: "Your harness can now get live EPSS-prioritized security intel for $0.005".

**Goal**: Real usage and volume visible on x402scan.

---

## Phase 5: Enhancements & Scaling

- **Distillation**: Add optional internal calls to other x402 services (e.g. X/social data) inside `intel.ts` for "live chatter" on a vuln. Use x402 client libs with budget.
- **LLM Synthesis**: Wire optional LLM (cheap model) for richer natural language in advice / summaries. Keep retrieval-first + citations.
- **Performance**:
  - Add Redis cache.
  - pgvector or simple embeddings for semantic vuln search.
  - Queue for background enrichment (BullMQ or in-memory).
- **Evals & Quality**:
  - Synthetic test cases in `test-local.ts` or new dir.
  - "LLM-as-judge" for actionability + grounding.
  - A/B prompt / scoring variants.
- **More Endpoints / Features**:
  - `/breaking` (high-EPSS recent).
  - SBOM upload lite (deps file parsing).
  - Reachability hints (basic).
- **Multi-chain**: Support Solana etc. via config.
- **Monetization Tuning**: Adjust prices based on usage. Add volume tiers if wanted.
- **Branding / Platform**: Expand beyond cyber when traction appears (general research oracle).

---

## Actionable Checklist (Start Here)

**Immediate (Today)**:
- [ ] Run local test and server.
- [ ] Make 2-3 real test calls with a wallet (testnet).
- [ ] Update `.env` and test with your domain in mind.

**This Week (VPS)**:
- [ ] Spin up VPS Docker.
- [ ] Get domain + HTTPS.
- [ ] Switch to testnet payments over public URL.

**Next 2 Weeks**:
- [ ] Register on x402scan.
- [ ] Implement basic MCP.
- [ ] Add 1-2 harness examples.
- [ ] Monitor first real payments.

**Ongoing**:
- Watch x402scan for your volume.
- Iterate on output quality from real agent usage.
- Log interesting queries (anonymized) to improve.

---

## Key Configs & Gotchas

- **Facilitator**: Start with `https://x402.org/facilitator` (test), move to CDP for mainnet/multi-net + better UX.
- **Prices**: Keep low ($0.005–$0.015) to bootstrap volume.
- **Data Freshness**: OSV/EPSS are excellent. Cache 5-60min locally is fine.
- **Liability**: Keep strong disclaimers in every response (already present).
- **Costs**: API calls are free. LLM (if added) will be main variable cost.

---

## Decisions to Make

- Exact pricing strategy.
- Whether to add LLM early or stay pure data-driven longer.
- VPS provider specifics / monitoring stack.
- When to expand beyond cyber.

---

## Resources

- x402: https://www.x402.org/ + Coinbase docs
- OSV.dev API: https://google.github.io/osv.dev/api/
- EPSS: https://www.first.org/epss/api
- x402scan registration
- Hono + x402 examples in the official repos

**Next step after reading this**: SSH into your VPS, follow Phase 2, and get the first public call working.

This doc + the actualized code in `server/` gives a complete path from "idea" to "live agent-used service".

Update this doc as you progress. Good luck!