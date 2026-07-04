/**
 * Adaptive Content Mix — closes the learning loop.
 *
 * After 2 weeks of data, automatically adjusts content category weights based
 * on actual engagement. Categories that perform well get more posts.
 * Categories that underperform get fewer. Personalized per client.
 */

import { loadState, saveState } from '../core/state.js';
import { getInsights } from './learning-engine.js';
import { getCategoriesForNiche, type ContentCategory } from './niche-categories.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CategoryWeight {
  categoryId: string;
  weight: number;          // 0-1, all weights sum to 1
  reason: string;
  performance?: {
    avgEngagement: number;
    postCount: number;
    approvalRate: number;
  };
}

interface AdaptiveMixState {
  weights: Record<string, number>;         // categoryId → weight
  history: Array<{
    date: string;
    weights: Record<string, number>;
    reason: string;
  }>;
  min_data_threshold_met: boolean;
  last_adaptation: string;
}

const DEFAULT_STATE: AdaptiveMixState = {
  weights: {},
  history: [],
  min_data_threshold_met: false,
  last_adaptation: '',
};

const MIN_POSTS_FOR_ADAPTATION = 14; // ~2 weeks of daily posting

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Get the current content mix weights for a niche.
 * Returns equal weights if not enough data, personalized weights if enough data.
 */
export function getContentMix(niche: string): CategoryWeight[] {
  const categories = getCategoriesForNiche(niche);
  const state = loadState<AdaptiveMixState>('adaptive-mix', DEFAULT_STATE);

  // If we have adapted weights, use them
  if (state.min_data_threshold_met && Object.keys(state.weights).length > 0) {
    return categories.map(cat => ({
      categoryId: cat.id,
      weight: state.weights[cat.id] || (1 / categories.length),
      reason: state.weights[cat.id] ? 'performance-based' : 'default (no data)',
    }));
  }

  // Default: equal weights
  const equalWeight = 1 / categories.length;
  return categories.map(cat => ({
    categoryId: cat.id,
    weight: equalWeight,
    reason: 'equal (not enough data yet)',
  }));
}

/**
 * Pick the next content category based on weighted random selection.
 * Higher-weight categories are picked more often.
 */
export function pickNextCategory(niche: string): ContentCategory | null {
  const categories = getCategoriesForNiche(niche);
  const mix = getContentMix(niche);

  if (categories.length === 0) return null;

  // Weighted random selection
  const totalWeight = mix.reduce((sum, m) => sum + m.weight, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < mix.length; i++) {
    random -= mix[i].weight;
    if (random <= 0) {
      return categories.find(c => c.id === mix[i].categoryId) || categories[0];
    }
  }

  return categories[0];
}

/**
 * Adapt the content mix based on performance data.
 * Called weekly (or manually). Reads from the learning engine and adjusts weights.
 */
export function adaptContentMix(niche: string): { adapted: boolean; changes: string[] } {
  const categories = getCategoriesForNiche(niche);
  const state = loadState<AdaptiveMixState>('adaptive-mix', DEFAULT_STATE);
  const insights = getInsights();
  const changes: string[] = [];

  // Check if we have enough data — derive from topCategories
  const catPerf: Record<string, { count: number; avgEngagement: number; approvalRate: number }> = {};
  for (const cat of insights.topCategories || []) {
    catPerf[cat.category] = { count: cat.count, avgEngagement: cat.avgScore, approvalRate: 0.5 };
  }
  const totalPosts = Object.values(catPerf).reduce(
    (sum, cat) => sum + (cat.count || 0), 0
  );

  if (totalPosts < MIN_POSTS_FOR_ADAPTATION) {
    return { adapted: false, changes: [`Need ${MIN_POSTS_FOR_ADAPTATION - totalPosts} more posts before adapting`] };
  }

  state.min_data_threshold_met = true;

  // Calculate performance scores per category
  const scores: Record<string, number> = {};
  let totalScore = 0;

  for (const cat of categories) {
    const perf = catPerf[cat.id] || catPerf[cat.name];
    if (perf && perf.count > 0) {
      // Score = engagement * approval rate (both matter)
      const engScore = perf.avgEngagement || 0;
      const approvalScore = (perf.approvalRate || 0.5) * 100;
      scores[cat.id] = (engScore * 0.6) + (approvalScore * 0.4);
    } else {
      // No data — give average weight to encourage exploration
      scores[cat.id] = 50;
    }
    totalScore += scores[cat.id];
  }

  // Normalize to weights (0-1, sum to 1)
  const newWeights: Record<string, number> = {};
  const oldWeights = { ...state.weights };

  for (const cat of categories) {
    const rawWeight = totalScore > 0 ? scores[cat.id] / totalScore : 1 / categories.length;

    // Clamp: no category below 5% or above 40% (ensures diversity)
    const clamped = Math.max(0.05, Math.min(0.40, rawWeight));
    newWeights[cat.id] = Math.round(clamped * 1000) / 1000;

    // Track changes
    const oldWeight = oldWeights[cat.id] || (1 / categories.length);
    const delta = newWeights[cat.id] - oldWeight;
    if (Math.abs(delta) > 0.03) {
      const direction = delta > 0 ? '↑' : '↓';
      changes.push(`${cat.name}: ${direction} ${Math.abs(Math.round(delta * 100))}% (engagement: ${Math.round(scores[cat.id])})`);
    }
  }

  // Re-normalize after clamping
  const sum = Object.values(newWeights).reduce((s, w) => s + w, 0);
  for (const id of Object.keys(newWeights)) {
    newWeights[id] = Math.round((newWeights[id] / sum) * 1000) / 1000;
  }

  // Save
  state.weights = newWeights;
  state.history.push({
    date: new Date().toISOString(),
    weights: { ...newWeights },
    reason: changes.length > 0 ? changes.join('; ') : 'No significant changes',
  });
  if (state.history.length > 52) state.history = state.history.slice(-52);
  state.last_adaptation = new Date().toISOString();
  saveState('adaptive-mix', state);

  return { adapted: true, changes };
}

/**
 * Get the current mix state for display/debugging.
 */
export function getAdaptiveMixState(): AdaptiveMixState {
  return loadState<AdaptiveMixState>('adaptive-mix', DEFAULT_STATE);
}

/**
 * Reset the adaptive mix (e.g., after a niche pivot).
 */
export function resetAdaptiveMix(): void {
  saveState('adaptive-mix', DEFAULT_STATE);
}
