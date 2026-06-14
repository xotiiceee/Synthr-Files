# Reddit Strategy

Reddit is the highest-value, highest-risk platform for outreach. A single well-placed comment can drive hundreds of clicks. A single spammy one can get you permanently banned from an entire community.

## How Reddit Is Different

Reddit communities (subreddits) are individually moderated by volunteers who take their rules seriously. Every subreddit has its own culture, rules, and tolerance for self-promotion. What works in r/SaaS would get you banned in r/programming.

Key differences from other platforms:

- **Karma is your reputation.** Low-karma accounts are automatically filtered in most subreddits. You need to earn it before PULSE can be effective.
- **Post history is public.** Moderators check your history. If every comment mentions your product, you're getting banned.
- **Downvotes are brutal.** A comment at -3 is effectively invisible. Reddit's crowd collectively punishes anything that smells like marketing.
- **Long-form wins.** The best Reddit comments are 100-300 words with specific, actionable advice.

## Subreddit Selection

Finding the right communities matters more than anything else. Configure these in `pulse.yaml` under `platforms.reddit.subreddits`.

**How to find your subreddits:**

1. Search Reddit for your product category (e.g., "project management tool")
2. Note which subreddits those posts appear in
3. Check each subreddit's rules (sidebar) for self-promotion policies
4. Look at subscriber count — 10K-500K is the sweet spot (active but not overwhelming)
5. Sort by "new" and check if posts get replies — dead subreddits aren't worth targeting

**Good targets:** Niche communities where your audience hangs out (r/startups, r/webdev, r/smallbusiness). **Bad targets:** Massive defaults (r/technology, r/AskReddit) where you'll be drowned out.

## The 10:1 Rule

For every comment that mentions your product, you need at least 10 comments that are purely helpful with no self-promotion whatsoever. PULSE enforces this automatically via `platforms.reddit.promotionRatio` (default: 0.1).

Those 10 helpful comments should be:

- Answering questions you genuinely know the answer to
- Sharing relevant experiences or resources (not yours)
- Adding context or nuance to discussions
- Correcting misinformation in your area of expertise

This isn't just a spam-avoidance tactic — it's how you build karma and credibility so that when you do mention your product, people actually listen.

## Comment Quality

Reddit punishes low-effort comments. PULSE's Reddit prompts are tuned for depth, but here's what the community expects:

- **Specific over generic.** "Use caching" is bad. "Add a Redis layer between your API and DB — here's a rough approach..." is good.
- **Personal experience matters.** "We ran into this exact problem at our startup" carries weight.
- **Formatting helps.** Use bullet points, headers, and code blocks where appropriate. Wall-of-text comments get skipped.
- **Acknowledge complexity.** "It depends" followed by an actual breakdown of the tradeoffs is peak Reddit.

## Dealing with Moderators

If a moderator removes your post or warns you:

- **Don't argue.** Thank them, ask what you should change, and move on.
- **Check the rules again.** You probably missed something. Many subreddits have separate wiki pages with detailed rules.
- **Ask before posting promotional content.** Some subreddits have weekly self-promotion threads. Use those.
- **If banned, don't create alt accounts.** Reddit aggressively detects ban evasion. Accept the loss and focus on other subreddits.

PULSE logs every moderator interaction. Review these in `npm run report -- --platform reddit`.

## What Gets You Banned

Avoid these at all costs:

- **New accounts posting links** — age your Reddit account for at least 2 weeks with genuine activity before enabling PULSE
- **Self-promotion without value** — linking your product without context or helpfulness
- **Posting the same comment across multiple subreddits** — Reddit's spam filter catches cross-posting identical text
- **Upvote manipulation** — never ask friends/colleagues to upvote your posts
- **Ignoring subreddit rules** — some ban link posts entirely, some require flair, some have minimum karma thresholds

**Start slow.** Configure PULSE to post 3-5 Reddit comments per day maximum for the first month. Build karma, learn the communities, then gradually increase.
