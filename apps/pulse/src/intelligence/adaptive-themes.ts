/**
 * Adaptive Content Themes — auto-expand from engagement data.
 *
 * Analyzes which content themes drive the most engagement,
 * generates new theme variations from top performers via LLM,
 * and deprioritizes underperformers. Themes are no longer
 * locked to setup — they evolve with audience feedback.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, saveConfig } from '../core/persona.js';
import { loadState, saveState } from '../core/state.js';
import { getThemePerformance, type ThemeStats } from '../analytics/tracker.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ThemeAdaptationResult {
  timestamp: string;
  themesAnalyzed: number;
  topPerformers: string[];
  underPerformers: string[];
  newThemes: string[];
  retiredThemes: string[];
  summary: string;
}

interface ThemeAdaptationState {
  lastAdaptedAt: string;
  retiredThemes: string[];
  addedThemes: Array<{ theme: string; reason: string; addedAt: string }>;
  history: Array<{
    date: string;
    added: string[];
    retired: string[];
    reason: string;
  }>;
}

const DEFAULT_STATE: ThemeAdaptationState = {
  lastAdaptedAt: '',
  retiredThemes: [],
  addedThemes: [],
  history: [],
};

const MIN_POSTS_FOR_ADAPTATION = 10;
const MAX_THEMES = 30;
const MIN_THEMES = 5;

// ─── Weighted Theme Selection ───────────────────────────────────────────────

/**
 * Pick a theme using engagement-weighted selection.
 * Themes with higher engagement get picked more often.
 * Themes with no data get a baseline weight (exploration).
 * Falls back to round-robin if no themes or no data.
 */
export function pickThemeWeighted(themes: string[], index: number): string {
  if (themes.length === 0) return 'general industry insight';
  if (themes.length === 1) return themes[0];

  const performance = getThemePerformance('month');
  const perfMap = new Map(performance.map((p) => [p.theme, p]));

  // If not enough data, fall back to round-robin
  const totalPosts = performance.reduce((sum, p) => sum + p.postCount, 0);
  if (totalPosts < 5) return themes[index % themes.length];

  // Calculate weights: engagement-based + exploration bonus for untested themes
  const avgEngAll = totalPosts > 0
    ? performance.reduce((sum, p) => sum + p.totalEngagement, 0) / totalPosts
    : 1;

  const weights: number[] = themes.map((theme) => {
    const stats = perfMap.get(theme);
    if (!stats || stats.postCount < 2) {
      // Untested or barely tested — give exploration weight (slightly above average)
      return avgEngAll * 1.2 + 1;
    }
    // Engagement-based weight (floor at 0.5 to never fully zero out)
    return Math.max(0.5, stats.avgEngagement + 1);
  });

  // Weighted random selection
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) return themes[i];
  }

  return themes[themes.length - 1];
}

// ─── Theme Adaptation ───────────────────────────────────────────────────────

/**
 * Run theme adaptation: analyze performance, expand winners, retire losers.
 * Writes updated themes back to pulse.yaml.
 */
export async function adaptThemes(): Promise<ThemeAdaptationResult> {
  const config = getConfig();
  const themes = config.contentThemes;
  const performance = getThemePerformance('month');
  const state = loadState<ThemeAdaptationState>('theme-adaptation', DEFAULT_STATE);

  const result: ThemeAdaptationResult = {
    timestamp: new Date().toISOString(),
    themesAnalyzed: performance.length,
    topPerformers: [],
    underPerformers: [],
    newThemes: [],
    retiredThemes: [],
    summary: '',
  };

  // Not enough data yet
  const totalPosts = performance.reduce((sum, p) => sum + p.postCount, 0);
  if (totalPosts < MIN_POSTS_FOR_ADAPTATION) {
    result.summary = `Need ${MIN_POSTS_FOR_ADAPTATION - totalPosts} more posts before theme adaptation kicks in.`;
    return result;
  }

  // Identify top and bottom performers
  const withEnoughData = performance.filter((p) => p.postCount >= 2);
  if (withEnoughData.length < 3) {
    result.summary = 'Not enough themes with sufficient data (need 3+ themes with 2+ posts each).';
    return result;
  }

  const sorted = [...withEnoughData].sort((a, b) => b.avgEngagement - a.avgEngagement);
  const topPerformers = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.3)));
  const underPerformers = sorted
    .filter((s) => s.postCount >= 3 && s.avgEngagement < sorted[0].avgEngagement * 0.2)
    .slice(-3);

  result.topPerformers = topPerformers.map((p) => p.theme);
  result.underPerformers = underPerformers.map((p) => p.theme);

  // Ask LLM to generate new theme variations from top performers
  const themesToExpand = topPerformers.slice(0, 5);
  const themesToRetire = underPerformers.map((p) => p.theme);
  const slotsAvailable = Math.min(
    themesToRetire.length + Math.max(0, MAX_THEMES - themes.length),
    8,
  );

  if (slotsAvailable === 0 && themesToRetire.length === 0) {
    result.summary = 'Theme pool at capacity and no underperformers to retire.';
    return result;
  }

  const statsBlock = sorted
    .map(
      (s) =>
        `"${s.theme}" — ${s.postCount} posts, avg engagement ${s.avgEngagement.toFixed(1)}`,
    )
    .join('\n');

  const prompt = `You are a content strategist. Analyze these content theme performance stats and generate new theme ideas.

Brand: ${config.persona.brandName}
Niche: ${config.persona.niche}
Current themes: ${themes.join(', ')}

Performance data (sorted by engagement):
${statsBlock}

Top performers: ${result.topPerformers.join(', ')}
Underperformers to retire: ${themesToRetire.join(', ') || 'none'}

Generate ${slotsAvailable} NEW content themes that:
1. Expand on what's working (variations/adjacent angles of top performers)
2. Fill gaps the current themes don't cover
3. Match the brand voice and niche
4. Are specific and actionable (not generic like "industry trends")

Return ONLY a valid JSON object (no markdown fences):
{
  "newThemes": ["theme 1", "theme 2"],
  "retireThemes": ["themes that should be retired based on data"],
  "reasoning": "1-2 sentence explanation"
}`;

  let newThemes: string[] = [];
  let retireThemes: string[] = themesToRetire;
  let reasoning = '';

  const response = await askLLM(prompt, { maxTokens: 1000, temperature: 0.7 });

  if (response) {
    try {
      let jsonStr = response.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr) as {
        newThemes?: string[];
        retireThemes?: string[];
        reasoning?: string;
      };

      newThemes = (parsed.newThemes ?? []).slice(0, slotsAvailable);
      if (parsed.retireThemes?.length) retireThemes = parsed.retireThemes;
      reasoning = parsed.reasoning ?? '';
    } catch {
      console.log('  [AdaptThemes] Failed to parse LLM response — using stats-only retirement');
    }
  }

  // Filter out duplicates and themes that already exist
  const existingLower = new Set(themes.map((t) => t.toLowerCase()));
  newThemes = newThemes.filter((t) => !existingLower.has(t.toLowerCase()));

  // Apply changes to config
  let updatedThemes = [...themes];

  // Retire underperformers
  const retireSet = new Set(retireThemes.map((t) => t.toLowerCase()));
  updatedThemes = updatedThemes.filter((t) => !retireSet.has(t.toLowerCase()));

  // Add new themes
  updatedThemes.push(...newThemes);

  // Cap at MAX_THEMES
  if (updatedThemes.length > MAX_THEMES) {
    updatedThemes = updatedThemes.slice(0, MAX_THEMES);
  }

  // Ensure minimum
  if (updatedThemes.length < MIN_THEMES && themes.length >= MIN_THEMES) {
    // Don't drop below minimum — skip retirement
    updatedThemes = [...themes, ...newThemes].slice(0, MAX_THEMES);
    retireThemes = [];
  }

  result.newThemes = newThemes;
  result.retiredThemes = retireThemes.filter((t) =>
    themes.some((existing) => existing.toLowerCase() === t.toLowerCase()),
  );
  result.summary = reasoning || `Expanded ${newThemes.length} themes from top performers, retired ${result.retiredThemes.length} underperformers.`;

  // Save updated config
  if (newThemes.length > 0 || result.retiredThemes.length > 0) {
    config.contentThemes = updatedThemes;
    saveConfig(config);
    console.log(`  [AdaptThemes] Updated themes: +${newThemes.length} new, -${result.retiredThemes.length} retired (${updatedThemes.length} total)`);
  }

  // Save adaptation state
  state.lastAdaptedAt = new Date().toISOString();
  state.retiredThemes = [...state.retiredThemes, ...result.retiredThemes].slice(-100);
  state.addedThemes = [
    ...state.addedThemes,
    ...newThemes.map((t) => ({ theme: t, reason: 'expanded from top performer', addedAt: new Date().toISOString() })),
  ].slice(-100);
  state.history.push({
    date: new Date().toISOString(),
    added: newThemes,
    retired: result.retiredThemes,
    reason: result.summary,
  });
  if (state.history.length > 52) state.history = state.history.slice(-52);
  saveState('theme-adaptation', state);

  return result;
}

// ─── Should Adapt Check ─────────────────────────────────────────────────────

/**
 * Check if it's time to run theme adaptation.
 * Triggers after enough posts and at least 7 days since last adaptation.
 */
export function shouldAdaptThemes(): boolean {
  const state = loadState<ThemeAdaptationState>('theme-adaptation', DEFAULT_STATE);
  const performance = getThemePerformance('month');
  const totalPosts = performance.reduce((sum, p) => sum + p.postCount, 0);

  if (totalPosts < MIN_POSTS_FOR_ADAPTATION) return false;

  // First adaptation ever
  if (!state.lastAdaptedAt) return true;

  // At least 7 days since last adaptation
  const daysSince = (Date.now() - new Date(state.lastAdaptedAt).getTime()) / 86400_000;
  return daysSince >= 7;
}

/**
 * Get the current theme adaptation state for display.
 */
export function getThemeAdaptationState(): ThemeAdaptationState {
  return loadState<ThemeAdaptationState>('theme-adaptation', DEFAULT_STATE);
}
