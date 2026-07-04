# Key Files & Environment

Status: canonical

## Key Files

| File                                     | Why it matters                                            |
| ---------------------------------------- | --------------------------------------------------------- |
| `src/intelligence/brand-profile.ts`      | Single source of truth. Everything reads from here.       |
| `src/intelligence/prompt-builder.ts`     | Unified prompt assembly. Consistency across all output.   |
| `src/intelligence/auto-research.ts`      | Onboarding magic. Niche → deep context in 30s.            |
| `src/intelligence/engagement-monitor.ts` | Feedback loop. Makes the system learn.                    |
| `src/intelligence/content-generator.ts`  | Post generation. Reads profile, domain knowledge, themes. |
| `src/intelligence/reply-generator.ts`    | Reply generation. Thread-aware variant.                   |
| `src/intelligence/thread-analyzer.ts`    | Thread intelligence. Scores replies, picks best target.   |
| `src/intelligence/post-validator.ts`     | Safety net. LLM slop, emoji, style enforcement.           |
| `src/intelligence/input-sanitizer.ts`    | Prompt injection defense.                                 |
| `src/core/agent-state.ts`                | Per-agent state isolation.                                |
| `src/intelligence/content-dna.ts`        | Content Style DNA. Learns from outcomes.                  |
| `hosted/preference-engine.ts`            | Chat preferences. Signal processing, smart import.        |
| `src/intelligence/topic-discovery.ts`    | LLM-powered search topic generation.                      |
| `src/modes/autopost.ts`                  | Scheduler content path. DNA/rules injection.              |
| `hosted/ui/src/pages/Media.tsx`          | Media library UI.                                         |
| `src/core/asset-library.ts`              | Asset storage. Tag-based matching.                        |
| `src/intelligence/image-gen.ts`          | Image generation via ClawNet.                             |
| `docs/reference/product-context.md`      | Product knowledge for chat bot.                           |
| `hosted/server.ts`                       | All API endpoints.                                        |
| `hosted/scheduler.ts`                    | Background task runner for all tenants/agents.            |

## Environment Variables

```bash
# Server-side LLM (customers don't need these)
GROQ_API_KEY=gsk_...           # Default local-dev LLM provider
ANTHROPIC_API_KEY=sk-ant-...   # Optional, for Claude models
OPENAI_API_KEY=sk-...          # Optional, for GPT models
OPENROUTER_API_KEY=sk-or-...   # Optional, also satisfies hosted LLM readiness

# Search
SEARCH_PROVIDER=serper          # serper|brave|serpapi
SERPER_API_KEY=...              # Required when SEARCH_PROVIDER=serper
BRAVE_API_KEY=...               # Required when SEARCH_PROVIDER=brave
SERPAPI_API_KEY=...             # Required when SEARCH_PROVIDER=serpapi

# ClawNet (enables thread engagement, image gen, real-time search)
CLAWNET_API_KEY=cn-...          # Optional but recommended
CLAWNET_API_URL=https://api.claw-net.org

# Hosted mode
NODE_ENV=production
HOSTED_PORT=3457
PULSE_URL=https://app.your-pulse-domain.com
HOSTED_DB_PATH=/home/deploy/pulse/data/hosted.db  # Required by strict customer launch
PULSE_HEART_PATH=/home/deploy/pulse/data/pulse-heart.json  # Required by strict customer launch
TENANT_ENCRYPTION_KEY=...       # Required for X key encryption
ADMIN_API_KEY=...               # Required operator API key, 32+ chars
PULSE_HEART_SECRET=...          # Required for stable hosted heart identity
RESEND_API_KEY=...              # Required by strict customer launch; OTP/security emails
RESEND_FROM=Pulse <notifications@your-pulse-domain.com>  # Required by strict customer launch
PULSE_SUPPORT_EMAIL=support@your-pulse-domain.com        # Required by strict customer launch
X_OAUTH_CLIENT_ID=...           # Required by strict customer launch
X_OAUTH_CLIENT_SECRET=...       # Required by strict customer launch
X_MONTHLY_POST_LIMIT=3000       # Required by strict customer launch; approved X write capacity
GITHUB_OAUTH_CLIENT_ID=...      # Required when GITHUB_CALLBACK_URL is configured
GITHUB_OAUTH_CLIENT_SECRET=...  # Required when GITHUB_CALLBACK_URL is configured

# Standalone migration flags
AUTH_PROVIDER=firstparty        # clawnet|firstparty
BILLING_PROVIDER=stripe         # clawnet|stripe
STRIPE_WEBHOOK_SECRET=whsec_... # required when BILLING_PROVIDER=stripe
SCHEDULER_MODE=durable          # legacy|durable
PULSE_DURABLE_SCHEDULER_WRITES=true  # required by strict customer launch
PULSE_ALLOW_FOLLOW_CHURN=       # empty by default; truthy opt-in for hosted follow/unfollow churn
PULSE_CUSTOMER_LAUNCH=false     # true enables stricter final customer-launch gates
REQUIRE_PIN=true                # optional; false warns in production readiness
```

## Standalone Runtime Flags

These flags preserve rollback paths while Pulse moves from ClawNet-backed
defaults to standalone production behavior.

| Variable                         | Default   | Production target | Notes                                                                                                                                |
| -------------------------------- | --------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_PROVIDER`                  | `clawnet` | `firstparty`      | ClawNet auth remains the rollback path until the first-party login surface is fully cut over.                                        |
| `BILLING_PROVIDER`               | `clawnet` | `stripe`          | Stripe uses durable subscription entitlements and fails closed when no active/trialing entitlement exists.                           |
| `STRIPE_WEBHOOK_SECRET`          | unset     | set               | Required when `BILLING_PROVIDER=stripe`; verifies `Stripe-Signature` for `POST /webhooks/stripe`.                                    |
| `SCHEDULER_MODE`                 | `legacy`  | `durable`         | Durable mode runs scheduler jobs through the jobs table. Monitor is always durable in durable mode.                                  |
| `PULSE_DURABLE_SCHEDULER_WRITES` | `false`   | `true` at cutover | Enables durable content/outreach write jobs after X-write ledger crash-replay coverage is green. Required by strict customer launch. |
| `PULSE_ALLOW_FOLLOW_CHURN`       | unset     | unset             | Hosted follow/unfollow churn is disabled by default. Set only for an explicit, reviewed opt-in.                                      |
| `PULSE_CUSTOMER_LAUNCH`          | `false`   | `true` at cutover | Enables stricter final launch gates for standalone auth, Stripe billing, real domain, and durable autonomous-write readiness.        |

Run `npm run check:production` before deploy-readiness review, but do not treat
a passing deploy-readiness result as sufficient for cutover by itself. For final
customer cutover, run `npm run check:customer-launch`; this sets
`PULSE_CUSTOMER_LAUNCH=true` and fails closed while placeholder/ClawNet domains,
non-standalone auth/billing, missing X OAuth credentials, missing explicit X
write capacity, or disabled durable content/outreach writes remain. Real
deployed Stripe webhook delivery, final domain configuration, and X safety soak
still gate launch.
