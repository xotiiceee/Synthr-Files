/**
 * Strategic Relationship Targeting
 *
 * Instead of replying to random accounts, identifies the 20 most valuable
 * "gateway accounts" — people whose followers are exactly your target audience.
 * Tracks relationship progression: stranger → engaged → mutual → advocate.
 */

import { loadState, saveState } from '../core/state.js';
import { getConfig } from '../core/persona.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TargetAccount {
  handle: string;
  platform: string;
  followerCount?: number;
  relevanceScore: number;       // 0-100 how relevant to our niche
  relationship: 'stranger' | 'replied' | 'engaged' | 'mutual' | 'advocate';
  interactions: Array<{
    date: string;
    type: 'reply' | 'like' | 'repost' | 'mention' | 'they_replied' | 'they_followed';
    content?: string;
  }>;
  last_interaction: string;
  added_at: string;
  priority: 'high' | 'medium' | 'low';
  notes?: string;
}

interface StrategicTargetingState {
  targets: TargetAccount[];
  daily_interactions: Record<string, number>; // date → count
  last_updated: string;
}

const DEFAULT_STATE: StrategicTargetingState = {
  targets: [],
  daily_interactions: {},
  last_updated: '',
};

const MAX_TARGETS = 30;
const DAILY_INTERACTION_GOAL = 5;

// ─── Target Management ──────────────────────────────────────────────────────

/**
 * Add a target account to the strategic list.
 */
export function addTarget(
  handle: string,
  platform: string,
  options?: { followerCount?: number; relevanceScore?: number; priority?: 'high' | 'medium' | 'low'; notes?: string },
): TargetAccount {
  const state = loadState<StrategicTargetingState>('strategic-targeting', DEFAULT_STATE);

  // Check if already tracked
  const existing = state.targets.find(t => t.handle.toLowerCase() === handle.toLowerCase() && t.platform === platform);
  if (existing) {
    if (options?.relevanceScore) existing.relevanceScore = options.relevanceScore;
    if (options?.priority) existing.priority = options.priority;
    if (options?.notes) existing.notes = options.notes;
    saveState('strategic-targeting', state);
    return existing;
  }

  const target: TargetAccount = {
    handle,
    platform,
    followerCount: options?.followerCount,
    relevanceScore: options?.relevanceScore || 50,
    relationship: 'stranger',
    interactions: [],
    last_interaction: '',
    added_at: new Date().toISOString(),
    priority: options?.priority || 'medium',
    notes: options?.notes,
  };

  state.targets.push(target);

  // Keep list manageable
  if (state.targets.length > MAX_TARGETS) {
    // Remove lowest priority, oldest targets
    state.targets.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
    state.targets = state.targets.slice(0, MAX_TARGETS);
  }

  saveState('strategic-targeting', state);
  return target;
}

/**
 * Record an interaction with a target.
 * Automatically updates relationship stage.
 */
export function recordInteraction(
  handle: string,
  platform: string,
  type: TargetAccount['interactions'][0]['type'],
  content?: string,
): void {
  const state = loadState<StrategicTargetingState>('strategic-targeting', DEFAULT_STATE);
  const target = state.targets.find(t => t.handle.toLowerCase() === handle.toLowerCase() && t.platform === platform);
  if (!target) return;

  target.interactions.push({
    date: new Date().toISOString(),
    type,
    content: content?.slice(0, 200),
  });
  target.last_interaction = new Date().toISOString();

  // Keep last 50 interactions
  if (target.interactions.length > 50) {
    target.interactions = target.interactions.slice(-50);
  }

  // Update relationship stage
  target.relationship = calculateRelationship(target);

  // Track daily interaction count
  const today = new Date().toISOString().slice(0, 10);
  state.daily_interactions[today] = (state.daily_interactions[today] || 0) + 1;

  // Clean old daily counts (keep 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  for (const date of Object.keys(state.daily_interactions)) {
    if (date < thirtyDaysAgo) delete state.daily_interactions[date];
  }

  state.last_updated = new Date().toISOString();
  saveState('strategic-targeting', state);
}

function calculateRelationship(target: TargetAccount): TargetAccount['relationship'] {
  const interactions = target.interactions;
  if (interactions.length === 0) return 'stranger';

  const theyResponded = interactions.some(i => i.type === 'they_replied' || i.type === 'they_followed');
  const weInteracted = interactions.filter(i => i.type === 'reply' || i.type === 'like' || i.type === 'repost').length;
  const theyInteracted = interactions.filter(i => i.type === 'they_replied' || i.type === 'they_followed').length;

  if (theyInteracted >= 3 && weInteracted >= 5) return 'advocate';
  if (theyResponded && weInteracted >= 3) return 'mutual';
  if (theyResponded) return 'engaged';
  if (weInteracted >= 1) return 'replied';

  return 'stranger';
}

// ─── Strategic Selection ────────────────────────────────────────────────────

/**
 * Get today's recommended accounts to interact with.
 * Prioritizes: high-priority → least recently interacted → strangers first.
 */
export function getTodaysTargets(count: number = DAILY_INTERACTION_GOAL): TargetAccount[] {
  const state = loadState<StrategicTargetingState>('strategic-targeting', DEFAULT_STATE);

  // Score each target for today's interaction
  const scored = state.targets.map(target => {
    let score = target.relevanceScore;

    // Priority boost
    if (target.priority === 'high') score += 30;
    if (target.priority === 'medium') score += 15;

    // Recency penalty — recently interacted accounts get lower priority
    if (target.last_interaction) {
      const hoursSince = (Date.now() - new Date(target.last_interaction).getTime()) / 3600000;
      if (hoursSince < 24) score -= 40;     // interacted today
      else if (hoursSince < 72) score -= 20; // interacted recently
      else if (hoursSince > 168) score += 20; // overdue (>1 week)
    } else {
      score += 25; // never interacted — priority
    }

    // Relationship stage bonus (we want to progress relationships)
    if (target.relationship === 'stranger') score += 15;
    if (target.relationship === 'replied') score += 10;
    if (target.relationship === 'engaged') score += 5;
    // Mutual/advocate need less frequent interaction
    if (target.relationship === 'mutual') score -= 10;
    if (target.relationship === 'advocate') score -= 20;

    return { target, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(s => s.target);
}

/**
 * Auto-discover potential targets from outreach conversations.
 * Called after outreach runs — identifies high-value accounts from the conversations.
 */
export function discoverTargetsFromConversations(
  conversations: Array<{ author: string; platform: string; engagement?: { likes?: number; replies?: number }; text?: string }>,
  niche: string,
): number {
  let added = 0;
  const config = getConfig();

  for (const conv of conversations) {
    const engagement = (conv.engagement?.likes || 0) + (conv.engagement?.replies || 0);

    // High-engagement accounts in our niche are potential targets
    if (engagement >= 20) {
      addTarget(conv.author, conv.platform, {
        relevanceScore: Math.min(90, 50 + engagement),
        priority: engagement >= 100 ? 'high' : 'medium',
        notes: `Auto-discovered: ${engagement} engagement on niche post`,
      });
      added++;
    }
  }

  return added;
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export function getTargetingStats(): {
  total_targets: number;
  by_relationship: Record<string, number>;
  by_priority: Record<string, number>;
  daily_avg_interactions: number;
  relationship_progression: number;  // % that moved past 'stranger'
} {
  const state = loadState<StrategicTargetingState>('strategic-targeting', DEFAULT_STATE);

  const byRelationship: Record<string, number> = {};
  const byPriority: Record<string, number> = {};

  for (const t of state.targets) {
    byRelationship[t.relationship] = (byRelationship[t.relationship] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
  }

  const dailyCounts = Object.values(state.daily_interactions);
  const dailyAvg = dailyCounts.length > 0 ? dailyCounts.reduce((s, c) => s + c, 0) / dailyCounts.length : 0;

  const progressed = state.targets.filter(t => t.relationship !== 'stranger').length;

  return {
    total_targets: state.targets.length,
    by_relationship: byRelationship,
    by_priority: byPriority,
    daily_avg_interactions: Math.round(dailyAvg * 10) / 10,
    relationship_progression: state.targets.length > 0 ? Math.round((progressed / state.targets.length) * 100) : 0,
  };
}

export function getTargetingState(): StrategicTargetingState {
  return loadState<StrategicTargetingState>('strategic-targeting', DEFAULT_STATE);
}

export function removeTarget(handle: string, platform: string): boolean {
  const state = loadState<StrategicTargetingState>('strategic-targeting', DEFAULT_STATE);
  const before = state.targets.length;
  state.targets = state.targets.filter(t => !(t.handle.toLowerCase() === handle.toLowerCase() && t.platform === platform));
  saveState('strategic-targeting', state);
  return state.targets.length < before;
}
