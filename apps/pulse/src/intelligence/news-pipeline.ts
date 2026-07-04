/**
 * News / trend discovery pipeline for auto-posting.
 * Finds newsworthy content in the brand's niche for the auto-posting
 * feature to comment on — searches recent articles, monitors watched
 * X accounts, detects emerging trends, and scores relevance via LLM.
 */

import { askLLM } from '../core/llm.js';
import { getConfig } from '../core/persona.js';
import { search, searchPlatform } from '../core/search.js';
import { loadState, saveState, generateId } from '../core/state.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: 'rss' | 'watched_account' | 'trend' | 'search';
  relevanceScore: number; // 0-1
  freshnessHours: number; // how old
  discoveredAt: string;
}

export interface TrendItem {
  topic: string;
  velocity: 'emerging' | 'peaking' | 'fading';
  relevanceScore: number;
  sources: string[]; // URLs that discuss this topic
}

interface NewsPipelineState {
  usedItemIds: string[];
  lastScanAt: string;
  trendCache: TrendItem[];
}

const STATE_KEY = 'news-pipeline';
const USED_IDS_CAP = 500;
const FRESHNESS_BREAKING_HOURS = 12;
const FRESHNESS_STALE_HOURS = 48;
const BATCH_SIZE = 10; // score up to 10 items per LLM call

// ─── State helpers ───────────────────────────────────────────────────────────

function getState(): NewsPipelineState {
  return loadState<NewsPipelineState>(STATE_KEY, {
    usedItemIds: [],
    lastScanAt: '',
    trendCache: [],
  });
}

function persistState(state: NewsPipelineState): void {
  // Cap used IDs at 500 — keep most recent
  if (state.usedItemIds.length > USED_IDS_CAP) {
    state.usedItemIds = state.usedItemIds.slice(-USED_IDS_CAP);
  }
  saveState(STATE_KEY, state);
}

// ─── Freshness estimation ────────────────────────────────────────────────────

/**
 * Parse a date string into hours-ago. If the date is unparseable or missing,
 * estimate based on the search time filter — results from "last day" searches
 * are assumed to be ~12h old as a conservative fallback.
 */
function estimateFreshnessHours(dateStr?: string, fallbackHours: number = 12): number {
  if (!dateStr) return fallbackHours;

  // Serper returns dates like "3 hours ago", "2 days ago", "Jan 15, 2026"
  const lower = dateStr.toLowerCase().trim();

  // Relative formats: "X hours ago", "X days ago", "X minutes ago"
  const relMatch = lower.match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/);
  if (relMatch) {
    const val = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    const multipliers: Record<string, number> = {
      minute: 1 / 60,
      hour: 1,
      day: 24,
      week: 168,
      month: 720,
    };
    return val * (multipliers[unit] ?? 24);
  }

  // Absolute date — try Date.parse
  const ts = Date.parse(dateStr);
  if (!isNaN(ts)) {
    const hoursAgo = (Date.now() - ts) / 3_600_000;
    return Math.max(0, hoursAgo);
  }

  return fallbackHours;
}

// ─── Dedup ───────────────────────────────────────────────────────────────────

/**
 * Simple title similarity — normalized lowercase, strip punctuation.
 * Returns true if titles are >80% similar by character overlap.
 */
function titlesAreSimilar(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.length === 0 || nb.length === 0) return false;

  // Check if one is a substring of the other
  if (na.includes(nb) || nb.includes(na)) return true;

  // Character bigram overlap
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let overlap = 0;
  for (const bg of ba) {
    if (bb.has(bg)) overlap++;
  }
  const similarity = (2 * overlap) / (ba.size + bb.size);
  return similarity > 0.8;
}

/**
 * Deduplicate items by URL and title similarity. Also removes items
 * that have already been used (present in state.usedItemIds).
 */
function dedup(items: NewsItem[], usedIds: string[]): NewsItem[] {
  const usedSet = new Set(usedIds);
  const seen = new Map<string, NewsItem>(); // url -> item
  const result: NewsItem[] = [];

  for (const item of items) {
    // Skip already-used items
    if (usedSet.has(item.id)) continue;

    // Skip duplicate URLs
    if (seen.has(item.url)) continue;

    // Skip similar titles
    let isDupTitle = false;
    for (const existing of seen.values()) {
      if (titlesAreSimilar(item.title, existing.title)) {
        isDupTitle = true;
        break;
      }
    }
    if (isDupTitle) continue;

    seen.set(item.url, item);
    result.push(item);
  }

  return result;
}

// ─── LLM batch relevance scoring ─────────────────────────────────────────────

/**
 * Score a batch of items for relevance in a single LLM call.
 * Returns scores keyed by item id (0-1). Items not in the response default to 0.
 */
async function scoreBatch(
  items: Array<{ id: string; title: string; snippet: string }>,
  niche: string,
  themes: string[],
  competitors: string[]
): Promise<Record<string, number>> {
  if (items.length === 0) return {};

  const itemList = items
    .map((it, i) => `${i + 1}. [${it.id}] "${it.title}" — ${it.snippet.slice(0, 150)}`)
    .join('\n');

  const prompt = `You are a relevance scorer for a brand in the "${niche}" space.
Content themes: ${themes.join(', ') || 'general industry news'}
Competitors to watch: ${competitors.join(', ') || 'none'}

Score each item below from 0.0 to 1.0 for relevance to this brand's audience.
- 0.9-1.0: Directly about our niche, breaking news, competitor moves
- 0.7-0.8: Strongly related, audience would care
- 0.4-0.6: Tangentially related
- 0.1-0.3: Weak connection
- 0.0: Completely irrelevant

Items:
${itemList}

Return ONLY a JSON object mapping each item ID to its score. No markdown fences.
Example: {"abc123": 0.85, "def456": 0.3}`;

  const response = await askLLM(prompt, { maxTokens: 400, temperature: 0.2 });
  if (!response) return {};

  try {
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as Record<string, number>;
    const scores: Record<string, number> = {};
    for (const [id, score] of Object.entries(parsed)) {
      const num = Number(score);
      if (!isNaN(num)) scores[id] = Math.max(0, Math.min(1, num));
    }
    return scores;
  } catch {
    console.log('  [NewsPipeline] Failed to parse relevance scores from LLM');
    return {};
  }
}

/**
 * Score all items in batches of BATCH_SIZE, then assign scores to items in-place.
 */
async function scoreAllItems(items: NewsItem[]): Promise<void> {
  const config = getConfig();
  const { niche } = config.persona;
  const { contentThemes, competitors } = config;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const scores = await scoreBatch(
      batch.map((it) => ({ id: it.id, title: it.title, snippet: it.snippet })),
      niche,
      contentThemes,
      competitors
    );

    for (const item of batch) {
      item.relevanceScore = scores[item.id] ?? 0;
    }
  }
}

// ─── Search query builders ───────────────────────────────────────────────────

function buildSearchQueries(keywords?: string[]): string[] {
  const config = getConfig();
  const { persona, contentThemes, competitors } = config;
  const queries: string[] = [];

  // Niche news
  queries.push(`${persona.niche} news latest`);

  // Content themes as queries
  for (const theme of contentThemes.slice(0, 3)) {
    queries.push(`${theme} news today`);
  }

  // Competitor news
  for (const comp of competitors.slice(0, 2)) {
    queries.push(`${comp} announcement OR update OR launch`);
  }

  // Custom keywords override
  if (keywords && keywords.length > 0) {
    for (const kw of keywords.slice(0, 3)) {
      queries.push(`${kw} latest news`);
    }
  }

  return queries;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Scan for recent news/articles relevant to the brand's niche.
 * Uses Google search via Serper with time filters for freshness.
 * Optional keywords override the default niche-based queries.
 */
export async function scanNews(keywords?: string[]): Promise<NewsItem[]> {
  const state = getState();
  const queries = buildSearchQueries(keywords);
  const items: NewsItem[] = [];

  for (const query of queries) {
    const results = await search(query, { num: 5, timeFilter: 'qdr:d' });

    for (const result of results) {
      const freshnessHours = estimateFreshnessHours(result.date);

      // Skip stale items
      if (freshnessHours > FRESHNESS_STALE_HOURS) continue;

      items.push({
        id: generateId(),
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        source: 'search',
        relevanceScore: 0, // scored later
        freshnessHours,
        discoveredAt: new Date().toISOString(),
      });
    }
  }

  // Dedup against previously used items and within this batch
  const unique = dedup(items, state.usedItemIds);

  // Score relevance via LLM in batches
  await scoreAllItems(unique);

  // Update state
  state.lastScanAt = new Date().toISOString();
  persistState(state);

  console.log(`  [NewsPipeline] scanNews: ${unique.length} items from ${queries.length} queries`);

  // Sort by relevance (desc), then freshness (asc = fresher first)
  return unique.sort((a, b) => {
    const scoreDiff = b.relevanceScore - a.relevanceScore;
    if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
    return a.freshnessHours - b.freshnessHours;
  });
}

/**
 * Check what specific watched X accounts are tweeting about.
 * Uses the competitors list + brand-relevant accounts found via search.
 * Returns items sourced from X/Twitter.
 */
export async function scanWatchedAccounts(): Promise<NewsItem[]> {
  const config = getConfig();
  const state = getState();
  const { competitors } = config;
  const { niche } = config.persona;

  if (competitors.length === 0) {
    console.log('  [NewsPipeline] No watched accounts (competitors) — skipping');
    return [];
  }

  const items: NewsItem[] = [];

  for (const account of competitors.slice(0, 5)) {
    // Search for recent tweets from/about this account
    const results = await searchPlatform('x.com', `${account} ${niche}`, {
      num: 5,
      timeFilter: 'qdr:d',
    });

    for (const result of results) {
      const freshnessHours = estimateFreshnessHours(result.date, 6);
      if (freshnessHours > FRESHNESS_STALE_HOURS) continue;

      items.push({
        id: generateId(),
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        source: 'watched_account',
        relevanceScore: 0,
        freshnessHours,
        discoveredAt: new Date().toISOString(),
      });
    }
  }

  const unique = dedup(items, state.usedItemIds);
  await scoreAllItems(unique);

  console.log(`  [NewsPipeline] scanWatchedAccounts: ${unique.length} items from ${competitors.length} accounts`);

  return unique.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Detect emerging topics/trends in the brand's niche by searching for
 * high-velocity conversations and asking the LLM to cluster them.
 */
export async function detectTrends(): Promise<TrendItem[]> {
  const config = getConfig();
  const state = getState();
  const { niche } = config.persona;
  const { contentThemes } = config;

  // Search for trending/viral content in the niche
  const trendQueries = [
    `${niche} trending today`,
    `${niche} viral OR breaking OR just announced`,
  ];

  // Add theme-specific trend queries
  for (const theme of contentThemes.slice(0, 2)) {
    trendQueries.push(`${theme} trending OR new OR update`);
  }

  const allResults: Array<{ title: string; snippet: string; url: string }> = [];

  for (const query of trendQueries) {
    const results = await search(query, { num: 5, timeFilter: 'qdr:d' });
    for (const r of results) {
      allResults.push({ title: r.title, snippet: r.snippet, url: r.url });
    }
  }

  if (allResults.length === 0) {
    console.log('  [NewsPipeline] No trend data found');
    return [];
  }

  // Ask LLM to identify trend clusters
  const itemSummaries = allResults
    .slice(0, 20)
    .map((r, i) => `${i + 1}. "${r.title}" — ${r.snippet.slice(0, 120)}`)
    .join('\n');

  const prompt = `You are a trend analyst for the "${niche}" industry.

Below are recent search results. Identify 3-5 emerging topics/trends.

Results:
${itemSummaries}

For each trend, return:
- "topic": short name (3-6 words)
- "velocity": "emerging" (just starting), "peaking" (high activity now), or "fading" (losing steam)
- "relevanceScore": 0.0-1.0 relevance to the ${niche} niche
- "sourceIndices": array of result numbers (1-based) that discuss this topic

Return ONLY a JSON array. No markdown fences.
Example: [{"topic":"AI agent frameworks","velocity":"emerging","relevanceScore":0.9,"sourceIndices":[1,3,5]}]`;

  const response = await askLLM(prompt, { maxTokens: 600, temperature: 0.3 });

  if (!response) {
    console.log('  [NewsPipeline] LLM unavailable for trend detection');
    return state.trendCache; // return cached trends as fallback
  }

  try {
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as Array<{
      topic: string;
      velocity: string;
      relevanceScore: number;
      sourceIndices?: number[];
    }>;

    if (!Array.isArray(parsed)) {
      console.log('  [NewsPipeline] LLM returned non-array for trends');
      return state.trendCache;
    }

    const validVelocities = new Set(['emerging', 'peaking', 'fading']);

    const trends: TrendItem[] = parsed
      .filter((t) => t.topic && t.relevanceScore != null)
      .map((t) => {
        const velocity = validVelocities.has(t.velocity)
          ? (t.velocity as TrendItem['velocity'])
          : 'emerging';

        // Map source indices back to URLs
        const sources = (t.sourceIndices ?? [])
          .filter((idx) => idx >= 1 && idx <= allResults.length)
          .map((idx) => allResults[idx - 1].url);

        return {
          topic: String(t.topic),
          velocity,
          relevanceScore: Math.max(0, Math.min(1, Number(t.relevanceScore))),
          sources,
        };
      });

    // Cache trends in state
    state.trendCache = trends;
    persistState(state);

    console.log(`  [NewsPipeline] detectTrends: ${trends.length} trends identified`);
    return trends;
  } catch {
    console.log('  [NewsPipeline] Failed to parse trend data from LLM');
    return state.trendCache;
  }
}

/**
 * Get the single best news item for the next commentary post.
 * Runs a full scan (news + watched accounts), filters by freshness and
 * relevance, and returns the top pick — or null if nothing is worth posting.
 */
export async function getBestNewsItem(): Promise<NewsItem | null> {
  const [newsItems, accountItems] = await Promise.all([
    scanNews(),
    scanWatchedAccounts(),
  ]);

  const all = [...newsItems, ...accountItems];

  if (all.length === 0) {
    console.log('  [NewsPipeline] No news items found');
    return null;
  }

  // Filter: must meet minimum relevance threshold
  const MIN_RELEVANCE = 0.4;
  const candidates = all.filter((item) => item.relevanceScore >= MIN_RELEVANCE);

  if (candidates.length === 0) {
    console.log('  [NewsPipeline] No items met relevance threshold (0.4)');
    return null;
  }

  // Composite score: relevance (70%) + freshness bonus (30%)
  // Freshness bonus: breaking (<12h) gets full 0.3, linear decay to 0 at 48h
  const scored = candidates.map((item) => {
    const freshnessBonus =
      item.freshnessHours <= FRESHNESS_BREAKING_HOURS
        ? 0.3
        : Math.max(0, 0.3 * (1 - (item.freshnessHours - FRESHNESS_BREAKING_HOURS) / (FRESHNESS_STALE_HOURS - FRESHNESS_BREAKING_HOURS)));

    const compositeScore = item.relevanceScore * 0.7 + freshnessBonus;
    return { item, compositeScore };
  });

  // Sort by composite score, pick the best
  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  const best = scored[0].item;

  console.log(`  [NewsPipeline] Best pick: "${best.title.slice(0, 60)}..." (relevance=${best.relevanceScore}, freshness=${best.freshnessHours.toFixed(1)}h)`);
  return best;
}

/**
 * Mark a news item as used so it won't be surfaced again.
 * Also deduplicates the URL from future scans.
 */
export async function markNewsUsed(id: string): Promise<void> {
  const state = getState();

  if (!state.usedItemIds.includes(id)) {
    state.usedItemIds.push(id);
  }

  persistState(state);
  console.log(`  [NewsPipeline] Marked item ${id} as used (${state.usedItemIds.length} total)`);
}
