# Discord Strategy

Discord servers are where niche communities have their most candid conversations. Unlike public platforms, Discord discussions happen in real-time in semi-private spaces — which makes authentic engagement both more valuable and more risky if done wrong.

## Finding Relevant Servers

Your target servers fall into three categories:

### Industry Servers
Communities built around your industry or niche. For a developer tool, these might be language-specific servers (Python, Rust, TypeScript) or framework servers (Next.js, Django). For a SaaS tool, look for communities around your vertical (indie hackers, marketers, designers).

**How to find them:**

- Search [disboard.org](https://disboard.org) or [discord.me](https://discord.me) for your keywords
- Check if competing products have community servers (they often do, and members there are your exact audience)
- Look for servers linked from subreddits, GitHub repos, and YouTube channels in your space
- Ask your existing users which Discord servers they hang out in

### Product-Adjacent Servers
Servers for tools your audience already uses. If you build a design tool, join Figma community servers. If you build a deployment tool, join hosting provider servers.

### Startup and Maker Servers
Servers like Indie Hackers, WIP, or niche founder communities where people discuss building products. Great for getting feedback, finding beta testers, and connecting with potential partners.

## Bot Setup

PULSE connects to Discord via a bot account.

1. Go to [discord.dev](https://discord.dev) and create a new Application
2. Navigate to Bot settings and create a bot
3. Enable "Message Content Intent" (required to read messages)
4. Generate a bot token and add it to your `.env` as `DISCORD_BOT_TOKEN`
5. Generate an invite link with "Read Messages" and "Send Messages" permissions
6. Join target servers using the invite link

**Important:** Many servers require admin approval for bots. Message the server admin first and explain what your bot does. Be honest — "it monitors for questions I can help with and posts helpful replies" is fine. "It's a marketing bot" will get you rejected.

Configure channels in `pulse.yaml`:

```yaml
platforms:
  discord:
    enabled: true
    servers:
      - name: "Indie Hackers"
        channels:
          - id: "123456789"
            name: "product-feedback"
          - id: "987654321"
            name: "show-and-tell"
    replyDelay: 120  # seconds — don't reply instantly
```

## Being Helpful, Not Spammy

Discord communities are tight-knit. Members recognize each other. A bot that only shows up to promote things will be kicked quickly.

**Rules for Discord engagement:**

- **Answer questions fully.** Don't give a partial answer that leads to your product. Solve the person's problem, even if the solution doesn't involve you.
- **Share resources freely.** Blog posts, tutorials, documentation, tools — including competitors' resources when they're the best answer.
- **Match the server's energy.** Some servers are casual and use lots of slang. Others are professional. PULSE adapts tone based on your config, but review the output.
- **Don't reply to every message.** Only engage when you have genuine value to add. Frequency limits in config help with this.
- **Use threads when available.** Keeps conversations organized and shows you respect the server's structure.

## Channel Selection

Not all channels are equal:

- **#help / #support** — Highest value. People are explicitly asking for solutions. Answer thoroughly.
- **#general** — High visibility but noisy. Only engage with clearly relevant conversations.
- **#show-and-tell / #showcase** — Good for sharing your product, but only when the channel is specifically for this purpose.
- **#off-topic** — Skip. Building reputation here doesn't translate to product awareness.
- **#introductions** — Post once when you join. Mention what you're building briefly.

## Building Reputation

Discord reputation is earned through consistent helpfulness over weeks and months:

- **First 2 weeks:** Only help others. Zero mentions of your product. Get known as "the person who gives good answers."
- **Weeks 3-4:** Start mentioning your product when directly relevant to someone's question. Frame it as "I built something that does this" not "you should use my product."
- **Ongoing:** Maintain the helpful-to-promotional ratio. If the community starts associating your bot with useful answers, they'll forgive occasional self-promotion.

Set PULSE's `promotionDelay` to at least 14 days — it won't mention your product in any server until that period has passed.

## Rate Limits and Safety

- **Max 5-10 messages per server per day** when starting out
- **Minimum 2-minute delay between messages** to avoid looking automated
- **Never DM users unprompted** — this is the fastest way to get reported and banned
- **If a moderator asks you to stop, stop immediately** — configure the server as excluded and move on
