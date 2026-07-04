# PULSE Customization Guide

Status: canonical

How to adapt PULSE for any niche in 5 steps.

## Step 1: Define Your Persona

Your persona is the "character" Pulse plays when engaging online. Be specific:

- **Bad:** "We sell software"
- **Good:** "Solo dev who built a project management tool after getting burned by Jira's pricing. Opinionated about developer experience. Speaks from real experience shipping products."

Edit `persona` in `pulse.yaml`:

```yaml
persona:
  name: "Alex"
  brandName: "TaskForge"
  website: "https://taskforge.dev"
  niche: "project management for engineering teams"
  problemSolved: "Jira is bloated and expensive for small teams"
  uniqueValue: "Simple, fast, $0/month for teams under 10"
  tone: "technical"
```

## Step 2: Choose Your Topics (5-7 recommended)

Topics define WHAT conversations Pulse looks for. Pick pain points your customers discuss.

### Example: Fitness App

```yaml
topics:
  - id: "home-workout"
    query: "home workout routine OR at-home fitness OR no-equipment exercise"
    textMustMatch: ["workout", "exercise", "fitness", "home"]
    replies: []
  - id: "gym-expensive"
    query: "gym membership cost OR can't afford gym OR expensive fitness"
    textMustMatch: ["gym", "expensive", "cost", "afford"]
    replies: []
  - id: "fitness-tracker"
    query: "best fitness app OR fitness tracker comparison OR workout app"
    textMustMatch: ["app", "fitness", "tracker", "workout"]
    replies: []
```

### Example: B2B Accounting Software

```yaml
topics:
  - id: "small-biz-tax"
    query: "small business taxes OR tax deduction missed OR bookkeeping nightmare"
    textMustMatch: ["tax", "business", "bookkeep", "accounting"]
    replies: []
  - id: "invoice-pain"
    query: "manual invoicing OR late payments freelance OR invoice automation"
    textMustMatch: ["invoice", "payment", "manual", "automat"]
    replies: []
  - id: "quickbooks-alternative"
    query: "QuickBooks alternative OR QuickBooks expensive OR accounting software"
    textMustMatch: ["quickbooks", "accounting", "software", "alternative"]
    replies: []
```

### Example: Developer Tools / API

```yaml
topics:
  - id: "api-monitoring"
    query: "API monitoring OR API downtime OR endpoint reliability"
    textMustMatch: ["api", "monitor", "downtime", "endpoint"]
    replies: []
  - id: "developer-experience"
    query: "developer experience OR DX improvement OR SDK quality"
    textMustMatch: ["developer", "experience", "SDK", "documentation"]
    replies: []
  - id: "integration-hell"
    query: "API integration nightmare OR webhook debugging OR REST vs GraphQL"
    textMustMatch: ["integration", "webhook", "API", "debug"]
    replies: []
```

## Step 3: Set Your Tone

| If your brand is... | Set tone to... | casualtyLevel |
| ------------------- | -------------- | ------------- |
| Enterprise B2B      | "professional" | 0.2-0.3       |
| Developer tools     | "technical"    | 0.4-0.6       |
| Consumer/lifestyle  | "friendly"     | 0.6-0.8       |
| Gen-Z / creator     | "casual"       | 0.8-1.0       |

## Step 4: Configure X

For standalone launch, keep X as the canonical automation surface. Non-X surfaces may be useful as historical references or draft-only experiments, but should stay disabled for customer launch unless a current ADR explicitly restores them.

| Surface                           | Launch posture               | Notes                                                                     |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| X/Twitter                         | Canonical automation surface | Use the X API tier that supports your expected read/write volume          |
| LinkedIn                          | Draft-only when enabled      | Manual posting only                                                       |
| Reddit, Discord, HN, Product Hunt | Non-canonical                | Keep disabled for launch automation unless a current ADR restores support |

## Step 5: Choose Your AI Provider

| Provider  | Cost            | Quality   | Best for                         |
| --------- | --------------- | --------- | -------------------------------- |
| Groq      | Usage-based     | Good      | Starting out, budget-conscious   |
| OpenAI    | ~$0.15/1K calls | Very good | Best all-around quality          |
| Anthropic | ~$0.25/1K calls | Excellent | Most natural conversational tone |

Start with Groq for local development. Switch providers if replies feel robotic or if production policy requires a different quality/cost tradeoff.

## First Week Workflow

1. **Day 1:** `npm run dry-run` — preview replies without posting
2. **Day 1-2:** Review 10-20 generated replies. Adjust tone in `humanBehavior`
3. **Day 2-3:** Enable autopost with `approvalMode: "review_all"`
4. **Day 4-7:** Monitor replies. Run `npm run report` daily
5. **Day 7:** Analyze which topics got best engagement, adjust weights
6. **Week 2+:** Reduce `approvalMode` to `"review_risky"` if comfortable
