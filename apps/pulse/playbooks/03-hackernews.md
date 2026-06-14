# Hacker News Strategy

Hacker News is the most valuable and most dangerous platform for developer-focused products. One front-page Show HN can drive thousands of signups. One whiff of marketing and your posts get flagged into oblivion.

## HN Culture

Hacker News (news.ycombinator.com) is run by Y Combinator and has a fiercely anti-marketing culture. The community values:

- **Technical depth** — explain how things work, not just what they do
- **Intellectual honesty** — admitting tradeoffs and limitations earns respect
- **Original thinking** — regurgitated advice gets ignored, novel insights get upvoted
- **Substance over polish** — a raw, honest comment beats a perfectly crafted one
- **Show, don't tell** — code, benchmarks, and architecture diagrams beat adjectives

What HN actively punishes:

- Any comment that reads like marketing copy
- Superlatives ("revolutionary", "game-changing", "the best")
- Comments that only exist to promote something
- Shallow agreement ("great point!", "+1", "this is so true")
- Accounts that only comment on topics related to their product

## Why PULSE Is Read-Only on HN

Hacker News has no public posting API. This is intentional — the community explicitly rejects automated posting. PULSE monitors HN but does not and cannot post on your behalf.

What PULSE does for HN:

- **Monitors front page and "new" for relevant conversations** matching your topics and keywords
- **Alerts you in real time** when a high-relevance discussion appears
- **Generates draft replies** tuned to HN's tone and quality bar
- **Tracks threads** you've participated in for follow-up opportunities

You post manually. This is actually an advantage — your HN presence stays authentically human.

## Using PULSE's HN Monitoring

### Setup

Enable HN monitoring in your config:

```yaml
platforms:
  hackernews:
    enabled: true
    monitorOnly: true
    checkInterval: 300  # seconds — check every 5 minutes
    minScore: 5         # only alert on posts with 5+ points
```

### Workflow

1. PULSE finds a relevant HN thread and sends you an alert (console log, or webhook if configured)
2. Read the full thread — context matters enormously on HN
3. Review PULSE's draft reply as a starting point
4. Rewrite in your own voice, adding personal experience or technical detail
5. Post manually at news.ycombinator.com
6. Check back in 1-2 hours — HN threads move fast, and follow-up replies matter

### What Makes a Good HN Comment

The comments that get upvoted on HN follow patterns:

- **"I built something similar and here's what I learned..."** — first-hand experience is gold
- **Technical comparisons with nuance** — "X is better for Y use case because of Z, but if you need W, consider Q"
- **Explaining a non-obvious tradeoff** — the community loves when someone illuminates a hidden cost or benefit
- **Providing data** — benchmarks, user numbers (if honest), architecture decisions with reasoning
- **Asking a genuinely thoughtful question** — "How does this handle X at scale?" shows you understand the domain

### What Gets Flagged and Killed

HN moderators (dang and sctb) actively moderate, and community flagging is aggressive:

- **Any comment that exists primarily to promote a product** — even if the product is relevant
- **"We built X that solves this"** without substantial technical content alongside it
- **Drive-by comments** on topics you clearly don't deeply understand
- **Snarky one-liners** — HN prefers charitable interpretation and thoughtful disagreement
- **Commenting on your own Show HN from multiple accounts** — this will get all accounts banned

## Show HN Best Practices

If you launch on HN yourself (not automated — always manual):

- **Post on a weekday, 8-10 AM EST** for maximum visibility
- **Title format:** "Show HN: [Product Name] — [one clear sentence about what it does]"
- **First comment:** Explain why you built it, what's different, and what the technical stack looks like. Be specific.
- **Respond to every comment** — even critical ones. Especially critical ones. Grace under fire earns massive respect on HN.
- **Don't ask for upvotes** — HN detects and penalizes vote rings
- **Be ready to share your technical approach** — "how does it work under the hood?" is the most common question

## The Long Game

HN rewards consistency over time. A well-known, helpful commenter can mention their product occasionally without backlash — because the community knows them as a genuine contributor first. This takes months, not days. Use PULSE's monitoring to stay engaged with the conversations that matter, but invest the time to build your HN reputation manually.
