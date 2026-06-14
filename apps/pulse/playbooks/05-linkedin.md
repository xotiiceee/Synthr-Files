# LinkedIn Manual-Assist Strategy

LinkedIn is the highest-converting platform for B2B products, but its API restrictions and professional context mean automation has to stay behind the scenes. PULSE generates content and drafts — you post them yourself.

## Why PULSE Doesn't Auto-Post on LinkedIn

LinkedIn's API requires OAuth app approval for posting, and their terms of service aggressively prohibit automated engagement. Accounts caught using automation get restricted or banned. More importantly, LinkedIn's algorithm rewards content from real humans — posts from automation tools get throttled.

What PULSE does instead:

- **Generates post drafts** based on your topics and content calendar
- **Creates comment drafts** for posts in your niche (you find the posts, PULSE drafts the response)
- **Suggests connection messages** tailored to specific people or roles
- **Maintains your content calendar** with a mix of formats and topics

## Content Formats That Work

LinkedIn's algorithm in 2026 favors these formats, roughly in order of reach:

### Personal Stories
"Last month, I almost lost our biggest client because of X. Here's what happened and what I learned." Vulnerability and honesty perform extremely well. PULSE can generate story frameworks — you fill in the real details.

### Contrarian Takes
"Everyone says you need to do X. I disagree. Here's why." These generate comments (agreement and disagreement), which signals engagement to the algorithm. Keep it genuine — don't be contrarian just for reach.

### Numbered Lists
"5 things I wish I knew before building a SaaS." Easy to read on mobile, high save rate. PULSE generates these well — review and add your personal angle.

### Text-Only "Carousels"
Multi-paragraph posts with clear section breaks (use line breaks and emojis as dividers). These get high dwell time because people scroll through them. Keep each section to 2-3 sentences.

### What Doesn't Work
- Links in the post body (LinkedIn throttles external links — put them in the first comment)
- Long paragraphs without line breaks
- Corporate jargon ("synergy", "leverage", "disrupt")
- Posting more than once per day (diminishing returns after the first post)

## Commenting Strategy

Commenting on other people's posts is higher-ROI than posting yourself, especially when starting out. Your comment appears in front of their entire audience.

**High-value commenting targets:**

- Industry leaders in your niche (10K+ followers)
- Posts asking questions your product solves
- Trending posts in your industry topics
- Posts from potential customers or partners

**What makes a good LinkedIn comment:**

- Adds a new perspective (not just "great post!")
- Shares a specific, relevant experience
- Asks a follow-up question that shows expertise
- 3-5 sentences minimum — one-liners get buried

Use `npm run content -- --platform linkedin --type comments` to generate comment drafts based on topics in your config.

## Connection Message Templates

PULSE generates personalized connection messages. The key principles:

- **Reference something specific** about the person (a post they wrote, their company, a shared connection)
- **State why you want to connect** in one sentence
- **No pitch in the connection request** — ever. Build the relationship first.
- **Keep it under 200 characters** — LinkedIn truncates longer messages

Example framework:
> "Hi [Name] — saw your post about [topic]. We're working on something similar at [Company] and I'd love to follow your work."

Generate these with `npm run content -- --platform linkedin --type connection`.

## Using PULSE-Generated Drafts

The workflow for LinkedIn:

1. Run `npm run content -- --platform linkedin` to generate a batch of drafts
2. Review each draft — keep, edit, or discard
3. Add personal details, real numbers, and your actual voice
4. Schedule posts using LinkedIn's native scheduling (or post directly)
5. After posting, check back in 1-2 hours to reply to comments

**Critical rule:** Never post a PULSE draft without editing it. AI-generated LinkedIn content has a recognizable tone that experienced users spot immediately. Your edits — adding real details, adjusting phrasing, injecting your personality — are what make it work.

## Posting Cadence

- **3-5 posts per week** is the sweet spot for most people
- **Post between 7-9 AM in your audience's timezone** (Tuesday through Thursday perform best)
- **Engage with 5-10 comments per day** on other people's content
- **Send 5-10 connection requests per day** (LinkedIn limits to ~100/week)

Use `npm run calendar -- --platform linkedin` to generate a weekly content calendar with varied formats and topics.
