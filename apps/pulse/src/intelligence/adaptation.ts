/**
 * Self-improvement engine — analyzes past actions, retires underperformers,
 * generates replacement topics, and identifies timing/tone patterns.
 * This is THE feature that makes PULSE worth $100.
 */

import { askLLM } from '../core/llm.js';
import { getConfig } from '../core/persona.js';
import {
  getActions,
  loadAdaptationState,
  saveAdaptationState,
  type ActionRecord,
} from '../core/state.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdaptationReport {
  timestamp: string;
  actionsAnalyzed: number;
  topPerformers: string[];
  underPerformers: string[];
  retiredTopics: string[];
  newTopics: Array<{ id: string; query: string }>;
  toneShifts: string[];
  timingInsights: string[];
  summary: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TopicStats {
  topicId: string;
  count: number;
  totalEngagement: number;
  avgEngagement: number;
  actions: ActionRecord[];
}

function groupByTopic(actions: ActionRecord[]): Map<string, TopicStats> {
  const map = new Map<string, TopicStats>();

  for (const action of actions) {
    const tid = action.topicId || 'unknown';
    const existing = map.get(tid);
    const eng =
      (action.engagement?.likes ?? 0) +
      (action.engagement?.replies ?? 0) +
      (action.engagement?.reposts ?? 0);

    if (existing) {
      existing.count++;
      existing.totalEngagement += eng;
      existing.avgEngagement = existing.totalEngagement / existing.count;
      existing.actions.push(action);
    } else {
      map.set(tid, {
        topicId: tid,
        count: 1,
        totalEngagement: eng,
        avgEngagement: eng,
        actions: [action],
      });
    }
  }

  return map;
}

// ─── Main Adaptation ─────────────────────────────────────────────────────────

/**
 * Run the full adaptation cycle: analyze performance, retire bad topics,
 * generate replacements, identify patterns.
 */
export async function runAdaptation(): Promise<AdaptationReport> {
  const config = getConfig();
  const actions = getActions();
  const adaptState = loadAdaptationState();
  const topicStats = groupByTopic(actions);

  // Sort by avg engagement
  const sorted = [...topicStats.values()].sort((a, b) => b.avgEngagement - a.avgEngagement);

  const topPerformers = sorted.slice(0, 5).map((s) => s.topicId);
  const underPerformers = sorted
    .filter((s) => s.count >= 3 && s.avgEngagement < 1)
    .map((s) => s.topicId);

  // Build analysis summary for LLM
  const statsText = sorted
    .map(
      (s) =>
        `Topic "${s.topicId}": ${s.count} actions, avg engagement ${s.avgEngagement.toFixed(1)}`
    )
    .join('\n');

  const timingText = actions
    .slice(-50)
    .map((a) => {
      const hour = new Date(a.timestamp).getHours();
      const eng =
        (a.engagement?.likes ?? 0) +
        (a.engagement?.replies ?? 0) +
        (a.engagement?.reposts ?? 0);
      return `${a.platform} at ${hour}:00 — engagement: ${eng}`;
    })
    .join('\n');

  // Ask LLM for deep analysis
  const analysisPrompt = `You are a marketing performance analyst. Analyze this AI marketing agent's performance and suggest improvements.

Brand: ${config.persona.brandName}
Niche: ${config.persona.niche}
Current tone: ${config.persona.tone}

Topic performance (sorted by avg engagement):
${statsText || 'No data yet'}

Recent timing data:
${timingText || 'No timing data'}

Underperforming topics (low engagement, 3+ attempts): ${underPerformers.join(', ') || 'none'}
Top performing topics: ${topPerformers.join(', ') || 'none'}

Analyze and return ONLY a valid JSON object (no markdown fences):
{
  "retiredTopics": ["topic-ids to stop using"],
  "newTopics": [{"id": "kebab-id", "query": "google search query to replace retired topic"}],
  "toneShifts": ["suggestions for tone adjustments, e.g. 'be more technical on HN'"],
  "timingInsights": ["timing patterns, e.g. 'best engagement at 9-11am'"],
  "summary": "2-3 sentence overall assessment"
}`;

  let retiredTopics: string[] = [];
  let newTopics: Array<{ id: string; query: string }> = [];
  let toneShifts: string[] = [];
  let timingInsights: string[] = [];
  let summary = 'Adaptation completed with basic analysis.';

  const response = await askLLM(analysisPrompt, { maxTokens: 1000, temperature: 0.5 });

  if (response) {
    try {
      let jsonStr = response.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr) as {
        retiredTopics?: string[];
        newTopics?: Array<{ id: string; query: string }>;
        toneShifts?: string[];
        timingInsights?: string[];
        summary?: string;
      };

      retiredTopics = parsed.retiredTopics ?? underPerformers;
      newTopics = parsed.newTopics ?? [];
      toneShifts = parsed.toneShifts ?? [];
      timingInsights = parsed.timingInsights ?? [];
      summary = parsed.summary ?? summary;
    } catch {
      console.log('  [Adapt] Failed to parse LLM analysis — using basic stats');
      retiredTopics = underPerformers;
    }
  } else {
    // Fallback: basic statistical retirement without LLM
    retiredTopics = underPerformers;
    summary = `Basic adaptation: retired ${underPerformers.length} underperforming topics. LLM analysis unavailable.`;
  }

  // Save adaptation state
  saveAdaptationState({
    lastAdaptedAt: new Date().toISOString(),
    actionsSinceLastAdaptation: 0,
    retiredTopics: [...adaptState.retiredTopics, ...retiredTopics],
    addedTopics: [
      ...adaptState.addedTopics,
      ...newTopics.map((t) => ({ ...t, reason: 'replaced underperformer' })),
    ],
    toneAdjustments: toneShifts,
    bestTimeSlots: timingInsights,
    insights: [summary],
  });

  const report: AdaptationReport = {
    timestamp: new Date().toISOString(),
    actionsAnalyzed: actions.length,
    topPerformers,
    underPerformers,
    retiredTopics,
    newTopics,
    toneShifts,
    timingInsights,
    summary,
  };

  return report;
}

/**
 * Check if it's time to run adaptation.
 * Triggers after 50+ actions or enough days since last adaptation.
 */
export function shouldAdapt(): boolean {
  const config = getConfig();
  const adaptState = loadAdaptationState();
  const actions = getActions();

  // Need at least 50 actions for meaningful analysis
  if (actions.length >= 50) {
    // First adaptation ever
    if (!adaptState.lastAdaptedAt) return true;

    // Check interval
    const daysSince =
      (Date.now() - new Date(adaptState.lastAdaptedAt).getTime()) / 86400_000;
    if (daysSince >= config.schedule.adaptationIntervalDays) return true;
  }

  return false;
}
