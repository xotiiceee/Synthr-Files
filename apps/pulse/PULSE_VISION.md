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

### Layer 2: The Worker (Existing System)

The plan gets fed into Pulse's existing execution engine:

```
Goal Plan (JSON)
    │
    ▼
Goal Executor (new)
    │
    ├── Schedules tasks in the job queue
    ├── Tracks dependencies (don't post launch before teasers)
    ├── Reports progress back to user
    ├── Handles failures (retry, escalate, adapt)
    └── Updates the planner on results for learning
```

The worker uses the **same tools that already exist**: content generation, outreach, monitoring, auto-research. Nothing new to build at the execution layer — just better orchestration.

---

## What to Build (Phased)

### Phase 1: Natural Language Brand Setup (Now)

| Feature | What it does |
|---------|-------------|
| **`auto_setup` chat tool** | AI can call this when user says "I run X business". Creates brand, runs auto-research, sets topics/themes, generates initial content calendar — all from one message |
| **Welcome flow** | New users land directly in chat with a prompt: *"Hi! Tell me about what you want to automate..."* |
| **Context pre-fill** | Auto-extract business name, website, niche from user's first message |
| **Progress streaming** | Chat shows real-time progress: "Researching your niche... (3s) -> Found 14 topics -> Writing brand profile... -> Ready!" |

### Phase 2: Goal Decomposition (Week 2-3)

| Feature | What it does |
|---------|-------------|
| **Goal planner** | Accepts natural language goals like "launch my product", "grow by 20%", "post daily about X topic" |
| **Plan visualization** | Chat shows the plan: a timeline of what will happen when |
| **Plan approval** | User can see the plan before it starts, tweak things |
| **Job queue integration** | Plans become scheduled jobs with dependencies |

### Phase 3: Goal API & Autonomous Execution (Week 4-5)

| Feature | What it does |
|---------|-------------|
| **Goal API endpoint** | `POST /v1/goal` — send natural language goal + auth, get back a plan ID. `GET /v1/goal/:planId` — check progress |
| **Goal webhook** | Pulse pings your webhook as tasks complete. Optional — you can poll instead |
| **Autonomous budget** | Agent manages its own credit spend, picks models based on task importance. Deducts from free tier, Stripe, or x402 balance |
| **Self-healing** | If a task fails, the planner generates an alternative approach |
| **x402 as payment** | x402 validates off-chain USDC payments for credits. Users can pay with Stripe, x402, or free tier — agent doesn't care which |

### Phase 4: Multi-Agent & Marketplace (Future)

| Feature | What it does |
|---------|-------------|
| **Agent mesh** | Multiple Pulse agents can coordinate (e.g., brand agent + personal agent + research agent) |
| **Skill marketplace** | Publish your agent's capabilities, others can hire it via x402 |
| **Cross-platform** | Beyond X — LinkedIn, Reddit, Discord, newsletters |

---

## The Technical Piece: How Planning Works

The planner is just a **prompt + structured output**:

```typescript
// The planner prompt (sent to GPT-4o)
const PLANNER_PROMPT = `
You are Pulse's planning agent. Given a user's goal, decompose it into 
executable tasks. Each task maps to an existing Pulse capability.

Available capabilities:
- GENERATE_CONTENT: Create X posts, threads, images
- OUTREACH: Search for conversations and reply
- RESEARCH: Investigate a topic, competitor, or trend
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

// The plan executor
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

The key insight: **the planner doesn't write code. It outputs JSON that maps to existing tools.** The strong model handles the "what should I do" part. Pulse's existing engine handles the "how to do it" part.

---

## The Feel

Pulse should feel like a **co-founder, not a dashboard**. 

- **Conversational first**: Everything starts in chat. Buttons and forms are shortcuts, not requirements.
- **Proactive**: The agent suggests things. "I noticed 3 conversations about your competitor. Want me to engage?"
- **Transparent**: You always see what it's doing and why. Plans are visible. Budgets are clear.
- **Trustworthy**: Nothing posts without approval (unless you explicitly enable auto mode).
- **x402-native**: Anyone can call your Pulse agent programmatically. It's an API, not just a UI.

---

## Where We Are Now

| Capability | Status |
|-----------|--------|
| Brand auto-setup (research + profile + calendar) | Ready to wire up |
| Content generation | Working |
| Outreach/engagement | Working (needs X keys) |
| Scheduler | Working |
| Chat-based configuration | Working |
| x402 payment validation | Code exists (gated) |
| Natural language goal planning | Needs building |
| Goal execution with dependencies | Needs building |
| Autonomous budget management | Needs building |
| Multi-agent coordination | Future |
