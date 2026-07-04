/**
 * Opportunity Discovery Engine for PULSE.
 *
 * Phase 1 of the split outreach pipeline: discovers relevant conversations
 * across platforms without generating replies. Opportunities are surfaced
 * to the user in a feed, and replies are generated on demand when the
 * user selects which conversations to engage with.
 *
 * Learning system tracks user approve/skip behavior:
 * - Topic preference scores (engaged vs skipped by topicId)
 * - Author affinity (engaged vs skipped by author)
 * - Relevance threshold calibration from actual user decisions
 *
 * In auto mode, learned preferences drive engage/skip decisions automatically.
 *
 * Flow: search topics -> filter seen URLs -> LLM relevance scoring -> persist feed
 */

import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';
import { matchesKeywords } from '../intelligence/keyword-matcher.js';
import { loadState, saveState, generateId } from '../core/state.js';
import { buildVoiceBlock, humanizeText } from '../intelligence/human-behavior.js';
import { getListeningProvider } from '../core/listening.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type OpportunityStatus = 'new' | 'selected' | 'replied' | 'skipped' | 'expired' | 'engaging';

export interface Opportunity {
  id: string;
  platform: string;
  url: string;
  text: string;           // the original post text
  author: string;
  topicId: string;        // which search topic matched
  topicQuery: string;     // the query that found it
  relevanceScore: number; // 0-100 from LLM
  status: OpportunityStatus;
  suggestedReply?: string; // generated on demand when user selects
  discoveredAt: string;
  repliedAt?: string;
  replyUrl?: string;      // URL of our posted reply (for "View reply on X" link)
  skippedAt?: string;
  skipReason?: string;    // 'irrelevant' | 'wrong_tone' | 'spam' | 'not_interested'
  engageStartedAt?: string; // When engage-first flow began (liked + followed)
  quoteTweetUrl?: string;   // URL of quote tweet if fallback was used
}

export interface OpportunityLearning {
  topicEngagements: Record<string, number>;  // topicId -> engagement count
  topicSkips: Record<string, number>;        // topicId -> skip count
  authorEngagements: Record<string, number>; // author -> engagement count
  authorSkips: Record<string, number>;       // author -> skip count
  minEngagedRelevance: number;               // lowest relevance score that was engaged with
  avgEngagedRelevance: number;               // average relevance of engaged items
  skipReasons: Record<string, number>;       // reason -> count
}

interface OpportunityState {
  items: Opportunity[];
  seenUrls: string[];
  learning: OpportunityLearning;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATE_KEY = 'opportunities';
const MAX_ITEMS = 200;
const MAX_SEEN_URLS = 2000;
const MIN_RELEVANCE_SCORE = 40;
const MIN_TEXT_LENGTH = 30;
const EXPIRY_DAYS = 7;

/** Normalize URLs for deduplication (strip www/m prefix, query params, trailing slashes) */
function canonicalizeUrl(url: string): string {
  return url
    .replace(/^https?:\/\/(www\.|m\.)?/, 'https://')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

const DEFAULT_LEARNING: OpportunityLearning = {
  topicEngagements: {},
  topicSkips: {},
  authorEngagements: {},
  authorSkips: {},
  minEngagedRelevance: 0,
  avgEngagedRelevance: 0,
  skipReasons: {},
};

/** Platform site: prefixes for search queries */
const PLATFORM_SITES: Record<string, string> = {
  x: 'site:x.com',
  reddit: 'site:reddit.com',
  hackernews: 'site:news.ycombinator.com',
  producthunt: 'site:producthunt.com',
  linkedin: '', // LinkedIn blocks Google indexing — discovery not supported
  discord: '',  // Discord is not indexed by search engines
};

/** Platform-specific context for relevance scoring */
const PLATFORM_RELEVANCE_CONTEXT: Record<string, string> = {
  x: 'X (Twitter) — users are skeptical of marketing. Only score high if from a real person discussing a genuine problem or question.',
  reddit: 'Reddit — extremely hostile to marketing. Only score high if a genuine question or discussion where helpful input is natural.',
  hackernews: 'Hacker News — most discerning tech audience. Only score high for substantive technical discussion or "Ask HN" threads.',
  discord: 'Discord — more casual. Score high if someone is asking for help or recommendations.',
  linkedin: 'LinkedIn — tolerant of professional recommendations. Score high for industry challenges and tool discussions.',
  producthunt: 'Product Hunt — product discussions expected. Score high for tool comparisons and pain points.',
};

// ─── State Helpers ──────────────────────────────────────────────────────────

function loadOpportunityState(): OpportunityState {
  const state = loadState<OpportunityState>(STATE_KEY, {
    items: [],
    seenUrls: [],
    learning: { ...DEFAULT_LEARNING },
  });
  // Ensure learning sub-object exists (handles first load / corrupted state / migration)
  if (!state.learning) state.learning = { ...DEFAULT_LEARNING };
  if (!state.learning.topicEngagements) state.learning.topicEngagements = {};
  if (!state.learning.topicSkips) state.learning.topicSkips = {};
  if (!state.learning.authorEngagements) state.learning.authorEngagements = {};
  if (!state.learning.authorSkips) state.learning.authorSkips = {};
  if (!state.learning.skipReasons) state.learning.skipReasons = {};
  if (typeof state.learning.minEngagedRelevance !== 'number') state.learning.minEngagedRelevance = 0;
  if (typeof state.learning.avgEngagedRelevance !== 'number') state.learning.avgEngagedRelevance = 0;
  return state;
}

function saveOpportunityState(state: OpportunityState): void {
  // Cap items
  if (state.items.length > MAX_ITEMS) {
    // Keep newest, remove oldest 'new' or 'expired' first
    state.items.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
    state.items = state.items.slice(0, MAX_ITEMS);
  }
  // Cap seenUrls (keep most recent)
  if (state.seenUrls.length > MAX_SEEN_URLS) {
    state.seenUrls = state.seenUrls.slice(-MAX_SEEN_URLS);
  }
  saveState(STATE_KEY, state);
}

// ─── Relevance Scoring ──────────────────────────────────────────────────────

/**
 * Score a batch of candidate opportunities for relevance using the LLM.
 * Returns the candidates with relevanceScore populated.
 */
async function scoreRelevance(
  candidates: Opportunity[],
  platform: string,
): Promise<Opportunity[]> {
  if (candidates.length === 0) return [];

  const config = getConfig();
  const { persona } = config;
  const platformContext = PLATFORM_RELEVANCE_CONTEXT[platform] ?? PLATFORM_RELEVANCE_CONTEXT['x'];

  // Process in batches of 5 to avoid overloading single LLM calls
  const BATCH_SIZE = 5;
  const scored: Opportunity[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    const postsBlock = batch
      .map((opp, idx) => {
        // Wrap external text in injection defense markers
        return `[${idx + 1}] Author: ${opp.author}\n---BEGIN EXTERNAL TEXT---\n${opp.text.slice(0, 400)}\n---END EXTERNAL TEXT---\nURL: ${opp.url}`;
      })
      .join('\n\n');

    const prompt = `You are a relevance scorer for a social media engagement tool. Score each post on how relevant it is for us to engage with.

Platform: ${platformContext}

Our niche: ${persona.niche}
Problem we solve: ${persona.problemSolved}
Ideal customer: ${persona.idealCustomer}

Score criteria:
- Is the author a real person (not a brand/bot)?
- Is the topic genuinely relevant to "${persona.niche}"?
- Would a helpful reply feel natural, or would it seem forced/spammy?
- Is this a genuine question or discussion (not just broadcasting)?

Posts to evaluate:

${postsBlock}

For EACH post, provide a relevance score from 0-100 where:
- 0-20: Completely irrelevant, spam, or bot content
- 21-39: Tangentially related but not worth engaging
- 40-59: Somewhat relevant, could be worth a reply
- 60-79: Clearly relevant, good engagement opportunity
- 80-100: Highly relevant, ideal conversation to join

Respond with ONLY a JSON array (no markdown fences):
[{"index": 1, "score": 75, "reason": "one sentence"}, ...]`;

    const response = await askLLM(prompt, { maxTokens: 400, temperature: 0.3 });

    if (!response) {
      // LLM failed — assign default middle score so they're not lost
      for (const opp of batch) {
        opp.relevanceScore = 30; // Below MIN_RELEVANCE_SCORE — safe to skip on LLM failure
        scored.push(opp);
      }
      continue;
    }

    try {
      let jsonStr = response.trim();
      // Strip markdown fences if present
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const results = JSON.parse(jsonStr) as Array<{ index: number; score: number; reason: string }>;

      for (const opp of batch) {
        const batchIdx = batch.indexOf(opp) + 1;
        const result = results.find((r) => r.index === batchIdx);
        opp.relevanceScore = result ? Math.max(0, Math.min(100, Math.round(result.score))) : 30;
        scored.push(opp);
      }
    } catch {
      // JSON parse failed — default below threshold so they don't leak through
      for (const opp of batch) {
        opp.relevanceScore = 30;
        scored.push(opp);
      }
    }
  }

  return scored;
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Discover new opportunities by searching configured topics across platforms.
 * Search only — no reply generation. Returns newly discovered opportunities.
 */
export async function discoverOpportunities(): Promise<Opportunity[]> {
  // Clean up old/expired opportunities at the start of each discovery run
  cleanupOpportunities();

  const config = getConfig();
  const state = loadOpportunityState();
  const seenSet = new Set(state.seenUrls.map(canonicalizeUrl));
  const newOpportunities: Opportunity[] = [];
  const listening = getListeningProvider();

  // Determine enabled platforms
  const enabledPlatforms = Object.entries(config.platforms)
    .filter(([, settings]) => settings.enabled)
    .map(([name]) => name);

  if (enabledPlatforms.length === 0) {
    console.log('[Opportunity] No platforms enabled.');
    return [];
  }

  if (config.topics.length === 0) {
    console.log('[Opportunity] No search topics configured.');
    return [];
  }

  // Shuffle topics for coverage variety across runs
  const shuffledTopics = [...config.topics].sort(() => Math.random() - 0.5);

  for (const platform of enabledPlatforms) {
    const sitePrefix = PLATFORM_SITES[platform];
    if (sitePrefix === undefined) continue; // Unknown platform
    if (!sitePrefix) continue; // Platform not searchable via Google (Discord, LinkedIn)

    // Filter topics to those relevant to this platform
    const platformTopics = shuffledTopics.filter(
      (t) => !t.platform || t.platform === platform,
    );

    // Pick up to 6 topics per platform per run
    const selectedTopics = platformTopics.slice(0, 6);

    for (const topic of selectedTopics) {
      const query = sitePrefix ? `${sitePrefix} ${topic.query}` : topic.query;
      console.log(`[Opportunity] Searching [${topic.id}] on ${platform}: "${query}"`);

      let results;
      try {
        results = await listening.search(query, { num: 10, timeFilter: 'qdr:d' });
      } catch (err) {
        console.log(`[Opportunity] Search failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      // ── ClawNet real-time supplement (X only) ──────────────────────────
      // Serper returns Google-indexed posts (hours old). ClawNet returns
      // real-time results (minutes old). Merge both for best coverage.
      if (platform === 'x' && listening.canSearchXRealtime()) {
        try {
          const realtimeResults = await listening.searchXRealtime(topic.query, { limit: 10 });
          for (const result of realtimeResults) {
            if (!seenSet.has(canonicalizeUrl(result.url))) {
              results.push(result);
            }
          }
        } catch {
          // Real-time search failed — web search results still available
        }
      }

      if (results.length === 0) continue;

      // Filter out already-seen URLs
      const fresh = results.filter((r) => !seenSet.has(canonicalizeUrl(r.url)));
      if (fresh.length === 0) continue;

      // Filter out too-short snippets
      const viable = fresh.filter((r) => r.snippet.length >= MIN_TEXT_LENGTH);

      // Apply smart keyword filters — stemming + synonym expansion (Phase 1)
      // LLM relevance scorer (Phase 2) provides safety net for false positives
      const keywordFiltered = viable.filter((r) => {
        if (topic.textMustMatch.length === 0) return true;
        const text = r.title + ' ' + r.snippet;
        return matchesKeywords(text, topic.textMustMatch, 1);
      });

      // Create opportunity objects
      for (const result of keywordFiltered) {
        const opp: Opportunity = {
          id: generateId(),
          platform,
          url: result.url,
          text: result.snippet,
          author: extractAuthor(result.url, result.title),
          topicId: topic.id,
          topicQuery: topic.query,
          relevanceScore: 0, // Populated by scoring step
          status: 'new',
          discoveredAt: new Date().toISOString(),
        };
        newOpportunities.push(opp);
        seenSet.add(canonicalizeUrl(result.url));
      }
    }
  }

  if (newOpportunities.length === 0) {
    console.log('[Opportunity] No new opportunities found.');
    saveOpportunityState(state);
    return [];
  }

  console.log(`[Opportunity] Found ${newOpportunities.length} candidates, scoring relevance...`);

  // Group by platform for relevance scoring (platform-specific context)
  const byPlatform = new Map<string, Opportunity[]>();
  for (const opp of newOpportunities) {
    const list = byPlatform.get(opp.platform) ?? [];
    list.push(opp);
    byPlatform.set(opp.platform, list);
  }

  const scored: Opportunity[] = [];
  for (const [platform, opps] of byPlatform) {
    const results = await scoreRelevance(opps, platform);
    scored.push(...results);
  }

  // Filter out low relevance
  const relevant = scored.filter((opp) => opp.relevanceScore >= MIN_RELEVANCE_SCORE);
  const dropped = scored.length - relevant.length;
  if (dropped > 0) {
    console.log(`[Opportunity] Filtered out ${dropped} low-relevance results (< ${MIN_RELEVANCE_SCORE}).`);
  }

  // Sort by relevance score descending
  relevant.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Merge into state
  state.items.push(...relevant);
  // Add all searched URLs to seenUrls (including filtered-out ones, to avoid re-processing)
  state.seenUrls = [...seenSet];
  saveOpportunityState(state);

  console.log(`[Opportunity] Discovered ${relevant.length} new opportunities.`);
  return relevant;
}

// ─── Feed ───────────────────────────────────────────────────────────────────

/**
 * Get all opportunities from state, optionally filtered by status and/or platform.
 * Returns newest first.
 */
export function getOpportunityFeed(
  filter?: { status?: OpportunityStatus; platform?: string },
): Opportunity[] {
  const state = loadOpportunityState();
  let items = state.items;

  if (filter?.status) {
    items = items.filter((o) => o.status === filter.status);
  }
  if (filter?.platform) {
    items = items.filter((o) => o.platform === filter.platform);
  }

  // Newest first
  return items.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
}

// ─── On-Demand Reply Generation ─────────────────────────────────────────────

const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  reddit: 500,
  hackernews: 500,
  linkedin: 500,
  discord: 400,
  producthunt: 500,
};

/**
 * Generate a reply for a specific opportunity on demand.
 * Returns the reply text, or null if generation fails or the opportunity is not found.
 */
export async function generateReplyForOpportunity(id: string, feedback?: string): Promise<string | null> {
  const state = loadOpportunityState();
  const opp = state.items.find((o) => o.id === id);
  if (!opp) {
    console.log(`[Opportunity] Not found: ${id}`);
    return null;
  }

  const config = getConfig();
  const personaPrompt = getPersonaPrompt();
  const charLimit = PLATFORM_CHAR_LIMITS[opp.platform] ?? 500;
  const includeUrl = Math.random() < 0.3;

  // Build voice consistency block
  const voiceBlock = buildVoiceBlock();

  const prompt = `${personaPrompt}

${voiceBlock}

You are replying to a conversation on ${opp.platform}. Write a natural, helpful reply that adds genuine value.

${includeUrl && config.persona.website ? `If naturally relevant, you may mention: ${config.persona.website}` : 'Do NOT include any URLs unless organically relevant.'}

---BEGIN EXTERNAL TEXT---
Author: ${opp.author}
Post: ${opp.text.slice(0, 500)}
URL: ${opp.url}
---END EXTERNAL TEXT---

Rules:
- Your reply MUST be about the SAME TOPIC as their post. Do NOT pivot to a different subject.
- Write something ORIGINAL. Every reply must be unique.
- Be SPECIFIC — reference actual words or ideas from their post.
- No generic openers ("great point", "so true", "this!")
- If their post is promoting a product/company (not discussing a problem), respond with: DECLINE
- Maximum ${charLimit} characters. Count carefully.
- Sound like a real person, not a marketing bot.${feedback ? `\n\nUser feedback on the previous reply: "${feedback}". Incorporate this guidance into the new reply.` : ''}`;

  const response = await askLLM(prompt, {
    maxTokens: Math.ceil(charLimit / 2),
    temperature: 0.8,
  });

  if (!response) return null;

  let reply = response.trim();

  // LLM declined
  if (reply.toUpperCase().startsWith('DECLINE') || reply.toUpperCase().startsWith('SKIP')) {
    return null;
  }

  // Strip surrounding quotes
  if (
    (reply.startsWith('"') && reply.endsWith('"')) ||
    (reply.startsWith("'") && reply.endsWith("'"))
  ) {
    reply = reply.slice(1, -1);
  }

  // Strip "Reply:" or similar prefixes
  reply = reply.replace(/^(Reply|Response|Here'?s? (?:my |a )?reply):\s*/i, '');

  // Reject if too short
  if (reply.length < 20) return null;

  // Enforce character limit gracefully
  if (reply.length > charLimit) {
    const truncated = reply.slice(0, charLimit - 3);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastQuestion = truncated.lastIndexOf('?');
    const cutPoint = Math.max(lastPeriod, lastQuestion);
    if (cutPoint > charLimit * 0.5) {
      reply = reply.slice(0, cutPoint + 1);
    } else {
      reply = truncated + '...';
    }
  }

  // Apply anti-detection humanization
  reply = humanizeText(reply, opp.platform);

  // Save reply to opportunity
  opp.suggestedReply = reply;
  opp.status = 'selected';
  saveOpportunityState(state);

  return reply;
}

// ─── Status Mutations ───────────────────────────────────────────────────────

/**
 * Mark an opportunity as skipped with an optional reason.
 */
export function skipOpportunity(id: string, reason?: string): void {
  const state = loadOpportunityState();
  const opp = state.items.find((o) => o.id === id);
  if (!opp) return;

  opp.status = 'skipped';
  opp.skippedAt = new Date().toISOString();
  opp.skipReason = reason ?? 'not_interested';

  // Record skip in learning state
  state.learning.topicSkips[opp.topicId] = (state.learning.topicSkips[opp.topicId] ?? 0) + 1;
  state.learning.authorSkips[opp.author] = (state.learning.authorSkips[opp.author] ?? 0) + 1;
  if (reason) {
    state.learning.skipReasons[reason] = (state.learning.skipReasons[reason] ?? 0) + 1;
  }

  saveOpportunityState(state);
}

/**
 * Mark an opportunity as replied with the actual reply text used.
 */
export function markOpportunityReplied(id: string, replyText: string): void {
  const state = loadOpportunityState();
  const opp = state.items.find((o) => o.id === id);
  if (!opp) return;

  opp.status = 'replied';
  opp.suggestedReply = replyText;
  opp.repliedAt = new Date().toISOString();

  // Record engagement in learning state
  state.learning.topicEngagements[opp.topicId] = (state.learning.topicEngagements[opp.topicId] ?? 0) + 1;
  state.learning.authorEngagements[opp.author] = (state.learning.authorEngagements[opp.author] ?? 0) + 1;

  // Track the relevance score threshold
  if (opp.relevanceScore < state.learning.minEngagedRelevance || state.learning.minEngagedRelevance === 0) {
    state.learning.minEngagedRelevance = opp.relevanceScore;
  }

  // Update rolling average of engaged relevance
  const totalEngaged = Object.values(state.learning.topicEngagements).reduce((a, b) => a + b, 0);
  state.learning.avgEngagedRelevance = Math.round(
    ((state.learning.avgEngagedRelevance * (totalEngaged - 1)) + opp.relevanceScore) / totalEngaged
  );

  saveOpportunityState(state);
}

/**
 * Update the suggested reply text for an opportunity (e.g. after user edits).
 */
export function updateOpportunitySuggestedReply(id: string, replyText: string): void {
  const state = loadOpportunityState();
  const opp = state.items.find((o) => o.id === id);
  if (!opp) return;

  opp.suggestedReply = replyText;
  saveOpportunityState(state);
}

// ─── Learning Stats ─────────────────────────────────────────────────────────

/**
 * Aggregate engagement vs skip stats by topic.
 * Useful for learning which topics yield engagement and which get skipped.
 */
export function getLearningStats(): {
  topicsEngaged: Record<string, number>;
  topicsSkipped: Record<string, number>;
  totalEngaged: number;
  totalSkipped: number;
  learning: OpportunityLearning;
} {
  const state = loadOpportunityState();

  const topicsEngaged: Record<string, number> = {};
  const topicsSkipped: Record<string, number> = {};
  let totalEngaged = 0;
  let totalSkipped = 0;

  for (const opp of state.items) {
    if (opp.status === 'replied' || opp.status === 'selected') {
      topicsEngaged[opp.topicId] = (topicsEngaged[opp.topicId] ?? 0) + 1;
      totalEngaged++;
    } else if (opp.status === 'skipped') {
      topicsSkipped[opp.topicId] = (topicsSkipped[opp.topicId] ?? 0) + 1;
      totalSkipped++;
    }
  }

  return { topicsEngaged, topicsSkipped, totalEngaged, totalSkipped, learning: { ...state.learning } };
}

// ─── Learning Helpers ────────────────────────────────────────────────────────

/**
 * Check if a topic has a high skip rate (skipped more than 2x engaged).
 * Requires at least 3 data points to make a judgment.
 */
function isHighSkipTopic(topicId: string, learning: OpportunityLearning): boolean {
  const engagements = learning.topicEngagements[topicId] ?? 0;
  const skips = learning.topicSkips[topicId] ?? 0;
  if (engagements + skips < 3) return false;
  return skips > engagements * 2;
}

/**
 * Check if an author has a high skip rate (skipped more than 2x engaged).
 * Requires at least 2 data points to make a judgment.
 */
function isHighSkipAuthor(author: string, learning: OpportunityLearning): boolean {
  const engagements = learning.authorEngagements[author] ?? 0;
  const skips = learning.authorSkips[author] ?? 0;
  if (engagements + skips < 2) return false;
  return skips > engagements * 2;
}

// ─── Self-Judge for Auto-Engage Replies ──────────────────────────────────────

/**
 * Judge whether a generated reply is good enough to auto-post.
 * Stricter than human-reviewed flow since there's no manual check.
 */
async function judgeReply(
  replyText: string,
  originalText: string,
  platform: string,
): Promise<{ approved: boolean; reason: string; score: number }> {
  const personaPrompt = getPersonaPrompt();

  const prompt = `${personaPrompt}

You are the EDITOR for this brand's social replies. Decide if this reply is good enough to auto-post. Be STRICT — only approve replies that genuinely add value.

---BEGIN ORIGINAL POST---
${originalText.slice(0, 300)}
---END ORIGINAL POST---

---BEGIN OUR REPLY---
${replyText}
---END OUR REPLY---

PLATFORM: ${platform}

Evaluate:
1. RELEVANCE — Does our reply directly address what they said?
2. VALUE — Does it add something useful (insight, help, perspective)?
3. NATURAL — Does it sound like a human, not a marketing bot?
4. APPROPRIATE — Would this be welcome in this conversation?
5. RISK — Could this come across as spam or self-promotion?

Respond with ONLY JSON (no markdown fences):
{"approved": true/false, "score": 0-100, "reason": "one sentence"}`;

  const response = await askLLM(prompt, { maxTokens: 100, temperature: 0.2 });
  if (!response) return { approved: true, reason: 'judge unavailable', score: 70 };

  try {
    const cleaned = response.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      approved: !!parsed.approved,
      reason: String(parsed.reason || ''),
      score: Math.min(100, Math.max(0, Number(parsed.score) || 50)),
    };
  } catch {
    return { approved: true, reason: 'parse failed', score: 70 };
  }
}

// ─── Auto-Engage ─────────────────────────────────────────────────────────────

/**
 * Automatically engage with discovered opportunities using learned preferences.
 *
 * Decision flow for each pending opportunity:
 * 1. If topic has high skip rate (skips > engagements * 2), auto-skip
 * 2. If author has high skip rate, auto-skip
 * 3. If relevance score < minEngagedRelevance (learned threshold), auto-skip
 * 4. Otherwise, generate reply on demand + run self-judge
 * 5. Auto-replies that pass the self-judge get posted
 *
 * Returns engagement/skip counts.
 */
export async function autoEngageOpportunities(
  options?: { maxReplies?: number },
): Promise<{ replied: number; skipped: number }> {
  const maxReplies = options?.maxReplies ?? 5;
  let replied = 0;
  let skipped = 0;

  const state = loadOpportunityState();
  const { learning } = state;

  // Get pending ('new') opportunities sorted by relevance (highest first)
  const pending = state.items
    .filter((item) => item.status === 'new')
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  if (pending.length === 0) {
    return { replied: 0, skipped: 0 };
  }

  for (const opp of pending) {
    if (replied >= maxReplies) break;

    // ── Learning-based filters ──

    // 1. High skip-rate topic
    if (isHighSkipTopic(opp.topicId, learning)) {
      skipOpportunity(opp.id, 'learned_topic_skip');
      skipped++;
      console.log(`  [Auto-engage] Skipped (learned: topic "${opp.topicId}" usually skipped): ${opp.text.slice(0, 60)}...`);
      continue;
    }

    // 2. High skip-rate author
    if (isHighSkipAuthor(opp.author, learning)) {
      skipOpportunity(opp.id, 'learned_author_skip');
      skipped++;
      console.log(`  [Auto-engage] Skipped (learned: author "${opp.author}" usually skipped): ${opp.text.slice(0, 60)}...`);
      continue;
    }

    // 3. Below learned relevance threshold
    if (learning.minEngagedRelevance > 0 && opp.relevanceScore < learning.minEngagedRelevance) {
      skipOpportunity(opp.id, 'below_relevance_threshold');
      skipped++;
      console.log(`  [Auto-engage] Skipped (relevance ${opp.relevanceScore} < threshold ${learning.minEngagedRelevance}): ${opp.text.slice(0, 60)}...`);
      continue;
    }

    // ── Generate reply on demand ──

    const replyText = await generateReplyForOpportunity(opp.id);
    if (!replyText) {
      skipOpportunity(opp.id, 'reply_generation_failed');
      skipped++;
      continue;
    }

    // ── Self-judge the reply ──

    const judgment = await judgeReply(replyText, opp.text, opp.platform);
    console.log(`  [Auto-engage] Self-judge: ${judgment.approved ? 'PASS' : 'FAIL'} (${judgment.score}/100) — ${judgment.reason}`);

    if (!judgment.approved) {
      skipOpportunity(opp.id, `self_judge_rejected: ${judgment.reason}`);
      skipped++;
      continue;
    }

    // ── Mark as replied (reply was generated + approved by self-judge) ──

    markOpportunityReplied(opp.id, replyText);
    replied++;
    console.log(`  [Auto-engage] Approved reply for ${opp.platform}: ${opp.url}`);
    console.log(`    Reply: ${replyText.slice(0, 120)}...`);
  }

  return { replied, skipped };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Expire old opportunities and remove them from the feed.
 * Returns the number of items cleaned up.
 */
export function cleanupOpportunities(): number {
  const state = loadOpportunityState();
  const cutoff = new Date(Date.now() - EXPIRY_DAYS * 86400_000).toISOString();
  const before = state.items.length;

  // Mark old 'new' opportunities as expired
  for (const opp of state.items) {
    if (opp.status === 'new' && opp.discoveredAt < cutoff) {
      opp.status = 'expired';
    }
  }

  // Remove expired and old skipped items
  state.items = state.items.filter((opp) => {
    if (opp.status === 'expired') return false;
    if (opp.status === 'skipped' && opp.skippedAt && opp.skippedAt < cutoff) return false;
    return true;
  });

  const removed = before - state.items.length;
  if (removed > 0) {
    console.log(`[Opportunity] Cleaned up ${removed} expired/old opportunities.`);
  }

  saveOpportunityState(state);
  return removed;
}

// ─── Engage-First Flow ───────────────────────────────────────────────────────

/**
 * Start the engage-first flow for an opportunity:
 * 1. Like the tweet
 * 2. Follow the author
 * 3. Mark as 'engaging' with timestamp
 *
 * After 24-48 hours, the author may follow back, enabling direct replies.
 */
export async function startEngagement(id: string): Promise<{ ok: boolean; error?: string }> {
  const state = loadOpportunityState();
  const opp = state.items.find((o) => o.id === id);
  if (!opp) return { ok: false, error: 'Opportunity not found' };

  // Extract tweet ID for liking
  const tweetIdMatch = opp.url.match(/\/status\/(\d+)/);
  const tweetId = tweetIdMatch ? tweetIdMatch[1] : opp.id;

  // 1. Like the tweet
  try {
    const { getXWriteClient } = await import('../platforms/x-write-client.js');
    const liked = await getXWriteClient().like(tweetId);
    if (!liked) {
      console.log(`  [Engage-First] Like failed for ${tweetId} — continuing anyway`);
    } else {
      console.log(`  [Engage-First] Liked tweet ${tweetId}`);
    }
  } catch {
    console.log(`  [Engage-First] Like error — continuing`);
  }

  // 2. Follow the author
  try {
    const { shouldAutoFollow, autoFollowUser } = await import('./follow-engine.js');
    const username = opp.author.replace(/^@/, '');
    const should = await shouldAutoFollow({
      username,
      platformId: username,
      signal: 'engage_first',
      confidence: 80,
    });
    if (should) {
      const followResult = await autoFollowUser({
        username,
        platformId: username,
        signal: 'engage_first',
        confidence: 80,
      });
      if (followResult.ok) {
        console.log(`  [Engage-First] Followed @${username}`);
      } else {
        console.log(`  [Engage-First] Follow failed: ${followResult.error}`);
      }
    } else {
      console.log(`  [Engage-First] Follow skipped (engine declined or already following)`);
    }
  } catch {
    console.log(`  [Engage-First] Follow error — continuing`);
  }

  // 3. Mark as engaging
  opp.status = 'engaging';
  opp.engageStartedAt = new Date().toISOString();
  saveOpportunityState(state);

  console.log(`  [Engage-First] Started engagement for ${opp.url}`);
  return { ok: true };
}

/**
 * Get all opportunities in the 'engaging' state (liked + followed, waiting for follow-back).
 */
export function getEngagingOpportunities(): Opportunity[] {
  const state = loadOpportunityState();
  return state.items
    .filter((o) => o.status === 'engaging')
    .sort((a, b) => (b.engageStartedAt ?? '').localeCompare(a.engageStartedAt ?? ''));
}

/**
 * Retry replies for opportunities that have been in 'engaging' state long enough.
 * Called periodically (e.g., from a cron or manual trigger).
 *
 * @param minHours Minimum hours since engagement started before retrying (default 24)
 */
export function getEngagingReadyForRetry(minHours = 24): Opportunity[] {
  const state = loadOpportunityState();
  const cutoff = new Date(Date.now() - minHours * 3600_000).toISOString();

  return state.items.filter(
    (o) => o.status === 'engaging' && o.engageStartedAt && o.engageStartedAt < cutoff,
  );
}

/**
 * Mark a quote-tweeted opportunity with its quote tweet URL.
 */
export function markOpportunityQuoteTweeted(id: string, replyText: string, quoteTweetUrl: string): void {
  const state = loadOpportunityState();
  const opp = state.items.find((o) => o.id === id);
  if (!opp) return;

  opp.status = 'replied';
  opp.suggestedReply = replyText;
  opp.repliedAt = new Date().toISOString();
  opp.quoteTweetUrl = quoteTweetUrl;

  // Record engagement in learning state
  state.learning.topicEngagements[opp.topicId] = (state.learning.topicEngagements[opp.topicId] ?? 0) + 1;
  state.learning.authorEngagements[opp.author] = (state.learning.authorEngagements[opp.author] ?? 0) + 1;

  saveOpportunityState(state);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Best-effort author extraction from URL and title.
 * Search results don't always include the author, so we parse from URL patterns.
 */
function extractAuthor(url: string, title: string): string {
  // X/Twitter: https://x.com/username/status/...
  const xMatch = url.match(/x\.com\/([^/]+)\/status/);
  if (xMatch) return `@${xMatch[1]}`;

  // Reddit: title often has "u/username" or "/r/subreddit"
  const redditUserMatch = url.match(/reddit\.com\/(?:user|u)\/([^/]+)/);
  if (redditUserMatch) return `u/${redditUserMatch[1]}`;

  // Reddit post URL: /r/subreddit/comments/id/title/
  const redditPostMatch = url.match(/reddit\.com\/r\/([^/]+)/);
  if (redditPostMatch) return `r/${redditPostMatch[1]}`;

  // LinkedIn: linkedin.com/in/username or /posts/
  const linkedinMatch = url.match(/linkedin\.com\/in\/([^/]+)/);
  if (linkedinMatch) return linkedinMatch[1];

  // HN: no reliable author from URL
  // Product Hunt: no reliable author from URL

  // Fallback: use domain or 'unknown'
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return hostname;
  } catch {
    return 'unknown';
  }
}
