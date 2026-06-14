/**
 * LLM-powered relevance scoring with platform-aware quality bars.
 * Filters out bots, off-topic posts, and conversations where a reply would feel forced.
 */

import { askLLM, askLLMWithSystem } from '../core/llm.js';
import { getConfig } from '../core/persona.js';
import type { Conversation } from '../platforms/base.js';
import { createHash } from 'node:crypto';

// ─── Intent Classification (LLM-powered, cached) ───────────────────────────

export type IntentType = 'seeking_help' | 'comparing_products' | 'expressing_frustration' | 'asking_question' | 'sharing_experience' | 'requesting_feature' | 'giving_feedback' | 'general_discussion';

export interface ClassifiedIntent {
  intent: IntentType;
  confidence: number;
  is_actionable: boolean;
  suggested_approach: 'helpful_answer' | 'product_mention' | 'empathize' | 'educate' | 'ignore';
}

const intentCache = new Map<string, ClassifiedIntent>();
// Clear cache every hour
setInterval(() => intentCache.clear(), 3_600_000);

export async function classifyIntent(text: string, brandContext: string): Promise<ClassifiedIntent | null> {
  const cacheKey = createHash('sha256').update(text.slice(0, 200)).digest('hex').slice(0, 12);
  if (intentCache.has(cacheKey)) return intentCache.get(cacheKey)!;

  try {
    const response = await askLLMWithSystem(
      'Classify the intent of this social media post. Return JSON only, no markdown.',
      `Brand: ${brandContext}\nPost: "${text.slice(0, 500)}"\n\nReturn: { "intent": "seeking_help|comparing_products|expressing_frustration|asking_question|sharing_experience|requesting_feature|giving_feedback|general_discussion", "confidence": 0-1, "is_actionable": true/false, "suggested_approach": "helpful_answer|product_mention|empathize|educate|ignore" }`,
      { maxTokens: 100, temperature: 0.2 },
    );

    if (!response) return null;

    let json = response.trim();
    const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) json = fence[1].trim();

    const parsed = JSON.parse(json) as ClassifiedIntent;
    intentCache.set(cacheKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

const PLATFORM_PROMPTS: Record<string, string> = {
  x: `Platform: X (Twitter). Quality bar: High. X users are skeptical of marketing replies. Only mark relevant if the post is from a real person (not a brand/bot), discussing a genuine problem or question where a helpful reply would feel natural. Ignore promotional tweets, retweets with no commentary, and engagement-bait threads.`,

  reddit: `Platform: Reddit. Quality bar: Very High. Reddit users aggressively downvote anything that smells like marketing. Only mark relevant if: (1) it's a genuine question or discussion thread in a relevant subreddit, (2) the post has enough context for a helpful reply, (3) a reply with a product mention wouldn't get flagged as spam. Ignore locked/archived threads.`,

  hackernews: `Platform: Hacker News. Quality bar: Very High. HN has the most discerning tech audience. Only mark relevant if it's a substantive technical discussion or "Ask HN" thread where domain expertise would be valued. Ignore Show HN posts (self-promotion), hiring threads, and purely political discussions.`,

  discord: `Platform: Discord. Quality bar: Moderate. Discord conversations are more casual. Mark relevant if someone is asking for help or recommendations in a relevant channel. Ignore off-topic channels, memes, and one-word messages.`,

  linkedin: `Platform: LinkedIn. Quality bar: Moderate. LinkedIn is more tolerant of professional recommendations. Mark relevant if someone is discussing industry challenges, asking for tool recommendations, or sharing pain points related to the niche. Ignore pure self-congratulation posts and job listings.`,

  producthunt: `Platform: Product Hunt. Quality bar: Moderate. Product Hunt users expect product discussions. Mark relevant if someone is comparing tools, asking about alternatives, or discussing a problem the product solves. Ignore launch-day hype comments and generic "congrats" replies.`,
};

/**
 * Check if a conversation is relevant enough to reply to.
 * Uses platform-specific quality bars and persona context.
 */
export async function checkRelevance(
  conversation: Conversation,
  platform: string
): Promise<{ relevant: boolean; reason: string; intent?: ClassifiedIntent | null }> {
  const config = getConfig();
  const { persona } = config;

  // Also check brand profile — it has richer identity from knowledge notes
  let brandName = persona.brandName || '';
  let niche = persona.niche || '';
  let problemSolved = persona.problemSolved || '';
  let idealCustomer = persona.idealCustomer || '';
  try {
    const { loadBrandProfile } = await import('./brand-profile.js');
    const profile = loadBrandProfile();
    if (!brandName && profile.identity.name) brandName = profile.identity.name;
    if (!niche && profile.voice.toneNotes) niche = profile.voice.toneNotes;
    if (!problemSolved && profile.identity.description) problemSolved = profile.identity.description;
    if (!idealCustomer && profile.stance) idealCustomer = profile.stance;
  } catch {}

  const platformContext = PLATFORM_PROMPTS[platform] ?? PLATFORM_PROMPTS['x'];

  const prompt = `You are a relevance filter for an AI marketing agent. Evaluate whether this conversation is worth replying to.

${platformContext}

Our brand: ${brandName}
Our niche: ${niche}
What we do: ${problemSolved}
Who we serve: ${idealCustomer}

Conversation to evaluate:
- Author: ${conversation.author}
- Text: "${conversation.text}"
- Engagement: ${conversation.engagement.likes} likes, ${conversation.engagement.replies} replies
- URL: ${conversation.url}

Evaluate these criteria:
1. Is the author a real person (not a brand, bot, or automated account)?
2. Is the topic genuinely relevant to "${persona.niche}"?
3. Would a helpful reply feel natural here, or would it seem forced/spammy?

Respond with ONLY a JSON object (no markdown fences):
{"relevant": true/false, "reason": "one sentence explanation"}`;

  // Intent classification (pre-filter — runs before main relevance check)
  const brandContext = `${niche} — ${problemSolved}`;
  const intent = await classifyIntent(conversation.text, brandContext);

  // If intent says not actionable, reduce likelihood of relevance
  if (intent && !intent.is_actionable) {
    return { relevant: false, reason: `Intent: ${intent.intent} — not actionable`, intent };
  }

  const response = await askLLM(prompt, { maxTokens: 100, temperature: 0.3 });

  if (!response) {
    return { relevant: false, reason: 'llm-call-failed' };
  }

  try {
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as { relevant: boolean; reason: string };
    return {
      relevant: Boolean(parsed.relevant),
      reason: String(parsed.reason ?? 'no reason given'),
    };
  } catch {
    // If JSON parse fails, try to infer from text
    const lower = response.toLowerCase();
    if (lower.includes('"relevant": true') || lower.includes('"relevant":true')) {
      return { relevant: true, reason: 'parsed from partial response' };
    }
    return { relevant: false, reason: 'failed to parse LLM response' };
  }
}
