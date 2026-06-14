# Content Strategy Playbook

PULSE doesn't just reply to conversations — it creates X content and draft variants for reviewed surfaces. This playbook explains the content mix, calendar system, and how to get the most from AI-generated drafts.

## The Content Mix

Every piece of content PULSE creates falls into one of four categories. The ratio matters — too much promotion kills engagement, too little means no one knows what you sell.

### 40% Educational (Teach Something)

Tutorials, how-tos, tips, explanations. This is your primary trust-building content. Examples:

- "3 ways to speed up your CI pipeline"
- "How we reduced our AWS bill by 40%"
- "A beginner's guide to rate limiting"

Educational content positions you as an expert. People follow experts. Followers become customers.

### 25% Personal / Story (Be Human)

Behind-the-scenes, lessons learned, failures, milestones. This is what makes you memorable. Examples:

- "We shipped a bug to production last week. Here's what went wrong."
- "Month 6 revenue update: $2,400 MRR and what I'd do differently"
- "The feature request I ignored for 3 months (and why I was wrong)"

Personal content builds emotional connection. People buy from people they relate to.

### 20% Engagement (Start Conversations)

Questions, polls, hot takes, "what do you think?" posts. This drives algorithm-boosting interactions. Examples:

- "What's the most overrated developer tool? I'll go first."
- "Hot take: most startups don't need a microservices architecture."
- "What's one tool you use daily that nobody talks about?"

Engagement content feeds the algorithm and grows your audience. More reach means more people see your educational and promotional content.

### 15% Promotional (Sell Something)

Product updates, feature launches, customer stories, case studies. This is where the revenue comes from — but only because the other 85% earned you the right to promote. Examples:

- "Just shipped: automatic Slack notifications for failed deploys"
- "How [Customer] cut their onboarding time from 2 hours to 15 minutes using [Product]"
- "We're launching on Product Hunt tomorrow — here's what we built and why"

## Content Calendar

PULSE maintains a rolling content calendar. Generate it with:

```bash
npm run calendar              # Next 7 days, all platforms
npm run calendar -- --days 14 # Next 2 weeks
npm run calendar -- --platform x  # X/Twitter only
```

The calendar assigns content types across days and platforms, ensuring the ratio stays balanced. It accounts for:

- **Platform-specific formats** (threads for X, long-form for Reddit, stories for LinkedIn)
- **Optimal posting times** per platform
- **Topic rotation** so you don't repeat themes within the same week
- **Event awareness** for Product Hunt launches or industry dates you've configured

Review the calendar weekly. Swap topics, adjust timing, or regenerate sections that don't feel right.

## Repurposing Into Drafts

One idea can become several drafts across different platforms, while publishing still follows each platform's configured approval mode and launch posture. A useful draft chain is:

1. **Start with a tweet or short take** — test the idea in a low-effort format
2. **If it resonates, expand to a thread** — add depth, examples, and structure
3. **Turn the thread into a Reddit post** — rewrite for Reddit's tone (less personal branding, more substance)
4. **Adapt for LinkedIn** — add a personal angle, professional context, and a hook
5. **Collect into a monthly roundup** — your best content becomes a newsletter or blog post

Use `npm run repurpose -- --from=x --to=linkedin` to generate platform-adapted drafts from your existing content.

## Finding Your Voice

PULSE adapts to your configured tone, but consistency is key:

- **Pick 3 adjectives** that describe your brand voice (e.g., "direct, technical, slightly funny")
- **Set these in config** under `brand.voiceTraits`
- **Review the first week of output** and note where it feels off — adjust `brand.writingStyle` until it matches
- **Save examples of your best human-written posts** — PULSE can use these as style references

Your voice should be recognizable across X posts, replies, and any reviewed manual drafts.

## Batching Content Creation

The most efficient workflow:

1. **Monday morning:** Run `npm run calendar` and review the week's plan
2. **Monday:** Generate all drafts for the week: `npm run content -- --days 7`
3. **Monday-Tuesday:** Edit and personalize drafts (30-60 minutes total)
4. **Rest of the week:** PULSE posts on schedule. You spend 15 minutes/day responding to engagement.

Batching saves time and maintains consistency. Editing 20 drafts in one sitting is faster than writing 20 posts from scratch across the week.
