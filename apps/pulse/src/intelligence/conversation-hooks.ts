/**
 * Conversation Hooks — feed outreach discoveries into content generation.
 *
 * The best original posts on X start with "I just saw someone ask about X..."
 * or "there's a debate happening about Y..." This module scans recent
 * outreach opportunities and extracts the juiciest conversations as hooks
 * for original content.
 *
 * Connects the outreach pipeline (what people are talking about) to the
 * content pipeline (what you should post about).
 */

import { loadState } from '../core/state.js';
import type { Opportunity } from '../core/opportunity-engine.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConversationHook {
  /** The original post text that sparked the idea */
  sourceText: string;
  /** Who posted it */
  sourceAuthor: string;
  /** Platform */
  platform: string;
  /** Topic that matched */
  topicId: string;
  /** Relevance score (from opportunity engine) */
  relevance: number;
  /** What kind of content hook this is */
  hookType: 'question_people_ask' | 'hot_debate' | 'common_pain_point' | 'trending_take';
  /** A starter prompt for the content generator */
  contentPrompt: string;
}

// ─── Hook Detection Patterns ────────────────────────────────────────────────

const QUESTION_PATTERNS = [
  /\bhow\s+(do|does|can|should|would)\b/i,
  /\bwhat('s|\s+is)\s+the\s+best\b/i,
  /\bwhy\s+(do|does|is|are|can't)\b/i,
  /\banyone\s+(tried|know|recommend|using)\b/i,
  /\?\s*$/,
];

const DEBATE_PATTERNS = [
  /\bunpopular\s+opinion\b/i,
  /\bhot\s+take\b/i,
  /\bcontroversial\b/i,
  /\bdisagree\b/i,
  /\boverrated|underrated\b/i,
  /\bactually\b.*\bbetter\s+than\b/i,
];

const PAIN_PATTERNS = [
  /\bstruggling\s+with\b/i,
  /\bfrustrated\b/i,
  /\bwish\s+(there|someone|it)\b/i,
  /\btired\s+of\b/i,
  /\bwhy\s+is\s+it\s+so\s+hard\b/i,
  /\bcan't\s+find\b/i,
];

function classifyHook(text: string): ConversationHook['hookType'] | null {
  for (const p of QUESTION_PATTERNS) {
    if (p.test(text)) return 'question_people_ask';
  }
  for (const p of DEBATE_PATTERNS) {
    if (p.test(text)) return 'hot_debate';
  }
  for (const p of PAIN_PATTERNS) {
    if (p.test(text)) return 'common_pain_point';
  }
  return null;
}

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * Scan recent opportunities and extract the best conversation hooks.
 * Returns up to 5 hooks sorted by relevance.
 */
export function extractConversationHooks(maxHooks: number = 5): ConversationHook[] {
  const state = loadState<{ items: Opportunity[] }>('opportunities', { items: [] });

  // Only look at recent, high-relevance opportunities
  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
  const recent = state.items.filter(opp =>
    opp.discoveredAt > cutoff &&
    opp.relevanceScore >= 50 &&
    opp.text.length >= 40
  );

  const hooks: ConversationHook[] = [];

  for (const opp of recent) {
    const hookType = classifyHook(opp.text);
    if (!hookType) continue;

    let contentPrompt: string;
    switch (hookType) {
      case 'question_people_ask':
        contentPrompt = `People are asking: "${opp.text.slice(0, 150)}" — write a post that answers this question from your experience. Don't reference the original post directly, just address the topic naturally.`;
        break;
      case 'hot_debate':
        contentPrompt = `There's a debate happening about: "${opp.text.slice(0, 150)}" — write a post sharing your nuanced take. Don't be contrarian for the sake of it — add genuine perspective.`;
        break;
      case 'common_pain_point':
        contentPrompt = `People are frustrated about: "${opp.text.slice(0, 150)}" — write a post that acknowledges this pain and shares a practical insight or approach.`;
        break;
      case 'trending_take':
        contentPrompt = `Trending conversation about: "${opp.text.slice(0, 150)}" — write a post that adds to this discussion with your unique angle.`;
        break;
    }

    hooks.push({
      sourceText: opp.text.slice(0, 300),
      sourceAuthor: opp.author,
      platform: opp.platform,
      topicId: opp.topicId,
      relevance: opp.relevanceScore,
      hookType,
      contentPrompt,
    });
  }

  // Deduplicate by topic (max 1 hook per topic)
  const byTopic = new Map<string, ConversationHook>();
  for (const hook of hooks) {
    const existing = byTopic.get(hook.topicId);
    if (!existing || hook.relevance > existing.relevance) {
      byTopic.set(hook.topicId, hook);
    }
  }

  // Sort by relevance, return top N
  return [...byTopic.values()]
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxHooks);
}

/**
 * Get a conversation hook suitable for the content generator.
 * Returns null if no good hooks available — content falls back to theme-based.
 */
export function getContentHook(): ConversationHook | null {
  const hooks = extractConversationHooks(3);
  if (hooks.length === 0) return null;
  // Pick one at random from top 3
  return hooks[Math.floor(Math.random() * hooks.length)];
}
