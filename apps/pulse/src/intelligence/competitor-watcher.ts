/**
 * Competitor mention monitoring and opportunity detection.
 * Searches for competitor names across enabled platforms via Serper,
 * classifies sentiment, and generates suggested replies for opportunities.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';
import { searchPlatform } from '../core/search.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompetitorMention {
  competitor: string;
  platform: string;
  url: string;
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  opportunity: boolean;
  suggestedReply?: string;
}

// ─── Platform mapping for Serper site: search ────────────────────────────────

const PLATFORM_SITES: Record<string, 'x.com' | 'reddit.com' | 'news.ycombinator.com' | 'producthunt.com' | 'linkedin.com'> = {
  x: 'x.com',
  reddit: 'reddit.com',
  hackernews: 'news.ycombinator.com',
  producthunt: 'producthunt.com',
  linkedin: 'linkedin.com',
};

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Monitor competitor mentions across all enabled platforms.
 * Classifies sentiment and identifies opportunities (e.g., complaints about competitors).
 * Generates suggested replies for opportunities.
 */
export async function watchCompetitors(): Promise<CompetitorMention[]> {
  const config = getConfig();
  const competitors = config.competitors;

  if (competitors.length === 0) {
    console.log('  [Competitor] No competitors configured — skipping');
    return [];
  }

  const enabledPlatforms = Object.entries(config.platforms)
    .filter(([, s]) => s.enabled)
    .map(([name]) => name);

  const mentions: CompetitorMention[] = [];

  for (const competitor of competitors) {
    for (const platform of enabledPlatforms) {
      const site = PLATFORM_SITES[platform];
      if (!site) continue; // Discord doesn't have a site: search

      const results = await searchPlatform(site, competitor, {
        num: 5,
        timeFilter: 'qdr:w', // Past week
      });

      for (const result of results) {
        const text = `${result.title} ${result.snippet}`;

        // Batch-classify with LLM
        const analysis = await classifyMention(competitor, platform, text);

        const mention: CompetitorMention = {
          competitor,
          platform,
          url: result.url,
          text: result.snippet,
          sentiment: analysis.sentiment,
          opportunity: analysis.opportunity,
        };

        // Generate reply suggestion for opportunities
        if (analysis.opportunity) {
          const reply = await generateOpportunityReply(competitor, platform, text);
          if (reply) mention.suggestedReply = reply;
        }

        mentions.push(mention);
      }
    }
  }

  console.log(`  [Competitor] Found ${mentions.length} mentions, ${mentions.filter((m) => m.opportunity).length} opportunities`);
  return mentions;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function classifyMention(
  competitor: string,
  platform: string,
  text: string
): Promise<{ sentiment: 'positive' | 'negative' | 'neutral'; opportunity: boolean }> {
  const config = getConfig();

  const prompt = `Classify this ${platform} mention of "${competitor}" (a competitor to ${config.persona.brandName}).

Text: "${text}"

Classify:
1. Sentiment: Is the author positive, negative, or neutral about ${competitor}?
2. Opportunity: Is this a chance for ${config.persona.brandName} to be helpful? Opportunities include: someone complaining about ${competitor}, asking for alternatives, comparing tools, or expressing frustration.

Return ONLY a JSON object (no markdown):
{"sentiment": "positive|negative|neutral", "opportunity": true/false}`;

  const response = await askLLM(prompt, { maxTokens: 80, temperature: 0.2 });

  if (!response) {
    return { sentiment: 'neutral', opportunity: false };
  }

  try {
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as { sentiment: string; opportunity: boolean };
    const validSentiments = ['positive', 'negative', 'neutral'];
    const sentiment = validSentiments.includes(parsed.sentiment)
      ? (parsed.sentiment as 'positive' | 'negative' | 'neutral')
      : 'neutral';

    return { sentiment, opportunity: Boolean(parsed.opportunity) };
  } catch {
    return { sentiment: 'neutral', opportunity: false };
  }
}

async function generateOpportunityReply(
  competitor: string,
  platform: string,
  text: string
): Promise<string | null> {
  const personaPrompt = getPersonaPrompt();

  const prompt = `${personaPrompt}

Someone on ${platform} is talking about ${competitor} in a way that's an opportunity for us.

Their text: "${text}"

Write a helpful reply that:
1. Acknowledges their experience or frustration
2. Shares how your product/approach solves it differently (be specific)
3. Does NOT trash-talk ${competitor} — stay classy
4. Ends naturally — no hard sell

Keep it under 300 characters for X, 500 for other platforms. Do not wrap in quotes.`;

  const maxTokens = platform === 'x' ? 150 : 250;
  const response = await askLLM(prompt, { maxTokens, temperature: 0.75 });

  if (!response) return null;

  let reply = response.trim();
  if ((reply.startsWith('"') && reply.endsWith('"')) || (reply.startsWith("'") && reply.endsWith("'"))) {
    reply = reply.slice(1, -1);
  }

  return reply;
}
