// Relevance check prompts — evaluate whether a post is worth replying to

export function xRelevancePrompt(tweetText: string, niche: string, problemSolved: string): string {
  return `You are a social media analyst specializing in X (Twitter). Evaluate this tweet for reply-worthiness.

TWEET:
"""
${tweetText}
"""

Answer these questions:
1. Is this from a real person (not a brand account, bot, or automated post)?
2. Is this relevant to the niche: "${niche}"?
3. Would a reply feel natural and welcome in this conversation?

Additional X-specific checks:
- Is this NOT a promotional tweet or advertisement?
- Is this NOT from a bot or automated account (check for spam patterns, excessive hashtags, generic phrasing)?
- Does this tweet have substance — an opinion, question, or experience — not just a link dump or retweet with no commentary?
- Could someone who ${problemSolved} add genuine value to this conversation?

If ALL checks pass, respond with exactly: RELEVANT
If ANY check fails, respond with exactly: SKIP: <one-line reason>`;
}

export function redditRelevancePrompt(postText: string, niche: string, problemSolved: string): string {
  return `You are a social media analyst specializing in Reddit. Evaluate this post/comment for reply-worthiness.

POST:
"""
${postText}
"""

Answer these questions:
1. Is this from a real person engaging genuinely (not a brand account or shill)?
2. Is this relevant to the niche: "${niche}"?
3. Would a reply feel natural and welcome in this conversation?

Additional Reddit-specific checks:
- Is this a genuine question, discussion, or experience-sharing (not a meme, joke, or shitpost)?
- Does this follow typical subreddit discussion norms (not low-effort, not trolling)?
- Is the poster open to input — asking for help, sharing a problem, or discussing options?
- Could someone who ${problemSolved} contribute meaningfully here?

If ALL checks pass, respond with exactly: RELEVANT
If ANY check fails, respond with exactly: SKIP: <one-line reason>`;
}

export function hnRelevancePrompt(commentText: string, niche: string): string {
  return `You are a social media analyst specializing in Hacker News. Evaluate this post/comment for reply-worthiness. Apply a VERY HIGH quality bar — HN expects substantive technical discussion.

POST/COMMENT:
"""
${commentText}
"""

Answer these questions:
1. Is this from a real person engaging in genuine technical discourse?
2. Is this relevant to the niche: "${niche}"?
3. Would a reply feel natural and welcome — matching HN's culture of thoughtful, well-reasoned responses?

Additional HN-specific checks:
- Is this a substantive technical discussion (not a one-liner, joke, or meta-commentary)?
- Does this show depth — real experience, a specific problem, or an informed opinion?
- Would a knowledgeable reply be valued here, or would it feel like marketing?
- Is the discussion active and recent enough to warrant engagement?

Only mark as RELEVANT if the post clearly merits a high-quality technical response.

If ALL checks pass, respond with exactly: RELEVANT
If ANY check fails, respond with exactly: SKIP: <one-line reason>`;
}

export function discordRelevancePrompt(messageText: string, niche: string): string {
  return `You are a social media analyst specializing in Discord communities. Evaluate this message for reply-worthiness. Apply a moderate quality bar — genuine questions and discussions qualify.

MESSAGE:
"""
${messageText}
"""

Answer these questions:
1. Is this from a real community member (not a bot, raid, or spam)?
2. Is this relevant to the niche: "${niche}"?
3. Would a reply feel natural and helpful in this channel?

Additional Discord-specific checks:
- Is this a genuine question or discussion (not just a reaction, emoji spam, or off-topic chatter)?
- Is the person looking for help, sharing an experience, or asking for opinions?
- Would replying here feel like a community member helping out, not an outsider barging in?

If ALL checks pass, respond with exactly: RELEVANT
If ANY check fails, respond with exactly: SKIP: <one-line reason>`;
}

export function generalRelevancePrompt(text: string, niche: string, problemSolved: string): string {
  return `You are a social media analyst. Evaluate this post for reply-worthiness.

POST:
"""
${text}
"""

Answer these questions:
1. Is this from a real person (not a brand, bot, or automated account)?
2. Is this relevant to the niche: "${niche}"?
3. Would a reply feel natural and welcome in this conversation?

Additional checks:
- Does this post have substance — a real question, opinion, or experience?
- Could someone who ${problemSolved} add genuine value here?
- Would replying feel helpful rather than intrusive?

If ALL checks pass, respond with exactly: RELEVANT
If ANY check fails, respond with exactly: SKIP: <one-line reason>`;
}

export function competitorMentionPrompt(text: string, competitor: string, brandName: string): string {
  return `You are a social media analyst. Evaluate this post that mentions a competitor for reply-worthiness.

POST:
"""
${text}
"""

The post mentions "${competitor}" which competes with "${brandName}".

Answer these questions:
1. Is this from a real person (not a brand, bot, or the competitor's own account)?
2. Is the person expressing a genuine pain point, comparison question, or looking for alternatives?
3. Would a reply mentioning ${brandName} feel helpful and natural — not like an ambush?

Additional checks:
- Is the person frustrated with ${competitor} or actively evaluating options? (Good — they want alternatives.)
- Is this a positive testimonial for ${competitor} with no complaints? (Bad — replying looks desperate.)
- Would suggesting ${brandName} here feel like genuine help or unwanted sales?

If ALL checks pass, respond with exactly: RELEVANT
If ANY check fails, respond with exactly: SKIP: <one-line reason>`;
}
