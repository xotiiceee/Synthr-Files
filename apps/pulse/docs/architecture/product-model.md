# Architecture Decisions

Status: canonical


## Brand Profile is the single source of truth
`src/intelligence/brand-profile.ts` — NOT pulse.yaml, NOT knowledge notes.

**Why:** There were three systems fighting — persona from yaml, voice from knowledge notes, style from hardcoded rules. The LLM got contradictory instructions. Brand profile unifies identity, voice, style rules, content mix, content themes, and learned patterns into one per-agent document.

**Hierarchy:** Brand profile > knowledge notes > pulse.yaml. If they conflict, brand profile wins. Knowledge notes are domain knowledge (facts about the niche), not identity/voice.

## Per-agent state isolation
`src/core/agent-state.ts` — `loadAgentState('brand-profile')` → `brand-profile-{agentId}.json`

**Why:** Multi-agent customers (e.g., 3 meme coins) need separate brand profiles, domain knowledge, and content themes. Without per-agent state, agent A's research overwrites agent B's. Everything that varies per agent uses `loadAgentState`/`saveAgentState`.

## Auto-research runs on agent creation
`src/intelligence/auto-research.ts` — triggered in `hosted/server.ts` POST /api/agents

**Why:** If research runs later (on first post, on a timer), the customer's first interaction produces generic content. By running research at creation time (async, ~30s), the brand profile and domain knowledge are populated before they click Generate Post. The niche-based fallback themes cover the race condition if they click before research completes.

## Unified prompt builder
`src/intelligence/prompt-builder.ts` — `buildIdentityBlock()` + `buildContextBlock()`

**Why:** Content generator and reply generator were building prompts independently, with overlapping and sometimes contradictory context. One identity block ensures consistent voice across all output.

## Style rules are customer-controlled, not hardcoded
Brand profile has: `useHashtags`, `usePolls`, `emojiUsage`, `useStoryOpeners`, `customRules[]`

**Why:** A meme coin community wants heavy emoji and hashtags. A B2B SaaS founder wants neither. Hardcoding "no hashtags" breaks every customer who wants hashtags. Auto-research sets initial defaults from niche analysis, then the customer can override.

## Content mix auto-adjusts from engagement
Brand profile has: `contentMix: { educational, personal, engagement, promotional }`

**Why:** Content mix shifts based on engagement data. The engagement monitor stores content type at post time, calculates average scores per type, and calls `adjustContentMix()` which shifts weights ±25% per adjustment (min 2% per type, max 80%, normalized to 100%).

## Thread engagement > OP replies
`src/intelligence/thread-analyzer.ts` — replies to the best COMMENT in a thread, not the original poster

**Why:** Replying to OP is cold outreach. Replying to a specific comment in a popular thread is joining a conversation. The thread analyzer scores each reply by: reply type, author quality, engagement, and text substance.

## Engagement feedback is the learning engine
`src/intelligence/engagement-monitor.ts` — checks posts 4-36h later

**Why:** Without feedback, the system flies blind. The monitor: (1) fetches engagement via the configured listening provider, ClawNet while configured, (2) feeds the learning engine, (3) auto-amplifies high performers (3x avg), (4) adjusts content mix, (5) updates the activity feed.

## Post validation catches LLM slop
`src/intelligence/post-validator.ts` — rule-based, instant, no LLM call

**Why:** LLMs produce bad output sometimes. Validation catches this BEFORE posting. Rules check: char limits, neverSay words, LLM slop patterns (17 patterns), number inflation, style rule violations, emoji count enforcement.

## Hosted Mode

Multi-tenant SaaS. The standalone launch posture is first-party auth (`AUTH_PROVIDER=firstparty`), Stripe-backed billing (`BILLING_PROVIDER=stripe`), durable usage events, and server-side LLM keys. ClawNet auth and credit billing remain provider/rollback paths during migration, not the canonical customer model.

**Scheduler** (`hosted/scheduler.ts`): Every 5 minutes, processes all active tenants (mutex-guarded). For each running agent: runs due tasks, ensures search topics exist, detects @mentions, checks engagement feedback, refreshes niche trends weekly.

**Tenant isolation** (`hosted/tenant.ts`): `withTenantContext()` sets per-tenant data directory via AsyncLocalStorage. X API credentials read from context (not process.env). State files scoped to tenant.

**Pages**: React SPA — Chat, Autopilot, Create, Media, Knowledge, Activity, Growth, Brand Intelligence, Settings.

**Billing** (`hosted/billing.ts`, `hosted/billing-operations.ts`): Standalone billing runs through Stripe entitlements plus durable usage events. Generation cost is metered from actual model/provider usage where available, with legacy ClawNet credit deduction retained behind the billing provider boundary for rollback and migration support.

**Security**: PIN required on return visits (5-min cookie sliding window). 30-min frontend idle timeout. `Idempotency-Key` on all credit deductions. Input sanitizer strips prompt injection.

## Adaptive Preference System

Pulse learns from what the customer DOES, not what they say. Like Spotify learning taste from skips/replays.

**Signal collection** (`hosted/db.ts`): Every user action records a signal — draft approved/rejected/edited, suggestion accepted/dismissed, note locked/deleted, chat message style, config changes.

**Preference profile** (`hosted/preference-engine.ts`): Built from last 200 signals. Tracks: strategic posture, competitor stance, content style, risk tolerance, communication preference, autonomy level, chat style.

**Chat style mirroring**: `detectChatStyle()` analyzes each message for brevity, formality, emoji usage. Profile converges after ~3 messages.

**Server-side smart import**: Messages over 500 chars with markdown structure are auto-chunked and saved as knowledge notes directly. Clean chunking, fuzzy deduplication, auto brand detection.

**Product context** (`docs/reference/product-context.md`): Operator-maintained product knowledge. Auto-loaded into every chat session.

### Still needs work (chat/preference system)
- Proactive opening — briefing with real engagement data
- Preference drift detection
