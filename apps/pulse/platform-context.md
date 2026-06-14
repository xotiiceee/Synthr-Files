# Product Context — for Pulse AI Chat Bot

Use this as ground truth when answering questions about our products. Never inflate numbers. If unsure, say "I'd need to check" rather than guessing.

---

## 1. ClawNet (claw-net.org) — Sovereign API orchestration for AI agents.

Natural language in, multi-step API workflows out. Agents describe what they need, ClawNet finds the optimal path.

- **13,000+ API endpoints** across 15 categories (DeFi, social, security, AI-ML, oracles, scraping, search, media, enrichment, infrastructure, discovery, utility, intelligence, weather, solana). Catalog auto-syncs every 4 hours from multiple sources (402index, Coinbase, Satring, Cascade, Dexter, x402list, Zauth).
- **Orchestrated mode:** POST /v1/orchestrate — natural language query, LLM picks endpoints, 2-credit orchestration fee + endpoint costs
- **Direct mode:** POST /v1/endpoints/:id/call — call a specific endpoint by ID, no LLM, no orchestration fee
- **4 budget strategies:** cheapest, balanced, fastest, reliable — agents set maxCredits, platform finds the optimal plan
- **Circuit breaker** on every endpoint — auto-marks degraded endpoints, fails fast instead of timing out
- **Smart Cache:** L1 memory (10k max, LFU eviction weighted by credit cost) + L2 Redis (gzip >1KB), semantic key normalization (SOL = sol = Solana), stale-while-revalidate, negative caching (30s)
- **Skills Marketplace:** creators publish high-value services, earn 85% revenue per invocation. Skills have SLA contracts (uptime, latency, success rate), semantic versioning, input/output schemas
- **Composite Skills:** chain multiple skills with output piping (step 1 result feeds step 2), parallel execution groups, conditional steps ("only run if riskScore > 50"), retry + fallback
- **x402 payments:** agents pay USDC on Base (EVM) per-request, no ClawNet account needed. Facilitator pool with automatic failover (Coinbase, PayAI, Skyfire)
- **Delegated child keys** with bounded daily/weekly spend caps — parent funds child, child can't exceed limits
- **Credit rate:** 1 credit = $0.001 (1000 credits per USD). Fractional credits supported (minimum 0.001)
- **Revenue split:** 85% to skill creators, 15% to platform. Registry endpoints are 100% platform revenue (~33% margin via cost markup)
- **Soma provenance:** live API calls get cryptographic birth certificates (SHA-256 data hash + Ed25519 signature). Cache hits are cheaper (10% of live cost) but don't produce certificates.

## 2. Pulse — Standalone X Marketing Agent.

Customers enter a brand name and niche. Pulse auto-researches the community, learns the voice, and runs autonomous marketing.

- **Platforms:** X is the canonical launch platform. LinkedIn may generate drafts only when enabled. Do not claim Reddit or Discord full automation unless a current launch ADR explicitly restores it.
- **Auto-research:** on agent creation, Pulse searches the niche via configured search/listening providers such as Serper, and ClawNet only while configured as a provider. It analyzes community voice, discovers trending topics, pain points, and key voices. Populates brand profile and domain knowledge asynchronously.
- **Brand Profile:** single source of truth for identity, voice, style rules (hashtags, emoji, polls, story openers), content themes, and learned patterns. Customer-controlled via chat or the Brand Intelligence page.
- **Content creation:** posts, threads, replies — all use the unified prompt builder with brand profile rules. Platform-aware formatting (character limits, tone expectations).
- **Thread-aware engagement:** replies to the best comment in a thread (not the OP). Scores replies by type (question > pain point > opinion), author quality (KOL detection), and engagement momentum.
- **Engagement learning:** monitors post performance 4-36h after posting. Auto-adjusts content mix (educational/personal/engagement/promotional) based on what resonates. Tracks top/bottom performers and best posting hours.
- **Growth mode:** hosted follow/unfollow churn is disabled by default. Pulse should behave as a serious engagement automation tool, not a follow bot.
- **Autopilot modes:** Off (manual), Semi-Auto (drafts for review), Full Auto (generate + post immediately).
- **Post validation:** 17 LLM slop patterns, neverSay enforcement, emoji/story opener rule checking, number inflation detection against key facts. Catches bad posts before they go live.
- **Billing:** standalone launch posture is subscription and entitlement billing through Stripe, backed by durable usage events. Legacy ClawNet credits remain a rollback/provider path during migration, not the canonical standalone billing model.
- **Server-side LLM keys:** hosted customers do not bring provider keys for Groq/OpenAI/Anthropic. Usage is metered through Pulse billing and entitlements.

## 3. Soma — Cryptographic Identity & Data Provenance (github.com/1xmint/Soma)

Proves identity through physics: temporal fingerprinting of model inference + per-token HMAC authentication. You can't fake Claude's inference rhythm without running Claude.

**Two components:**
- **soma-heart** (agent side): execution runtime, credential vault, birth certificates, heartbeat chain, per-token HMAC
- **soma-sense** (observer side): temporal/topology/vocabulary fingerprinting, phenotype atlas, behavioral verdicts (GREEN/AMBER/RED/UNCANNY)

**What's built and integrated into ClawNet:**
- **Birth certificates** on live API calls: SHA-256 data hash + Ed25519 signature + heartbeat chain position. Proves "I called this URL, got this data, here's the hash." Note: cached responses and fallback paths don't produce certificates.
- **Heartbeat chain:** sequential verification — each heartbeat references the previous hash, creating a tamper-evident computation log.
- **Genome:** cryptographic identity of the orchestrator instance (model provider, model ID, runtime, cloud region, deployment tier, system prompt hash).
- **LLM generation provenance:** ClawNet's internal LLM calls route through heart.generate() for per-token HMAC authentication and heartbeat chain entries.
- **On-chain anchoring:** Soma verdict Merkle roots anchored to Solana via memo transactions (~$0.024/day).
- **Offline verification:** clients can verify birth certificates with just the public key (available at /.well-known/soma.json). No callback to ClawNet required.
- **Billing receipts:** credit charges are signed when Soma heart is available (best-effort, not guaranteed).

**Key distinction:** Data provenance (birth certificates) != model verification (sense verdicts). ClawNet runs the heart. Callers run the sense. ClawNet does NOT verify itself — the observer must be a separate party.

**ERC-8004 registrations on Base Mainnet:**
- 36119 — ClawNet
- 37696 — Soma protocol

---

## What NOT to claim

- 13,000+ endpoints is accurate — 274 built-in + rest from auto-discovery catalogs that sync every 4 hours
- Don't say "Solana payments" for x402 — x402 uses USDC on Base (EVM). Solana is for deposit receiving.
- Don't say "every API call" has provenance — only live calls when Soma heart is active
- Don't say LinkedIn has full automation — it's draft-only
- Don't say Pulse is a ClawNet product — ClawNet is a provider/dependency where configured
- Don't say Pulse supports Reddit or Discord full automation unless a current launch ADR says so
- Don't say ClawNet credits are canonical standalone billing
- Don't say billing is only per-token or only fixed per action — standalone billing uses subscription entitlements plus durable usage events
- Don't say "$1-2/month" as a general cost — it depends heavily on model choice, volume, and plan policy
- Don't conflate Soma provenance with verification — provenance proves origin, verification requires an independent observer running sense
