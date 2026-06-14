/**
 * Analytics tracker — aggregates action data into stats.
 * Wraps state.getActions() with period-aware filtering and rollups.
 */

import { getActions, logAction, generateId, type ActionRecord } from '../core/state.js';
import type { OutreachResult } from '../modes/outreach.js';
import type { ContentResult } from '../modes/content.js';
import type { MonitorResult } from '../modes/monitor.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Stats {
  totalActions: number;
  byPlatform: Record<string, number>;
  byType: Record<string, number>;
  byTopic: Record<string, number>;
  avgEngagement: number;
  bestTopic: string;
  worstTopic: string;
}

export interface ThemeStats {
  theme: string;
  postCount: number;
  totalEngagement: number;
  avgEngagement: number;
  platforms: string[];
}

// ─── Period Helpers ─────────────────────────────────────────────────────────

function getPeriodStart(period: 'day' | 'week' | 'month'): string {
  const now = new Date();
  switch (period) {
    case 'day':
      now.setHours(0, 0, 0, 0);
      break;
    case 'week':
      now.setDate(now.getDate() - 7);
      break;
    case 'month':
      now.setDate(now.getDate() - 30);
      break;
  }
  return now.toISOString();
}

// ─── Tracking Functions ─────────────────────────────────────────────────────

export function trackOutreach(result: OutreachResult): void {
  logAction({
    id: generateId(),
    timestamp: new Date().toISOString(),
    platform: 'system',
    type: 'reply',
    topicId: 'outreach-run',
    content: JSON.stringify({
      repliedCount: result.repliedCount,
      searchedCount: result.searchedCount,
      candidatesFound: result.candidatesFound,
      skippedReasons: result.skippedReasons,
    }),
  });
}

export function trackContent(result: ContentResult): void {
  logAction({
    id: generateId(),
    timestamp: new Date().toISOString(),
    platform: 'system',
    type: 'post',
    topicId: 'content-run',
    content: JSON.stringify({
      postsGenerated: result.postsGenerated,
      postsPublished: result.postsPublished,
      draftsCount: result.drafts.length,
    }),
  });
}

export function trackMonitor(result: MonitorResult): void {
  logAction({
    id: generateId(),
    timestamp: new Date().toISOString(),
    platform: 'system',
    type: 'comment',
    topicId: 'monitor-run',
    content: JSON.stringify({
      mentions: result.mentions.length,
      competitorMentions: result.competitorMentions.length,
      alerts: result.alerts.length,
    }),
  });
}

// ─── Stats Aggregation ──────────────────────────────────────────────────────

export function getStats(period: 'day' | 'week' | 'month'): Stats {
  const since = getPeriodStart(period);
  const actions = getActions(since).filter((a) => a.platform !== 'system');

  const byPlatform: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byTopic: Record<string, number> = {};
  const topicEngagement: Record<string, { total: number; count: number }> = {};

  let totalEngagement = 0;
  let engagementCount = 0;

  for (const action of actions) {
    // Count by platform
    byPlatform[action.platform] = (byPlatform[action.platform] ?? 0) + 1;

    // Count by type
    byType[action.type] = (byType[action.type] ?? 0) + 1;

    // Count by topic
    byTopic[action.topicId] = (byTopic[action.topicId] ?? 0) + 1;

    // Track engagement per topic
    if (action.engagement) {
      const eng = action.engagement.likes + action.engagement.replies + action.engagement.reposts;
      totalEngagement += eng;
      engagementCount++;

      if (!topicEngagement[action.topicId]) {
        topicEngagement[action.topicId] = { total: 0, count: 0 };
      }
      topicEngagement[action.topicId].total += eng;
      topicEngagement[action.topicId].count++;
    }
  }

  // Find best/worst topics by avg engagement
  let bestTopic = 'none';
  let worstTopic = 'none';
  let bestAvg = -1;
  let worstAvg = Infinity;

  for (const [topic, data] of Object.entries(topicEngagement)) {
    const avg = data.total / data.count;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestTopic = topic;
    }
    if (avg < worstAvg) {
      worstAvg = avg;
      worstTopic = topic;
    }
  }

  // If no engagement data, use action count as fallback
  if (bestTopic === 'none' && Object.keys(byTopic).length > 0) {
    const sorted = Object.entries(byTopic).sort((a, b) => b[1] - a[1]);
    bestTopic = sorted[0][0];
    worstTopic = sorted[sorted.length - 1][0];
  }

  return {
    totalActions: actions.length,
    byPlatform,
    byType,
    byTopic,
    avgEngagement: engagementCount > 0 ? Math.round(totalEngagement / engagementCount) : 0,
    bestTopic,
    worstTopic,
  };
}

// ─── Theme Performance ─────────────────────────────────────────────────────

/**
 * Aggregate engagement stats grouped by content theme.
 * Only considers actions that have a `theme` field set.
 */
export function getThemePerformance(period: 'week' | 'month' | 'all' = 'month'): ThemeStats[] {
  const since = period === 'all' ? undefined : getPeriodStart(period === 'week' ? 'week' : 'month');
  const actions = getActions(since).filter((a) => a.theme && a.platform !== 'system');

  const map = new Map<string, ThemeStats>();

  for (const action of actions) {
    const theme = action.theme!;
    const eng =
      (action.engagement?.likes ?? 0) +
      (action.engagement?.replies ?? 0) +
      (action.engagement?.reposts ?? 0);

    const existing = map.get(theme);
    if (existing) {
      existing.postCount++;
      existing.totalEngagement += eng;
      existing.avgEngagement = existing.totalEngagement / existing.postCount;
      if (!existing.platforms.includes(action.platform)) {
        existing.platforms.push(action.platform);
      }
    } else {
      map.set(theme, {
        theme,
        postCount: 1,
        totalEngagement: eng,
        avgEngagement: eng,
        platforms: [action.platform],
      });
    }
  }

  return [...map.values()].sort((a, b) => b.avgEngagement - a.avgEngagement);
}
