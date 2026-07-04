# Synthr Tools

High-signal, pay-per-insight services for users and autonomous AI agents on the x402 network.

Services are exposed as x402 endpoints: agents discover via x402scan, pay in micro-USDC on-chain (no keys, no subscriptions), and receive structured, actionable results.

## Vision

Become a leading intelligence and tooling layer in the agent economy. Focus on genuinely differentiated, high-bang-for-buck services that agents will repeatedly choose to call because the outcome is worth the tiny cost.

Current flagship direction: Cybersecurity intelligence tailored for agentic builders and harnesses (detailed in the plan). Expansion into broader distilled research/intelligence products.

## Key Document

**Read the full strategic plan and vision here:**

[docs/SYNTHR-TOOLS-VISION-AND-PLAN.md](./docs/SYNTHR-TOOLS-VISION-AND-PLAN.md)

It covers:
- Deep analysis of x402 ecosystem and what actually succeeds today
- Brutally honest evaluation of the cybersecurity idea (and alternatives)
- Ranked golden opportunities with rationale
- Strategic recommendations and first bet
- Detailed product spec, architecture, build plan, data strategy, GTM
- Roadmap, risks, and why this approach

## Status

**Local Implementation Actualized** (June 2026)

- Core cybersecurity intelligence service is **live and functional**:
  - Real-time data from OSV.dev (no rate limits), EPSS exploit probabilities, CISA KEV.
  - Smart features: EPSS prioritization, `agentSurface` scoring for harnesses, provenance, caching.
  - Endpoints working: `/v1/cyber/stack-brief`, `/audit-deps`, `/advice`, `/vulns`.
- `server/` is ready for local dev and testing (Hono + TS, Node/Bun compatible).
- Full strategic vision in `docs/SYNTHR-TOOLS-VISION-AND-PLAN.md`.

**Next phases** (VPS setup, production payments, x402scan listing, MCP, enhancements): See [docs/NEXT-PHASES.md](./docs/NEXT-PHASES.md)

The repo is now actionable locally. External builders can run `cd server && npx --yes tsx test-local.ts` to see real intel.

## Principles

- Agent-first design (structured outputs, easy integration, provenance)
- Real value via distillation and synthesis — not raw data dumps or generic wrappers
- Leverage other x402 services intelligently as inputs where it creates superior output
- Start narrow and deep for defensibility and traction
- Transparent, low-friction, worth every micro-payment

## Next

See the plan doc for phased execution details. We have a VPS available for hosting.

Contributions, ideas, or harness integration interest: open issues or reach out.

---

*Synthr Tools — Synthesis for the agentic web.*