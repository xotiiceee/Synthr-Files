/**
 * Preview Mode — "show me it works" before going live.
 *
 * Runs the full pipeline (discovery → scoring → reply generation) but
 * presents results interactively instead of posting or saving drafts.
 * Designed for first-time onboarding: user sees exactly what Pulse would
 * do, with real posts and real replies, before committing.
 *
 * Output: 3-5 real conversation + reply pairs with quality indicators.
 */

import { getConfig, getEnabledPlatforms } from '../core/persona.js';
import { search } from '../core/search.js';
import { matchesKeywords } from '../intelligence/keyword-matcher.js';
import { checkRelevance } from '../intelligence/relevance-filter.js';
import { generateReply } from '../intelligence/reply-generator.js';
import { isLLMAvailable } from '../core/llm.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PreviewItem {
  /** The post we found */
  post: {
    text: string;
    author: string;
    url: string;
    platform: string;
  };
  /** The reply we'd generate */
  reply: string;
  /** Topic that matched */
  topicId: string;
  /** Relevance score (0-100) */
  relevance: number;
  /** Quality indicators for the user */
  indicators: string[];
}

export interface PreviewResult {
  items: PreviewItem[];
  searchesPerformed: number;
  candidatesFound: number;
  llmAvailable: boolean;
}

// ─── Preview ────────────────────────────────────────────────────────────────

/**
 * Run the full outreach pipeline in preview mode.
 * Returns 3-5 real conversation + reply pairs for user review.
 * Does NOT post, save drafts, or modify any state.
 */
export async function runPreview(maxItems: number = 5): Promise<PreviewResult> {
  const config = getConfig();
  const llmAvailable = await isLLMAvailable();
  const result: PreviewResult = {
    items: [],
    searchesPerformed: 0,
    candidatesFound: 0,
    llmAvailable,
  };

  if (!llmAvailable) {
    console.log('[Preview] LLM not available — cannot generate replies.');
    return result;
  }

  const enabledPlatforms = getEnabledPlatforms();
  if (enabledPlatforms.length === 0) {
    console.log('[Preview] No platforms enabled.');
    return result;
  }

  const PLATFORM_SITES: Record<string, string> = {
    x: 'site:x.com',
    reddit: 'site:reddit.com',
    hackernews: 'site:news.ycombinator.com',
    producthunt: 'site:producthunt.com',
  };

  // Shuffle topics, pick a few
  const topics = [...config.topics].sort(() => Math.random() - 0.5).slice(0, 4);

  for (const topic of topics) {
    if (result.items.length >= maxItems) break;

    const platform = enabledPlatforms.find(p => !topic.platform || topic.platform === p) || 'x';
    const sitePrefix = PLATFORM_SITES[platform] || '';
    if (!sitePrefix) continue;

    const query = `${sitePrefix} ${topic.query}`;
    console.log(`[Preview] Searching: "${topic.query}" on ${platform}...`);
    result.searchesPerformed++;

    let results;
    try {
      results = await search(query, { num: 5, timeFilter: 'qdr:w' });
    } catch {
      continue;
    }

    // Filter
    const viable = results.filter(r => {
      if (r.snippet.length < 30) return false;
      if (topic.textMustMatch.length > 0) {
        return matchesKeywords(r.title + ' ' + r.snippet, topic.textMustMatch, 1);
      }
      return true;
    });

    result.candidatesFound += viable.length;

    // Take the best candidate
    const candidate = viable[0];
    if (!candidate) continue;

    // Relevance check
    const conversation = {
      id: 'preview',
      platform,
      url: candidate.url,
      text: candidate.snippet,
      author: extractAuthor(candidate.url),
      topicId: topic.id,
      createdAt: new Date().toISOString(),
      engagement: { likes: 0, replies: 0, reposts: 0 },
    };

    const relevance = await checkRelevance(conversation, platform);
    if (!relevance.relevant) continue;

    // Generate reply
    const reply = await generateReply(conversation, platform);
    if (!reply) continue;

    // Build quality indicators
    const indicators: string[] = [];
    if (reply.length <= 280) indicators.push('fits X character limit');
    if (reply.length >= 50) indicators.push('substantive response');
    if (!/http|www\./i.test(reply)) indicators.push('no URL (conversational)');
    if (relevance.relevant) indicators.push(`relevance: high`);

    result.items.push({
      post: {
        text: candidate.snippet,
        author: conversation.author,
        url: candidate.url,
        platform,
      },
      reply,
      topicId: topic.id,
      relevance: 80, // LLM said relevant
      indicators,
    });
  }

  return result;
}

function extractAuthor(url: string): string {
  const match = url.match(/x\.com\/([^/]+)/);
  return match?.[1] ?? 'unknown';
}

/**
 * Format preview results for display.
 */
export function formatPreview(result: PreviewResult): string {
  if (result.items.length === 0) {
    return 'No preview results — try adjusting your topics or checking your search API key.';
  }

  let output = `\nPulse Preview — ${result.items.length} conversations found\n`;
  output += `(${result.searchesPerformed} searches, ${result.candidatesFound} candidates)\n`;
  output += '─'.repeat(60) + '\n';

  for (let i = 0; i < result.items.length; i++) {
    const item = result.items[i];
    output += `\n${i + 1}. @${item.post.author} on ${item.post.platform}:\n`;
    output += `   "${item.post.text.slice(0, 200)}"\n\n`;
    output += `   Your reply:\n`;
    output += `   "${item.reply}"\n\n`;
    output += `   ${item.indicators.join(' | ')}\n`;
    output += '─'.repeat(60) + '\n';
  }

  output += '\nLooks good? Run `npm run outreach` to start generating drafts.\n';
  return output;
}
