// Content creation prompt variants — generate original posts for each platform

export interface ContentContext {
  personaPrompt: string;
  theme: string;
  platform: string;
  charLimit: number;
  website: string;
}

function baseContentInstructions(ctx: ContentContext): string {
  return `${ctx.personaPrompt}

You are creating an original post for ${ctx.platform}. Keep it under ${ctx.charLimit} characters.

THEME/TOPIC: ${ctx.theme}

Rules:
- Sound like a real person sharing their thoughts, not a brand posting content.
- No corporate speak, no buzzwords, no "leverage" or "synergy".
- Do NOT start with "Did you know" or "Here's the thing" or similar cliche openers.
- Do NOT use excessive emojis (0-2 max).
- Do NOT wrap output in quotes.
- Output ONLY the post text, nothing else.`;
}

export function hookPost(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: HOOK / ATTENTION-GRABBER
Open with a bold, specific statement that makes people stop scrolling. It should be surprising, counterintuitive, or challenge a common assumption. The first line IS the post — everything after just supports it. Think "Most people do X wrong" or a specific number/result that grabs attention. No clickbait — the hook must deliver.`;
}

export function threadPrompt(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: THREAD (5-7 parts)
Write a thread of 5-7 connected posts. Format each part on its own line, separated by a blank line. The first post is the hook — it must stand alone and make people want to read the rest. Each subsequent post adds one clear point. The last post should tie it together and can mention ${ctx.website} naturally. Number each part (1/, 2/, etc).`;
}

export function educationalPost(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: EDUCATIONAL — TEACH ONE THING
Pick ONE specific, actionable insight about this theme and explain it clearly. Don't try to cover everything. The reader should finish this post knowing something they didn't before. Use concrete examples, numbers, or steps — not abstract principles. If relevant, mention how ${ctx.website} relates, but only if it fits naturally.`;
}

export function storyPost(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: PERSONAL NARRATIVE
Share a brief story — something that happened, a lesson learned, a mistake made, a win achieved. Be specific: names, numbers, timelines make stories believable. The story should connect to this theme naturally. Keep it to the point — no "and then... and then..." meandering. End with the takeaway.`;
}

export function controversialPost(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: HOT TAKE (RESPECTFUL)
Share an opinion about this theme that many people would disagree with. Be specific and back it up with reasoning or experience. Don't be contrarian for its own sake — genuinely argue the position. Acknowledge the other side briefly. The goal is thoughtful debate, not rage engagement. Stay respectful but firm.`;
}

export function listiclePost(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: LISTICLE — "X things I learned..."
Write a list of 3-7 specific, non-obvious things related to this theme. Each item should be one sentence, max two. Avoid generic advice everyone has heard. Each point should make someone think "huh, I hadn't considered that." A brief intro line before the list is fine. Can mention ${ctx.website} as ONE of the items if it fits naturally.`;
}

export function quoteCommentary(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: QUOTE / NEWS COMMENTARY
React to a recent trend, news, or common saying in this space. Start with a paraphrased idea or trend (don't use actual quotes since you don't know specific articles). Add your specific take — what people are missing, why it matters, or what happens next. Show you're plugged into what's happening in the industry.`;
}

export function pollQuestion(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: POLL / QUESTION
Generate an interesting poll question related to this theme, plus 3-4 answer options. The question should spark genuine debate — not have an obvious "right" answer. Format as:

[Question text]

A) Option 1
B) Option 2
C) Option 3
D) Option 4 (optional)

Add a one-line take on your own answer to encourage discussion.`;
}

export function behindTheScenes(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: BEHIND THE SCENES / BUILDING IN PUBLIC
Share something about the process of building, creating, or working on something related to this theme. Could be: a decision you made and why, a tool/approach you tried, a metric you're tracking, a problem you're solving right now. Be specific and honest — include the messy parts. People love seeing how the sausage gets made.`;
}

export function ctaPost(ctx: ContentContext): string {
  return `${baseContentInstructions(ctx)}

STYLE: CALL TO ACTION (SOFT SELL)
Create a post that naturally leads to ${ctx.website}. Start with value — a problem, insight, or result — then mention the product as the solution. The CTA should feel earned, not forced. Think "we built X because Y was broken" not "check out our amazing product!" Keep the ratio 80% value / 20% promotion.`;
}

// Content mix: 40% educational, 25% personal, 20% engagement, 15% promotional
const contentMix: { weight: number; styles: Function[] }[] = [
  { weight: 40, styles: [educationalPost, listiclePost, quoteCommentary] },
  { weight: 25, styles: [storyPost, behindTheScenes] },
  { weight: 20, styles: [hookPost, controversialPost, pollQuestion] },
  { weight: 15, styles: [ctaPost, threadPrompt] },
];

export function pickContentStyle(): string {
  const roll = Math.random() * 100;
  let cumulative = 0;

  for (const bucket of contentMix) {
    cumulative += bucket.weight;
    if (roll < cumulative) {
      const style = bucket.styles[Math.floor(Math.random() * bucket.styles.length)];
      return style.name;
    }
  }

  return educationalPost.name;
}
