/**
 * High-Performing Content Recycler — identifies old posts that performed
 * well and suggests re-posting or remixing them. Most audiences only see
 * 5-10% of posts, so recycling high performers is effective.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';
import { getActions, type ActionRecord } from '../core/state.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RecycleCandidate {
  id: string;
  originalContent: string;
  platform: string;
  engagementScore: number;
  originalDate: string;
  daysSincePosted: number;
  recycleStrategy: 'repost' | 'remix' | 'thread-expand' | 'cross-platform';
  remixedContent?: string;    // LLM-generated new version
  reason: string;             // "High engagement (8.5/10), posted 45 days ago"
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calculate an engagement score (0-10) from an action's engagement data.
 * Weights: likes x1, replies x3 (conversations are king), reposts x2.
 */
function scoreEngagement(action: ActionRecord): number {
  if (!action.engagement) return 0;
  const { likes = 0, replies = 0, reposts = 0 } = action.engagement;
  const raw = likes * 1 + replies * 3 + reposts * 2;
  // Normalize: 0-50 raw → 0-10 score (logarithmic so early engagement counts more)
  if (raw === 0) return 0;
  return Math.min(10, Math.round(Math.log2(raw + 1) * 1.8 * 10) / 10);
}

function daysBetween(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / 86400_000);
}

function determineStrategy(
  action: ActionRecord,
  daysSince: number,
  enabledPlatforms: string[]
): 'repost' | 'remix' | 'thread-expand' | 'cross-platform' {
  // Cross-platform: if there are enabled platforms the content wasn't posted on
  const otherPlatforms = enabledPlatforms.filter((p) => p !== action.platform);
  if (otherPlatforms.length > 0) return 'cross-platform';

  // Verbatim repost after 2 months — audience has rotated
  if (daysSince > 60) return 'repost';

  // Thread expansion for high-engagement short posts
  if (action.type === 'reply' || action.content.length < 200) return 'thread-expand';

  // Default: remix with a new angle
  return 'remix';
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Scan action history for high-performing content worth recycling.
 * Returns top 10 candidates sorted by engagement score (descending).
 */
export async function findRecycleCandidates(
  minDaysOld: number = 30,
  minEngagement: number = 5.0
): Promise<RecycleCandidate[]> {
  const config = getConfig();
  const enabledPlatforms = Object.entries(config.platforms)
    .filter(([, s]) => s.enabled)
    .map(([name]) => name);

  const actions = getActions();
  if (actions.length === 0) {
    console.log('  [Recycler] No action history — nothing to recycle');
    return [];
  }

  // Filter to qualifying posts
  const qualifying = actions
    .filter((a) => a.type === 'post' || a.type === 'reply' || a.type === 'comment')
    .filter((a) => a.content && a.content.length > 20)
    .map((a) => ({
      action: a,
      score: scoreEngagement(a),
      daysSince: daysBetween(a.timestamp),
    }))
    .filter((item) => item.score >= minEngagement && item.daysSince >= minDaysOld)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (qualifying.length === 0) {
    console.log(`  [Recycler] No posts meet criteria (min ${minEngagement} engagement, ${minDaysOld}+ days old)`);
    return [];
  }

  const candidates: RecycleCandidate[] = [];

  for (const { action, score, daysSince } of qualifying) {
    const strategy = determineStrategy(action, daysSince, enabledPlatforms);

    const candidate: RecycleCandidate = {
      id: action.id,
      originalContent: action.content,
      platform: action.platform,
      engagementScore: score,
      originalDate: action.timestamp,
      daysSincePosted: daysSince,
      recycleStrategy: strategy,
      reason: `Engagement ${score}/10, posted ${daysSince} days ago`,
    };

    // Generate remixed content for strategies that need it
    if (strategy === 'remix' || strategy === 'thread-expand') {
      const remixed = await generateRemix(action, strategy);
      if (remixed) candidate.remixedContent = remixed;
    } else if (strategy === 'cross-platform') {
      // Adapt for a different platform
      const targetPlatform = enabledPlatforms.find((p) => p !== action.platform) ?? action.platform;
      const adapted = await adaptForPlatform(action, targetPlatform);
      if (adapted) candidate.remixedContent = adapted;
    }

    candidates.push(candidate);
  }

  console.log(`  [Recycler] Found ${candidates.length} recycle candidates`);
  return candidates;
}

/**
 * Get a ready-to-post recycle schedule — top N candidates with a mix
 * of strategies for variety.
 */
export function getRecycleSchedule(count: number = 5): Promise<RecycleCandidate[]> {
  return findRecycleCandidates().then((candidates) => {
    if (candidates.length === 0) return [];

    // Mix strategies: prioritize remix/cross-platform over verbatim reposts
    const strategyOrder: RecycleCandidate['recycleStrategy'][] = [
      'remix',
      'cross-platform',
      'thread-expand',
      'repost',
    ];

    const scheduled: RecycleCandidate[] = [];
    const used = new Set<string>();

    for (const strategy of strategyOrder) {
      if (scheduled.length >= count) break;
      for (const candidate of candidates) {
        if (scheduled.length >= count) break;
        if (used.has(candidate.id)) continue;
        if (candidate.recycleStrategy === strategy) {
          scheduled.push(candidate);
          used.add(candidate.id);
        }
      }
    }

    // Fill remaining slots with highest-scoring unused candidates
    for (const candidate of candidates) {
      if (scheduled.length >= count) break;
      if (!used.has(candidate.id)) {
        scheduled.push(candidate);
        used.add(candidate.id);
      }
    }

    return scheduled;
  });
}

// ─── LLM Helpers ─────────────────────────────────────────────────────────────

async function generateRemix(
  action: ActionRecord,
  strategy: 'remix' | 'thread-expand'
): Promise<string | null> {
  const personaPrompt = getPersonaPrompt();

  let instruction: string;
  if (strategy === 'thread-expand') {
    instruction = `Turn this into a short thread (3-4 tweets). Format as:
1/ [first tweet]
2/ [second tweet]
3/ [third tweet]
Each tweet must be under 280 characters. Expand on the idea with examples or a story.`;
  } else {
    instruction = `Remix this post with a fresh angle. Same core idea, different framing — maybe a question, a hot take, or a personal anecdote. Keep the same platform constraints (${action.platform === 'x' ? 'under 280 chars' : 'under 500 chars'}).`;
  }

  const prompt = `${personaPrompt}

Here's a post that performed well on ${action.platform}:
"${action.content}"

${instruction}

Do NOT wrap in quotes. Write the content directly.`;

  const maxTokens = strategy === 'thread-expand' ? 400 : 200;
  const response = await askLLM(prompt, { maxTokens, temperature: 0.8 });

  if (!response) return null;

  let result = response.trim();
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1);
  }
  return result;
}

async function adaptForPlatform(
  action: ActionRecord,
  targetPlatform: string
): Promise<string | null> {
  const personaPrompt = getPersonaPrompt();

  const platformGuides: Record<string, string> = {
    x: 'X (Twitter): Under 280 characters. Punchy, direct, conversational.',
    reddit: 'Reddit: 2-4 sentences. Informative, no marketing speak. Add context.',
    hackernews: 'Hacker News: Technical, substantive. Lead with insight, not opinion.',
    linkedin: 'LinkedIn: Professional but personable. 2-3 short paragraphs.',
    discord: 'Discord: Casual, brief. Like talking to a friend.',
  };

  const guide = platformGuides[targetPlatform] ?? platformGuides['x'];

  const prompt = `${personaPrompt}

Adapt this post (originally on ${action.platform}) for ${targetPlatform}:
"${action.content}"

${guide}

Do NOT wrap in quotes. Write the content directly.`;

  const response = await askLLM(prompt, { maxTokens: 250, temperature: 0.75 });

  if (!response) return null;

  let result = response.trim();
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1);
  }
  return result;
}
