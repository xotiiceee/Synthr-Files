# Quick Start Guide

Get PULSE running in 5 minutes and make your first outreach attempt.

## What PULSE Does

PULSE is an AI marketing agent that finds real X conversations happening right now about problems your product solves, then crafts genuine, helpful replies that build awareness without being spammy. For standalone launch, X is the canonical automation surface; non-X material is retained as draft or legacy context unless a current ADR restores it.

## Prerequisites

- **Node.js 18+** — check with `node --version`
- **LLM provider key** — Groq is the default local-dev provider; production hosted usage is metered through Pulse billing
- **Serper API key** — used for standalone search and listening
- **X/Twitter API keys** — apply at [developer.x.com](https://developer.x.com) and choose an API tier that supports your expected automation volume

Start with X. Non-X surfaces should remain disabled for launch automation unless a current launch ADR explicitly enables them.

## 4-Step Setup

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Run the interactive setup wizard

```bash
npm run setup
```

This creates your `.env` file and `pulse.yaml` config. It will ask about your product, audience, and which X workflows to activate. Answer honestly — the AI calibrates its tone and topic selection based on your answers.

### Step 3: Verify your configuration

```bash
npm run test-config
```

This checks every API key, verifies rate limits, and confirms your config file is valid. Fix any red items before proceeding. Green checkmarks mean you're good.

### Step 4: Do a dry run

```bash
npm run dry-run
```

Dry run searches for real conversations and generates replies, but **does not post anything**. Review the output to see exactly what PULSE would say on your behalf. Adjust your config if the tone or topics feel off.

## What to Expect on First Run

When you run `npm start` for real:

- **First 10 minutes:** PULSE searches for relevant X conversations
- **Minutes 10-30:** It filters results by relevance score, discarding anything below your threshold
- **Ongoing:** It replies to high-relevance conversations, spacing actions out to avoid rate limits
- **Every hour:** A brief log summary shows what was sent, skipped, and queued

On day one, expect 5-15 outreach actions depending on your niche and X account posture. PULSE intentionally starts slow to warm up your account.

## Next Steps

1. **Read the [X/Twitter](01-x-twitter.md) playbook** before enabling autonomous replies
2. **Check your first report** after 24 hours: `npm run report`
3. **Tune your config** — adjust `relevanceThreshold` up if replies feel off-topic, down if too few results come through
4. **Keep non-X platforms disabled for launch automation** unless the current ADR set changes
5. **Read the [Content Strategy](07-content-strategy.md) playbook** to understand the content mix PULSE uses

The most important thing: **let it run for a full week before making big changes.** The adaptation engine needs data to optimize. Early results are not representative of steady-state performance.
