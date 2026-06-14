# Product Hunt Strategy

Product Hunt is a launchpad, not a sustained marketing channel. Use it for specific moments — your launch, related product launches, and community building — not for ongoing outreach.

## How Product Hunt Works

Every day at midnight Pacific Time, a new batch of products goes live. The community upvotes and comments throughout the day. Top products get featured on the homepage, driving significant traffic from investors, early adopters, and tech media.

PULSE helps with Product Hunt in two ways:

1. **Monitoring launches** related to your space and alerting you to comment opportunities
2. **Generating comment drafts** that fit PH's friendly, supportive tone

PULSE does not auto-post on Product Hunt. The platform requires authenticated user actions, and automated posting violates their terms.

## Commenting on Related Launches

This is where the real ongoing value lies. When a product adjacent to yours launches on PH:

- **Be genuinely supportive.** PH culture is positive. "Congrats on the launch!" is expected (though not sufficient on its own).
- **Add substance.** Share how the product compares to alternatives, ask a thoughtful question about their approach, or share a relevant use case.
- **Mention your product only when directly relevant** — "We built something similar for [different audience] and found that [insight]" works if it's honest and adds to the conversation.
- **Comment early.** The first 10-20 comments get the most visibility. PULSE's alerts help you catch launches within the first hour.

### Finding Launch Opportunities

Configure PULSE to monitor PH categories:

```yaml
platforms:
  producthunt:
    enabled: true
    monitorOnly: true
    categories:
      - productivity
      - developer-tools
      - saas
    alertOnLaunch: true
```

When a launch matches your categories, PULSE alerts you with a summary and a draft comment.

## Your Own Launch Day

Product Hunt launches are a one-shot event. Preparation matters more than anything else.

### Before Launch Day

- **Build a hunter network.** Engage on PH for 2-4 weeks before your launch. Comment on other products, build relationships. People who recognize your name are more likely to check out your launch.
- **Prepare your assets.** Gallery images (1270x760), a compelling tagline (max 60 chars), a clear description, and a 1-2 minute demo video if possible.
- **Line up your first comment.** Write a "maker comment" explaining why you built it, what problem it solves, and what's next. This should be personal and honest, not a press release.
- **Schedule at midnight PT.** You want the full 24-hour window for voting.

### On Launch Day

- **Post your maker comment immediately** after the launch goes live
- **Respond to every comment** within 30 minutes if possible — engagement signals boost ranking
- **Share on your other platforms** but do NOT say "upvote me on Product Hunt." Instead: "We just launched on Product Hunt — would love your feedback" with a direct link
- **Be available all day.** Launch day is a full workday of community engagement
- **Thank supporters personally** — a reply to each comment, not a generic "thanks everyone!"

### After Launch Day

- **Follow up with commenters** who asked questions or showed interest
- **Share your results** — "We hit #3 on Product Hunt, here's what we learned" makes great content for X and LinkedIn
- **Update your PH page** with milestones — the listing stays live permanently

## Upvote Strategy

The single biggest mistake on Product Hunt: asking for upvotes.

- **PH detects vote manipulation aggressively.** Sending a link to your team and asking them to upvote will get those votes stripped and potentially your product penalized.
- **Votes from new PH accounts count less.** A vote from a regular PH user is worth significantly more than one from someone who just signed up.
- **Organic engagement beats organized voting.** Focus on making your product and maker comment genuinely interesting.

What actually drives upvotes:

- A clear, compelling product that solves an obvious problem
- Great visuals (screenshots, demo video)
- An honest, personal maker comment
- Fast, thoughtful responses to questions
- Being active in the PH community before your launch

## The PH Community Advantage

Product Hunt's community is small and interconnected. The same people — makers, investors, journalists, power users — show up repeatedly. Building genuine relationships here pays dividends far beyond a single launch. Many successful PH makers report that investor conversations, partnership opportunities, and press coverage came from connections made in PH comments, not from the launch rank itself.
