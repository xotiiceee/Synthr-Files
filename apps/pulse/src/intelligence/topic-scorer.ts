/**
 * Smart Topic Scoring — replaces random shuffle with weighted selection.
 *
 * Scores topics by: historical engagement, recency of use, approval rate,
 * time-of-day/day-of-week relevance, and freshness.
 */

import { loadState, saveState } from '../core/state.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TopicConfig {
  name: string;
  query: string;
  category?: string;
  bestHours?: number[];
  [key: string]: unknown;
}

export interface ScoredTopic {
  topic: TopicConfig;
  score: number;
  reasons: string[];
}

interface TopicUsageState {
  lastTopicUsed: Record<string, string>; // topic name → ISO timestamp
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export function scoreTopics(
  topics: TopicConfig[],
  learningData?: { topicPerformance?: Record<string, { avgEngagement?: number; approvalRate?: number; count?: number }> },
): ScoredTopic[] {
  const usageState = loadState<TopicUsageState>('topic-usage', { lastTopicUsed: {} });

  const scored = topics.map(topic => {
    let score = 50;
    const reasons: string[] = [];

    // A. Historical performance
    const perf = learningData?.topicPerformance?.[topic.name];
    if (perf) {
      const avg = perf.avgEngagement || 0;
      if (avg > 10) { score += 20; reasons.push(`High past engagement (${avg.toFixed(1)} avg)`); }
      else if (avg > 5) { score += 10; reasons.push('Moderate past engagement'); }
      else if (avg < 2 && (perf.count || 0) > 3) { score -= 10; reasons.push('Low past engagement'); }

      // Approval rate
      const approval = perf.approvalRate;
      if (approval !== undefined) {
        if (approval > 0.8) { score += 15; reasons.push(`High approval rate (${(approval * 100).toFixed(0)}%)`); }
        else if (approval < 0.3) { score -= 20; reasons.push(`Low approval rate (${(approval * 100).toFixed(0)}%)`); }
      }
    }

    // B. Recency — avoid using same topic too frequently
    const lastUsed = usageState.lastTopicUsed[topic.name];
    if (lastUsed) {
      const hoursSince = (Date.now() - new Date(lastUsed).getTime()) / 3_600_000;
      if (hoursSince < 6) { score -= 20; reasons.push('Used in last 6h'); }
      else if (hoursSince > 48) { score += 10; reasons.push('Not used in 2+ days'); }
    } else {
      score += 15;
      reasons.push('Never used — fresh topic');
    }

    // C. Time-of-day relevance
    const hour = new Date().getHours();
    if (topic.bestHours && !topic.bestHours.includes(hour)) {
      score -= 10;
      reasons.push('Not optimal time of day');
    }

    // D. Day-of-week
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;
    if (topic.category === 'business' && isWeekend) {
      score -= 5;
      reasons.push('Business topic on weekend');
    }
    if (topic.category === 'casual' && !isWeekend) {
      score -= 3;
      reasons.push('Casual topic on weekday');
    }

    return {
      topic,
      score: Math.max(0, Math.min(100, score)),
      reasons,
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

export function recordTopicUsed(topicName: string): void {
  const state = loadState<TopicUsageState>('topic-usage', { lastTopicUsed: {} });
  state.lastTopicUsed[topicName] = new Date().toISOString();
  saveState('topic-usage', state);
}

export function getTopicUsageState(): TopicUsageState {
  return loadState<TopicUsageState>('topic-usage', { lastTopicUsed: {} });
}
