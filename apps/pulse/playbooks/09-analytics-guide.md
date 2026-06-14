# Analytics Playbook

PULSE tracks everything it does and every response it gets. This playbook explains how to read the data, spot problems early, and use analytics to improve your outreach over time.

## Running Reports

### Quick Report
```bash
npm run report
```
Generates a summary of the last 7 days: total actions, engagement rates, top-performing replies, and platform breakdowns. Takes about 10 seconds.

### Detailed Report
```bash
npm run report -- --days 30 --detailed
```
Full monthly report with per-platform metrics, topic performance, hourly breakdowns, and trend analysis.

### Platform-Specific Report
```bash
npm run report -- --platform x --days 14
```
Deep dive into a single platform. Includes reply-level details showing which conversations got the most engagement.

### Export to CSV
```bash
npm run report -- --format csv --output report.csv
```
For custom analysis in a spreadsheet.

## Understanding the Weekly Report

The standard weekly report has five sections:

### 1. Summary
Total conversations found, replies sent, engagement received, and your overall engagement rate (engagements / replies sent). A healthy engagement rate varies by platform — 5-15% on X, 10-30% on Reddit, varies widely on Discord.

### 2. Platform Breakdown
Per-platform metrics showing which platforms drive the most engagement relative to effort. If one platform consistently underperforms, consider reallocating that effort (lower its daily limit, raise another's).

### 3. Topic Performance
Which of your configured topics generated the most relevant conversations and highest engagement. This directly informs what to focus on. If "CI/CD" outperforms "cloud infrastructure" by 3x, lean into CI/CD topics.

### 4. Top Performers
Your 10 best-performing replies of the week with links. Study these — what did they have in common? Tone, length, topic, timing? Feed these patterns back into your prompt customization.

### 5. Adaptation Log
Changes PULSE's adaptation engine made automatically: topic weight adjustments, timing shifts, relevance threshold tweaks. Review these to make sure the auto-optimization is heading in the right direction.

## Using the Dashboard

```bash
npm run dashboard
```

Opens a local web dashboard at `http://localhost:3456` with real-time metrics:

- **Activity feed:** Live stream of PULSE's actions and their outcomes
- **Engagement chart:** Daily engagement rate trend (look for upward slope)
- **Surface comparison:** Side-by-side performance for X posts, replies, and reviewed drafts
- **Topic heatmap:** Which topics perform best at which times
- **Queue status:** Pending replies and scheduled content

The dashboard updates every 60 seconds while running. Keep it open in a browser tab during your workday to monitor PULSE's activity.

## Key Metrics

### Engagement Rate
`(likes + replies + upvotes + reactions) / total_replies_sent`

This is your north star metric. Track it weekly. A declining engagement rate means your replies are becoming less relevant or the platforms are throttling you.

- **X:** 5-15% is healthy. Above 15% is excellent.
- **Reddit:** 10-30% (upvotes are easier to get than likes on X).
- **Discord:** Harder to measure — track reply-to-message ratio instead.

### Reply-to-Like Ratio
When people reply to your reply (not just like it), that's a conversation. Conversations convert better than passive engagement.

- **Below 1:10** (1 reply per 10 likes): Your content is agreeable but not engaging. Try more specific or slightly controversial takes.
- **1:5 to 1:3:** Healthy range. People are engaged enough to respond.
- **Above 1:2:** Exceptional. You're starting real conversations.

### Topic Performance Score
PULSE assigns each topic a composite score based on:
- Number of relevant conversations found (opportunity volume)
- Average relevance score of matches (quality)
- Engagement rate on replies for that topic (resonance)

Check topic scores weekly. Drop topics scoring below 30 and experiment with new ones.

### Response Time
How quickly PULSE replied after finding a relevant conversation. On X, responding within 15 minutes of a tweet significantly outperforms responding after an hour. PULSE tracks this automatically — if response times are creeping up, check your rate limits or server resources.

## When to Manually Intervene

Let PULSE's adaptation engine handle routine optimization, but step in when you see:

- **Engagement rate drops more than 30% week-over-week** — something changed. Check if a platform updated its algorithm, if your account was throttled, or if your topics drifted.
- **A single reply gets significant negative engagement** (ratio'd on X, heavily downvoted on Reddit) — review what happened, add guardrails to your prompts if needed.
- **Topic drift** — the adaptation engine might weight a tangentially related topic too heavily. Override the weight manually in config.
- **Platform-specific issues** — if Reddit engagement drops to zero, check if you were shadowbanned (post in r/ShadowBan to check).

## Reading Adaptation Reports

PULSE's adaptation engine adjusts three things automatically:

1. **Topic weights** — increases weight for high-performing topics, decreases for low-performing ones. Check `adaptation.topicWeights` in the report.
2. **Timing** — shifts posting times based on when engagement is highest. Check `adaptation.timeShifts`.
3. **Relevance threshold** — dynamically adjusts per platform if too many or too few conversations are passing the filter. Check `adaptation.thresholdChanges`.

Each adaptation report entry shows the before/after values and the data that triggered the change. If an adaptation looks wrong, override it in `pulse.yaml` — manual config values take priority over automated adjustments.
