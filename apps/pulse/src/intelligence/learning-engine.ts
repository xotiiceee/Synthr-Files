/**
 * Feedback & learning system — tracks engagement, analyzes patterns,
 * and adapts future content generation based on what actually works.
 *
 * Learns from:
 * - Post engagement metrics (likes, replies, reposts after 24h)
 * - Category performance (which topics resonate)
 * - Format performance (hot take vs thread vs question etc.)
 * - Time-of-day posting windows
 * - Voice drift (user edits diverging from generated content)
 * - Rejections (content the user chose not to post)
 *
 * State persisted to data/learning.json via state manager.
 */

import { loadState, saveState, getActions } from '../core/state.js';
import { askLLM } from '../core/llm.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PostPerformance {
  postId: string;
  platform: string;
  category: string;
  format: string;
  content: string;
  postedAt: string;
  engagement: { likes: number; replies: number; reposts: number };
  engagementScore: number; // normalized 0-100
}

export interface LearningInsights {
  topCategories: Array<{ category: string; avgScore: number; count: number }>;
  topFormats: Array<{ format: string; avgScore: number; count: number }>;
  bestHours: Array<{ hour: number; avgScore: number; count: number }>;
  worstPerformers: string[]; // content patterns that consistently underperform
  voiceDriftNotes: string[]; // patterns from user edits
  recommendedWeights: Record<string, number>; // suggested category weights
}

export interface WeeklyDigest {
  period: { start: string; end: string };
  totalPosts: number;
  avgEngagement: number;
  topPost: PostPerformance | null;
  insights: LearningInsights;
  recommendations: string[];
}

// ─── Internal State Shape ────────────────────────────────────────────────────

interface EditRecord {
  original: string;
  edited: string;
  category: string;
  timestamp: string;
}

interface RejectionRecord {
  content: string;
  category: string;
  reason?: string;
  timestamp: string;
}

interface LearningState {
  performances: PostPerformance[];
  edits: EditRecord[];
  rejections: RejectionRecord[];
  categoryScores: Record<string, number[]>;
  formatScores: Record<string, number[]>;
  hourScores: Record<number, number[]>;
}

const STATE_KEY = 'learning';

const MAX_PERFORMANCES = 200;
const MAX_EDITS = 100;
const MAX_REJECTIONS = 100;
const MAX_ROLLING_SCORES = 50; // per category/format/hour

const DEFAULT_STATE: LearningState = {
  performances: [],
  edits: [],
  rejections: [],
  categoryScores: {},
  formatScores: {},
  hourScores: {},
};

function load(): LearningState {
  return loadState<LearningState>(STATE_KEY, DEFAULT_STATE);
}

function save(state: LearningState): void {
  // Enforce size caps before persisting
  if (state.performances.length > MAX_PERFORMANCES) {
    state.performances = state.performances.slice(-MAX_PERFORMANCES);
  }
  if (state.edits.length > MAX_EDITS) {
    state.edits = state.edits.slice(-MAX_EDITS);
  }
  if (state.rejections.length > MAX_REJECTIONS) {
    state.rejections = state.rejections.slice(-MAX_REJECTIONS);
  }

  // Cap rolling score arrays
  for (const key of Object.keys(state.categoryScores)) {
    if (state.categoryScores[key].length > MAX_ROLLING_SCORES) {
      state.categoryScores[key] = state.categoryScores[key].slice(-MAX_ROLLING_SCORES);
    }
  }
  for (const key of Object.keys(state.formatScores)) {
    if (state.formatScores[key].length > MAX_ROLLING_SCORES) {
      state.formatScores[key] = state.formatScores[key].slice(-MAX_ROLLING_SCORES);
    }
  }
  for (const key of Object.keys(state.hourScores)) {
    if (state.hourScores[key as unknown as number].length > MAX_ROLLING_SCORES) {
      state.hourScores[key as unknown as number] = state.hourScores[key as unknown as number].slice(-MAX_ROLLING_SCORES);
    }
  }

  saveState(STATE_KEY, state);
}

// ─── Engagement Scoring ──────────────────────────────────────────────────────

/**
 * Calculate a normalized engagement score (0-100).
 * Weighted: replies (3x) and reposts (5x) indicate deeper engagement than likes (1x).
 */
export function calculateEngagementScore(
  engagement: { likes: number; replies: number; reposts: number }
): number {
  return Math.min(100, engagement.likes * 1 + engagement.replies * 3 + engagement.reposts * 5);
}

// ─── Recording Functions ─────────────────────────────────────────────────────

/**
 * Record engagement for a post. Called ~24h after posting when metrics are fetched.
 * Stores the performance record and updates rolling category/format/hour scores.
 */
export function recordEngagement(
  postId: string,
  platform: string,
  engagement: { likes: number; replies: number; reposts: number }
): void {
  const state = load();
  const score = calculateEngagementScore(engagement);

  // Find matching action from action log to get metadata
  const actions = getActions();
  const action = actions.find((a) => a.id === postId);

  const category = action?.topicId ?? 'unknown';
  const format = action?.type ?? 'post';
  const content = action?.content ?? '';
  const postedAt = action?.timestamp ?? new Date().toISOString();
  const hour = new Date(postedAt).getUTCHours();

  const perf: PostPerformance = {
    postId,
    platform,
    category,
    format,
    content,
    postedAt,
    engagement,
    engagementScore: score,
  };

  state.performances.push(perf);

  // Update rolling scores
  if (!state.categoryScores[category]) state.categoryScores[category] = [];
  state.categoryScores[category].push(score);

  if (!state.formatScores[format]) state.formatScores[format] = [];
  state.formatScores[format].push(score);

  if (!state.hourScores[hour]) state.hourScores[hour] = [];
  state.hourScores[hour].push(score);

  save(state);
}

/**
 * Record that a user edited a draft before posting.
 * Tracks the before/after so we can learn voice drift patterns.
 */
export function recordEdit(original: string, edited: string, category: string): void {
  const state = load();
  state.edits.push({
    original,
    edited,
    category,
    timestamp: new Date().toISOString(),
  });
  save(state);
}

/**
 * Record that a user rejected (chose not to post) generated content.
 * Helps the system learn what NOT to generate.
 */
export function recordRejection(content: string, category: string, reason?: string): void {
  const state = load();
  state.rejections.push({
    content,
    category,
    reason,
    timestamp: new Date().toISOString(),
  });
  save(state);
}

// ─── Analysis Helpers ────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Detect voice drift patterns by analyzing edit history.
 * Returns human-readable notes about how the user consistently modifies content.
 */
function analyzeVoiceDrift(edits: EditRecord[]): string[] {
  if (edits.length < 3) return [];

  const notes: string[] = [];

  // Track length changes
  let shorterCount = 0;
  let longerCount = 0;
  for (const edit of edits) {
    if (edit.edited.length < edit.original.length * 0.85) shorterCount++;
    if (edit.edited.length > edit.original.length * 1.15) longerCount++;
  }

  if (shorterCount > edits.length * 0.5) {
    notes.push('User consistently shortens generated content — generate more concise drafts');
  }
  if (longerCount > edits.length * 0.5) {
    notes.push('User consistently expands generated content — generate longer, more detailed drafts');
  }

  // Track emoji removal/addition
  const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  let emojiRemoved = 0;
  let emojiAdded = 0;
  for (const edit of edits) {
    const origEmojis = (edit.original.match(emojiPattern) ?? []).length;
    const editedEmojis = (edit.edited.match(emojiPattern) ?? []).length;
    if (editedEmojis < origEmojis) emojiRemoved++;
    if (editedEmojis > origEmojis) emojiAdded++;
  }

  if (emojiRemoved > edits.length * 0.4) {
    notes.push('User frequently removes emojis — reduce emoji usage in generation');
  }
  if (emojiAdded > edits.length * 0.4) {
    notes.push('User frequently adds emojis — include more emojis in generation');
  }

  // Track exclamation mark removal
  let exclamationRemoved = 0;
  for (const edit of edits) {
    const origExcl = (edit.original.match(/!/g) ?? []).length;
    const editedExcl = (edit.edited.match(/!/g) ?? []).length;
    if (editedExcl < origExcl) exclamationRemoved++;
  }
  if (exclamationRemoved > edits.length * 0.4) {
    notes.push('User frequently tones down exclamation marks — use a calmer tone');
  }

  // Track hashtag patterns
  let hashtagRemoved = 0;
  for (const edit of edits) {
    const origTags = (edit.original.match(/#\w+/g) ?? []).length;
    const editedTags = (edit.edited.match(/#\w+/g) ?? []).length;
    if (editedTags < origTags) hashtagRemoved++;
  }
  if (hashtagRemoved > edits.length * 0.4) {
    notes.push('User frequently removes hashtags — reduce or eliminate hashtags');
  }

  // Track capitalization changes (ALL CAPS removal)
  let capsRemoved = 0;
  for (const edit of edits) {
    const origCaps = (edit.original.match(/\b[A-Z]{3,}\b/g) ?? []).length;
    const editedCaps = (edit.edited.match(/\b[A-Z]{3,}\b/g) ?? []).length;
    if (editedCaps < origCaps) capsRemoved++;
  }
  if (capsRemoved > edits.length * 0.3) {
    notes.push('User frequently removes ALL CAPS words — avoid uppercase emphasis');
  }

  return notes;
}

/**
 * Identify content patterns that consistently underperform.
 * Looks at both low-scoring posts and rejected content.
 */
function findWorstPerformers(state: LearningState): string[] {
  const patterns: string[] = [];

  // Categories with consistently low scores
  for (const [category, scores] of Object.entries(state.categoryScores)) {
    if (scores.length >= 5 && avg(scores) < 5) {
      patterns.push(`Category "${category}" averages only ${round2(avg(scores))} engagement`);
    }
  }

  // Formats with consistently low scores
  for (const [format, scores] of Object.entries(state.formatScores)) {
    if (scores.length >= 5 && avg(scores) < 5) {
      patterns.push(`Format "${format}" averages only ${round2(avg(scores))} engagement`);
    }
  }

  // Frequently rejected categories
  const rejectionCounts: Record<string, number> = {};
  for (const rej of state.rejections) {
    rejectionCounts[rej.category] = (rejectionCounts[rej.category] ?? 0) + 1;
  }
  for (const [category, count] of Object.entries(rejectionCounts)) {
    if (count >= 3) {
      patterns.push(`Category "${category}" rejected ${count} times`);
    }
  }

  return patterns;
}

// ─── Public Analysis Functions ───────────────────────────────────────────────

/**
 * Analyze accumulated engagement data and return structured insights.
 */
export function getInsights(): LearningInsights {
  const state = load();

  // Category performance — sorted by avg score descending
  const topCategories = Object.entries(state.categoryScores)
    .map(([category, scores]) => ({
      category,
      avgScore: round2(avg(scores)),
      count: scores.length,
    }))
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.avgScore - a.avgScore);

  // Format performance — sorted by avg score descending
  const topFormats = Object.entries(state.formatScores)
    .map(([format, scores]) => ({
      format,
      avgScore: round2(avg(scores)),
      count: scores.length,
    }))
    .filter((f) => f.count >= 2)
    .sort((a, b) => b.avgScore - a.avgScore);

  // Hour performance — sorted by avg score descending
  const bestHours = Object.entries(state.hourScores)
    .map(([hour, scores]) => ({
      hour: parseInt(hour, 10),
      avgScore: round2(avg(scores)),
      count: scores.length,
    }))
    .filter((h) => h.count >= 2)
    .sort((a, b) => b.avgScore - a.avgScore);

  const worstPerformers = findWorstPerformers(state);
  const voiceDriftNotes = analyzeVoiceDrift(state.edits);

  // Recommended category weights: normalize scores into a 0-1 weight distribution
  const recommendedWeights = computeCategoryWeights(state.categoryScores);

  return {
    topCategories,
    topFormats,
    bestHours,
    worstPerformers,
    voiceDriftNotes,
    recommendedWeights,
  };
}

/**
 * Compute recommended category weights from rolling scores.
 * Higher-performing categories get proportionally more weight.
 * Minimum weight of 0.05 so no category is entirely starved.
 */
function computeCategoryWeights(categoryScores: Record<string, number[]>): Record<string, number> {
  const entries = Object.entries(categoryScores);
  if (entries.length === 0) return {};

  // Calculate avg scores per category
  const avgs: Record<string, number> = {};
  let totalAvg = 0;
  for (const [cat, scores] of entries) {
    if (scores.length < 2) continue;
    const a = avg(scores);
    avgs[cat] = Math.max(a, 1); // floor at 1 so zero-performers still get minimal weight
    totalAvg += avgs[cat];
  }

  if (totalAvg === 0) return {};

  // Normalize to sum to 1.0, with minimum floor
  const weights: Record<string, number> = {};
  const catCount = Object.keys(avgs).length;
  const minWeight = 0.05;
  const reservedWeight = minWeight * catCount;
  const distributableWeight = Math.max(0, 1 - reservedWeight);

  for (const [cat, a] of Object.entries(avgs)) {
    const proportional = totalAvg > 0 ? (a / totalAvg) * distributableWeight : 0;
    weights[cat] = round2(minWeight + proportional);
  }

  return weights;
}

/**
 * Convenience: get just the recommended category weights.
 */
export function getRecommendedCategoryWeights(): Record<string, number> {
  return getInsights().recommendedWeights;
}

/**
 * Convenience: get the top posting hours (UTC) sorted by performance.
 * Returns the top 5 hours, or fewer if not enough data.
 */
export function getRecommendedPostingHours(): number[] {
  const insights = getInsights();
  return insights.bestHours.slice(0, 5).map((h) => h.hour);
}

// ─── Weekly Digest ───────────────────────────────────────────────────────────

/**
 * Generate a comprehensive weekly digest with LLM-powered recommendations.
 * Covers the last 7 days of recorded performances.
 */
export async function generateWeeklyDigest(): Promise<WeeklyDigest> {
  const state = load();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const weekAgoISO = weekAgo.toISOString();

  const period = {
    start: weekAgo.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  };

  // Filter performances to this week
  const weekPerfs = state.performances.filter((p) => p.postedAt >= weekAgoISO);

  const totalPosts = weekPerfs.length;
  const avgEngagement = totalPosts > 0
    ? round2(weekPerfs.reduce((sum, p) => sum + p.engagementScore, 0) / totalPosts)
    : 0;

  // Find top post
  const topPost = weekPerfs.length > 0
    ? weekPerfs.reduce((best, p) => p.engagementScore > best.engagementScore ? p : best)
    : null;

  const insights = getInsights();

  // Count this week's edits and rejections
  const weekEdits = state.edits.filter((e) => e.timestamp >= weekAgoISO).length;
  const weekRejections = state.rejections.filter((r) => r.timestamp >= weekAgoISO).length;

  // Build LLM prompt for recommendations
  const recommendations = await generateRecommendations(
    weekPerfs,
    insights,
    weekEdits,
    weekRejections,
    period
  );

  return {
    period,
    totalPosts,
    avgEngagement,
    topPost,
    insights,
    recommendations,
  };
}

/**
 * Use the LLM to generate actionable recommendations from learning data.
 * Falls back to rule-based recommendations if LLM is unavailable.
 */
async function generateRecommendations(
  weekPerfs: PostPerformance[],
  insights: LearningInsights,
  weekEdits: number,
  weekRejections: number,
  period: { start: string; end: string }
): Promise<string[]> {
  // Build context for LLM
  const topCats = insights.topCategories.slice(0, 5)
    .map((c) => `"${c.category}": avg ${c.avgScore}, ${c.count} posts`)
    .join('\n  ');

  const topFmts = insights.topFormats.slice(0, 5)
    .map((f) => `"${f.format}": avg ${f.avgScore}, ${f.count} posts`)
    .join('\n  ');

  const bestHrs = insights.bestHours.slice(0, 5)
    .map((h) => `${h.hour}:00 UTC: avg ${h.avgScore}, ${h.count} posts`)
    .join('\n  ');

  const driftNotes = insights.voiceDriftNotes.length > 0
    ? insights.voiceDriftNotes.join('\n  ')
    : 'No significant drift detected';

  const worstPatterns = insights.worstPerformers.length > 0
    ? insights.worstPerformers.join('\n  ')
    : 'No consistent underperformers yet';

  const prompt = `You are a social media performance analyst reviewing a week of content data. Generate 5 specific, actionable recommendations.

PERIOD: ${period.start} to ${period.end}
TOTAL POSTS: ${weekPerfs.length}
AVG ENGAGEMENT SCORE: ${weekPerfs.length > 0 ? round2(weekPerfs.reduce((s, p) => s + p.engagementScore, 0) / weekPerfs.length) : 0}/100
USER EDITS THIS WEEK: ${weekEdits}
REJECTIONS THIS WEEK: ${weekRejections}

TOP CATEGORIES (by engagement):
  ${topCats || 'Not enough data'}

TOP FORMATS:
  ${topFmts || 'Not enough data'}

BEST POSTING HOURS (UTC):
  ${bestHrs || 'Not enough data'}

UNDERPERFORMERS:
  ${worstPatterns}

VOICE DRIFT (user edit patterns):
  ${driftNotes}

Return ONLY a JSON array of 5 recommendation strings. Be specific and reference the data. No markdown fences.
Example: ["Double down on educational posts — they avg 42 engagement vs 12 for promotional", "Shift posting to 14:00-16:00 UTC window where engagement peaks", ...]`;

  const raw = await askLLM(prompt, { maxTokens: 800, temperature: 0.5 });

  if (raw) {
    try {
      let jsonStr = raw.trim();
      // Strip markdown fences if present
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(String).slice(0, 7);
      }
    } catch {
      console.log('  [Learning] Failed to parse LLM recommendations — using rule-based');
    }
  }

  // Fallback: rule-based recommendations
  return generateRuleBasedRecommendations(insights, weekPerfs.length, weekEdits, weekRejections);
}

/**
 * Generate recommendations purely from statistical patterns (no LLM needed).
 */
function generateRuleBasedRecommendations(
  insights: LearningInsights,
  postCount: number,
  editCount: number,
  rejectionCount: number
): string[] {
  const recs: string[] = [];

  // Data volume recommendation
  if (postCount < 5) {
    recs.push('Post more consistently — need at least 5 posts/week for meaningful learning');
  }

  // Top category recommendation
  if (insights.topCategories.length > 0) {
    const best = insights.topCategories[0];
    recs.push(
      `Focus on "${best.category}" content — it averages ${best.avgScore} engagement across ${best.count} posts`
    );
  }

  // Worst category recommendation
  if (insights.worstPerformers.length > 0) {
    recs.push(`Consider reducing: ${insights.worstPerformers[0]}`);
  }

  // Format recommendation
  if (insights.topFormats.length > 0) {
    const bestFmt = insights.topFormats[0];
    recs.push(
      `"${bestFmt.format}" format performs best (avg ${bestFmt.avgScore}) — use it more often`
    );
  }

  // Timing recommendation
  if (insights.bestHours.length > 0) {
    const bestHour = insights.bestHours[0];
    recs.push(
      `Best posting window: ${bestHour.hour}:00 UTC (avg engagement ${bestHour.avgScore})`
    );
  }

  // Voice drift recommendation
  if (insights.voiceDriftNotes.length > 0) {
    recs.push(`Voice adjustment: ${insights.voiceDriftNotes[0]}`);
  }

  // Edit/rejection rate
  if (postCount > 0) {
    const rejectionRate = rejectionCount / (postCount + rejectionCount);
    if (rejectionRate > 0.3) {
      recs.push(
        `High rejection rate (${Math.round(rejectionRate * 100)}%) — content generation may need persona tuning`
      );
    }
  }
  if (editCount > postCount * 0.7 && postCount > 3) {
    recs.push(
      'Most posts are being edited before publishing — review persona voice settings for better first drafts'
    );
  }

  return recs.length > 0 ? recs : ['Keep posting to build a learning baseline — need more data for actionable insights'];
}
