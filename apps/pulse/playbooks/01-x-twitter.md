# X/Twitter Strategy

X is PULSE's strongest platform. Public conversations, real-time discovery, and a culture that rewards quick, useful replies make it ideal for AI-assisted outreach.

## Why X Works for Outreach

Every complaint, question, and recommendation on X is public and searchable. When someone tweets "anyone know a good project management tool?", that's a buying signal visible to the entire internet. PULSE finds these moments and responds within minutes — not hours or days. Speed matters because the first helpful reply often wins the follow.

X's algorithm also rewards engagement. A thoughtful reply on a popular tweet gets shown to that person's entire audience. You're not just reaching one person — you're reaching their network.

## Account Setup Tips

Before PULSE sends a single reply, your profile needs to look credible:

- **Bio:** One clear sentence about what you do or build. No buzzwords. Include your product URL.
- **Pinned tweet:** Your best piece of content — a thread explaining your product, a customer story, or a useful insight. Not a sales pitch.
- **Profile photo:** A real face. Not a logo (unless you're running a brand account). People reply to people.
- **Header image:** Your product in action, a clean tagline, or leave it as a solid color. Don't overthink it.
- **Post history:** Have at least 10-20 genuine tweets before activating PULSE. A brand-new account replying to everyone looks like a bot.

## The Conversation-First Approach

PULSE never leads with your product. The pattern is:

1. **Acknowledge** the person's problem or question
2. **Add value** — a tip, insight, or relevant experience
3. **Mention your product only if directly relevant**, and only as one option among others

Example — someone tweets "spending way too long on status updates every morning":

- Bad: "Try TaskForge! It automates standups. Link in bio."
- Good: "Async standups changed everything for us. Team posts updates when ready, no meeting needed. A few tools do this well — happy to share what worked."

The good reply starts a conversation. The bad reply gets muted.

## Optimal Posting Times

PULSE spaces replies throughout the day, but these windows get the highest engagement:

- **Weekdays 8-10 AM EST** — morning scroll, highest impression counts
- **Weekdays 12-1 PM EST** — lunch break browsing
- **Weekdays 5-7 PM EST** — post-work wind-down
- **Sundays 7-9 PM EST** — surprisingly active for tech/SaaS audiences

Configure these in `pulse.yaml` under `platforms.x.activeHours`. PULSE won't post outside these windows.

## Thread Strategy

Threads get 2-5x the reach of single tweets. PULSE can generate thread drafts for you:

- **Hook tweet:** Ask a question or make a bold claim (not clickbait — genuine insight)
- **3-7 body tweets:** One idea per tweet, each valuable on its own
- **Closer:** Summary + soft CTA ("I wrote more about this at..." or "DM me if you want the template")

Use `npm run content -- --type thread` to generate thread drafts based on your topics.

## What to Avoid

X's anti-spam systems are aggressive. These will get your account restricted:

- **More than 10-15 replies per hour** — PULSE's rate limiter handles this, don't override it
- **Identical or near-identical replies** — PULSE varies phrasing, but double-check with `npm run report`
- **Tagging/mentioning people who didn't ask** — never @-mention someone unless replying to their tweet
- **Replying to the same person repeatedly** — PULSE tracks per-user reply counts and backs off automatically
- **Using URL shorteners** — X throttles tweets with bit.ly and similar links
- **Hashtag stuffing** — one hashtag maximum, and only if it's genuinely relevant

## X API Tier Limits

Your X API tier controls read/write volume and which automation workflows are viable. Confirm your current developer plan before enabling higher-volume autonomous replies.

PULSE defaults to conservative reply volume. You can adjust `platforms.x.dailyLimit` in your config, but keep the limit below your approved X API capacity and account-safety policy.

**Pro tip:** Focus on fewer, higher-quality replies rather than maximizing volume. Five replies that start conversations beat fifty that get ignored.
