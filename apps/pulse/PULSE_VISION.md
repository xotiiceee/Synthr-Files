# Pulse — Product Vision & Architecture Plan

## Core Vision

**Pulse is a sovereign AI agent you talk to like a person.** You tell it what you want — in plain English — and it figures out the rest. It researches, plans, writes, posts, engages, spends money, and reports back. It learns from results. It gets smarter every week.

Not a marketing tool. Not a social media scheduler. **Your agent.** For whatever you need automated in the X ecosystem and beyond.

---

## The Walkthrough (User Experience)

### First Visit: Zero Friction

```
User: "I run Sweet Treats Bakery in Brooklyn. sweet-treats.com"
Pulse: "Got it! [Researches website, niche, competitors — 30 seconds]
        Sweet Treats Bakery is a Brooklyn-based artisanal bakery specializing
        in custom cakes and pastries. Your community talks about weekend pastry
        popups, gluten-free options, and local food events. 
        
        I've set up 12 content themes and 18 conversation topics for you.
        Ready to connect your X account? [Connect X]"
```

**No forms. No dropdowns. No onboarding wizards.** Just talk.

### For a Brand

```
User: "Launch our new summer menu next week. Build hype for 3 days, 
       then go live on Tuesday at 10am."
       
Pulse: [Plans autonomously]
  Day 1-2: Teaser posts: "Something cold is coming..." 
           Engage with local food accounts asking about summer treats
  Day 3: Countdown post + behind-the-scenes kitchen photo
  Tuesday 10am: Full menu reveal thread (6 tweets)
  Post-launch: Reply to interested users, track engagement
  
User: "Nice. Also find me food influencers in Brooklyn with 5k+ followers
       and check if any mentioned us"
       
Pulse: "Found 14 food influencers. 3 mentioned you this month. 
        Want me to draft replies?" [...]
```

### For Personal Branding

```
User: "I'm a dev tools founder. Post twice a day about building in public,
       API design, and startup lessons. Keep it casual, no emojis."

Pulse: [Analyzes voice from timeline, sets up topics]
       "Set up. Your cadence: 9am industry insight, 6pm personal story.
        Topics: API design, dev tooling, startup growth, hiring engineers.
        Want me to draft this week's batch?" [...]
```

### For Anything (API Programmable)

```
Developer: curl -X POST https://pulse.synthr.online/v1/goal \
  -H "Authorization: Bearer $PULSE_API_KEY" \
  -d '{"goal": "Scrape 200 tech blogs daily, summarize the top 10 AI articles, 
               and post the best one to my X account with commentary."}'

Response: { planId: "plan_abc123", status: "running", estimatedBudget: 32 }

// Pulse handles everything: scraping, summarization, scheduling, posting
// Webhook notifies you at each milestone
// Pay via free tier credits, Stripe, or x402 — agent doesn't care how
```

**x402 is just a payment method** — same as Stripe, same as free tier. The agent interface is an API. You send a natural language goal, it sends back a plan ID. Payment is decoupled from the agent protocol.

**How the agent works internally:**
1. Receive goal via API (or chat)
2. Strong planning model decomposes it into tasks
3. Tasks execute via the existing job queue (content gen, outreach, monitoring, research)
4. Progress webhooks or polling at `/v1/goal/:planId`
5. Agent learns from results, adapts strategy

---

## Architecture: Two-Layer Execution Model

**Current foundation (actualized):** The backend work began by building a strong **Intelligence layer** — a unified in-process TS gateway (knowledge store + GitHub linkage + X intel) with real cost metadata (IntelMeta), semantic retrieval, and a thin x402 surface (`deep_research` + `decompose_goal` primitives). This provides the cache, provenance, and cheap signals that both the Planner and Worker will rely on. A Rust backend skeleton handles high-value seams (agents + x-intel gateway). Full goal execution is layered on top of this.

### Layer 1: The Planner (Strong Model)

When a user expresses a goal, a **planning model** (GPT-4o, Claude Sonnet) decomposes it:

```
User Goal: "Launch summer menu next week"
    │
    ▼
Planner (strong model)
    │
    ├── Task 1: Generate teaser content (3 posts, days -3 to -1)
    ├── Task 2: Outreach to food community (5 replies/day, days -2 to 0)
    ├── Task 3: Behind-scenes photo generation (1 image)
    ├── Task 4: Launch thread (6 tweets, Tuesday 10am)
    ├── Task 5: Post-launch engagement monitoring (48h window)
    └── Task 6: Performance report (Thursday)
    
    Budget: 45 credits | Timeline: 7 days
    Dependencies: Task 4 depends on 1,2,3 | Task 5 depends on 4
```

The planner outputs a **JSON goal plan** — not code, just a structured task list with dependencies, budget estimates, and success criteria.

### Layer 2: The Worker (Execution + Intelligence)

The plan gets fed into Pulse's execution engine (currently a hybrid of the TS hosted system + Rust backend for agents/intel). The Intelligence Gateway (actualized) supplies cached, measured data to every step:

```
Goal Plan (JSON)
    │
    ▼
Goal Executor (hybrid TS + Rust)
    │
    ├── Uses the Intelligence Gateway for cheap, traced context (X + GitHub + knowledge)
    ├── Schedules tasks in the job queue (or Rust worker paths)
    ├── Tracks dependencies
    ├── Reports progress + cost back to user
    ├── Handles failures (retry, escalate, adapt)
    └── Updates the planner on results for learning
```

The worker leverages the **Intelligence Gateway** (actualized) for all data acquisition plus the existing tools (content generation, outreach, monitoring, auto-research). The gateway ensures cache hits, cost transparency, and provenance before expensive steps. Nothing entirely new at the data layer — just disciplined use of the gateway + orchestration.

---

## What to Build (Phased)

### Phase 1: Intelligence Foundation + Basic Setup (Actualized / In Progress)

The backend golden plan delivered the core intelligence layer first:

| Feature | Status |
|---------|--------|
| Unified TS Intelligence Gateway (knowledge store + GitHub + X intel + real cost metadata) | Actualized (in-process) |
| Thin x402 primitives (`/v1/pulse/intel/research`, `/v1/pulse/goal/decompose`) | Prototyped + tested with real verify path |
| `decomposeGoal` + `GoalPlan` (basic dynamic planner/worker contract) | Working |
| Brand research + GitHub linkage + semantic search | Working |
| Rust backend skeleton (agents + x-intel) | In progress |

UI agent create/switcher and basic tabs are functional on the TS path; wiring to Rust backend is underway.

### Phase 2: Goal Decomposition & Planning (Partial)

| Feature | What it does | Status |
|---------|--------------|--------|
| **decompose_goal primitive** | Turns natural language into structured steps (foundation for planner) | Working (used in x402 + intel) |
| **Goal planner** | Accepts natural language goals and produces rich plans with dependencies + budget | Needs building (decompose is first slice) |
| **Plan visualization / approval** | Show timeline in chat, let user tweak | Future |
| **Job queue integration** | Plans become executable tasks | Future |

### Phase 3: Goal API & Execution (Future)

| Feature | What it does |
|---------|-------------|
| **Goal API endpoint** | `POST /v1/goal` — send natural language goal + auth, get back a plan ID. `GET /v1/goal/:planId` — check progress |
| **Goal webhook + self-healing** | Progress notifications; planner adapts on failure |
| **Autonomous budget** | Agent manages spend across free tier / Stripe / x402 |
| **x402 as payment** | Already prototyped in the thin surface |

### Phase 4: Multi-Agent & Marketplace (Future)

| Feature | What it does |
|---------|-------------|
| **Agent mesh** | Multiple Pulse agents can coordinate (e.g., brand agent + personal agent + research agent) |
| **Skill marketplace** | Publish your agent's capabilities, others can hire it via x402 |
| **Cross-platform** | Beyond X — LinkedIn, Reddit, Discord, newsletters |

---

## The Technical Piece: How Planning Works

A basic `decomposeGoal` + `GoalPlan` contract has been implemented (see `src/core/knowledge-store.ts` and `intel-primitives.ts`). It produces dynamic steps from the goal text as the first real slice of the planner/worker model. The full LLM-driven rich planner below remains the target for Phase 2+.

The planner will ultimately be a **prompt + structured output**:

```typescript
// The planner prompt (sent to strong model)
const PLANNER_PROMPT = `
You are Pulse's planning agent. Given a user's goal, decompose it into 
executable tasks. Each task maps to an existing Pulse capability (or the
Intelligence Gateway for research/context).

Available capabilities:
- GENERATE_CONTENT: Create X posts, threads, images
- OUTREACH: Search for conversations and reply
- RESEARCH: Investigate a topic, competitor, or trend (prefer gateway)
- MONITOR: Track mentions, engagement, sentiment
- SCHEDULE: Time-based trigger for any task

Output a JSON plan:
{
  "goal": "user's goal in their words",
  "tasks": [
    {
      "id": "task_1",
      "type": "GENERATE_CONTENT",
      "params": { "count": 3, "theme": "product_teaser", "platform": "x" },
      "schedule": "2026-06-01T09:00:00Z",
      "dependsOn": [],
      "budget": 5
    }
  ],
  "estimatedTotal": 45,
  "successCriteria": "3 teaser posts published, engagement > 2%"
}
`

// The plan executor (future)
async function executeGoal(plan: GoalPlan, tenantId: string) {
  for (const task of topologicalSort(plan.tasks)) {
    await waitForDependencies(task, plan.tasks);
    const result = await executeTask(task, tenantId);
    if (!result.ok) {
      await replan(task, result.error, tenantId);
    }
    notifyProgress(tenantId, task, result);
  }
}
```

The key insight: **the planner doesn't write code. It outputs structured plans that map to tools and (critically) the Intelligence Gateway.** The strong model handles the "what should I do" part. The gateway + worker engine handles cheap data acquisition and reliable execution.

---

## The Feel

Pulse should feel like a **co-founder, not a dashboard**. 

- **Conversational first**: Everything starts in chat. Buttons and forms are shortcuts, not requirements.
- **Proactive**: The agent suggests things. "I noticed 3 conversations about your competitor. Want me to engage?"
- **Transparent**: You always see what it's doing and why. Plans are visible. Budgets are clear.
- **Trustworthy**: Nothing posts without approval (unless you explicitly enable auto mode).
- **x402-native**: Anyone can call your Pulse agent programmatically. It's an API, not just a UI.

---

## Where We Are Now (mid-2026)

**Note:** The backend foundations described in the (now archived) Pulse as a Service — Backend Golden Plan have been actualized: unified in-process TS Intelligence Gateway (knowledge-store + GitHub + X intel with real IntelMeta cost/savings/trace), thin x402 primitives (`deep_research` + `decompose_goal`), chat/agent parity, and a Rust backend skeleton for agents + x-intel. Full autonomous goal execution remains future work.

| Capability | Status |
|-----------|--------|
| Unified Intelligence Gateway (knowledge + GitHub linkage + X intel + cost metadata) | Working (in-process TS) |
| Thin x402 intelligence surface (deep_research + decompose_goal primitives returning blocks + IntelMeta) | Prototyped + tested (real verify path) |
| Goal decomposition (decomposeGoal + GoalPlan types, basic planner/worker contract) | Working (dynamic from goal tokens) |
| Rust backend (agents + x-intel gateway) | In progress (skeleton + core endpoints; agents/intel surface) |
| Content generation | Working |
| Outreach/engagement | Working (needs X keys) |
| Scheduler | Working |
| Brand auto-setup / research | Partial (knowledge store + GitHub push + semantic search wired) |
| Full natural language goal planning + execution (POST /v1/goal, planId, dependencies, self-healing) | Needs building (decompose is the foundation) |
| Autonomous budget management + multi-agent | Future |
| UI (agent tabs, create agents, conversational flows) | Functional on TS-hosted (simpler agent code); wiring to Rust in progress |
| x402 production payments | Prototyped (PULSE_X402_TEST_ACCEPT + legacy verifier; full facilitator future) |
