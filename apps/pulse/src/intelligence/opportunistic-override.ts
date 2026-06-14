/**
 * Opportunistic Override — breaks the content calendar when something important happens.
 *
 * Monitors for trending topics, competitor news, and Feature Radar alerts.
 * When a high-relevance opportunity is detected, overrides the scheduled
 * category and generates timely content instead.
 */

import { askLLMWithSystem } from '../core/llm.js';
import { loadState, saveState } from '../core/state.js';
import { getConfig } from '../core/persona.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OpportunityTrigger {
  type: 'trending_topic' | 'competitor_news' | 'feature_radar' | 'customer_milestone' | 'industry_event';
  title: string;
  context: string;
  relevance: number;    // 0-100
  urgency: 'immediate' | 'today' | 'this_week';
  source?: string;
  detected_at: string;
}

export interface OverrideDecision {
  should_override: boolean;
  trigger?: OpportunityTrigger;
  suggested_content?: string;
  reason: string;
}

interface OverrideState {
  recent_overrides: Array<{ date: string; trigger_type: string; title: string }>;
  last_check: string;
}

const DEFAULT_STATE: OverrideState = {
  recent_overrides: [],
  last_check: '',
};

// Don't override more than 2x per day (to maintain calendar consistency)
const MAX_DAILY_OVERRIDES = 2;

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Check if any opportunity warrants overriding today's scheduled content.
 * Call this before generating the day's content.
 */
export async function checkForOverride(
  triggers: OpportunityTrigger[],
  scheduledCategory?: string,
): Promise<OverrideDecision> {
  const state = loadState<OverrideState>('opportunistic-override', DEFAULT_STATE);

  // Check daily override limit
  const today = new Date().toISOString().slice(0, 10);
  const todayOverrides = state.recent_overrides.filter(o => o.date.startsWith(today));
  if (todayOverrides.length >= MAX_DAILY_OVERRIDES) {
    return { should_override: false, reason: `Already overrode ${MAX_DAILY_OVERRIDES}x today — maintaining calendar` };
  }

  // Filter to high-relevance, high-urgency triggers
  const actionable = triggers
    .filter(t => t.relevance >= 70 && (t.urgency === 'immediate' || t.urgency === 'today'))
    .sort((a, b) => b.relevance - a.relevance);

  if (actionable.length === 0) {
    return { should_override: false, reason: 'No high-urgency opportunities detected' };
  }

  const best = actionable[0];

  // Avoid overriding for similar topics we already covered
  const recentTitles = state.recent_overrides.slice(-10).map(o => o.title.toLowerCase());
  if (recentTitles.some(t => best.title.toLowerCase().includes(t) || t.includes(best.title.toLowerCase()))) {
    return { should_override: false, reason: `Already covered "${best.title}" recently` };
  }

  // Generate content for the override
  const content = await generateOverrideContent(best);

  // Record the override
  state.recent_overrides.push({ date: new Date().toISOString(), trigger_type: best.type, title: best.title });
  if (state.recent_overrides.length > 50) state.recent_overrides = state.recent_overrides.slice(-50);
  state.last_check = new Date().toISOString();
  saveState('opportunistic-override', state);

  return {
    should_override: true,
    trigger: best,
    suggested_content: content,
    reason: `Override: ${best.type} — "${best.title}" (relevance: ${best.relevance}, urgency: ${best.urgency})`,
  };
}

async function generateOverrideContent(trigger: OpportunityTrigger): Promise<string | undefined> {
  const config = getConfig();

  const systemPrompt = `You are a social media manager for ${config.persona.brandName} (${config.persona.niche}). Generate a timely, relevant post about a developing situation. Be specific, add your brand's perspective, and make it feel authentic — not like a press release.`;

  const userPrompt = `Opportunity type: ${trigger.type}
Title: ${trigger.title}
Context: ${trigger.context}
${trigger.source ? `Source: ${trigger.source}` : ''}

Brand voice: ${config.persona.tone}
Brand tagline: ${config.persona.tagline}

Write a post (max 280 characters for X) that:
1. Addresses this timely topic
2. Adds our brand's specific perspective
3. Feels natural, not forced
4. Optionally ties back to what we do (only if genuinely relevant)`;

  const response = await askLLMWithSystem(systemPrompt, userPrompt, { maxTokens: 150, temperature: 0.7 });
  return response || undefined;
}

/**
 * Scan for trending opportunities.
 * This should be called before each content generation cycle.
 */
export function buildTriggersFromContext(
  trendingTopics?: Array<{ title: string; context: string; relevance: number }>,
  competitorNews?: Array<{ competitor: string; news: string; relevance: number }>,
  featureRadarAlerts?: Array<{ pain_point: string; mention_count: number; relevance: number }>,
): OpportunityTrigger[] {
  const triggers: OpportunityTrigger[] = [];
  const now = new Date().toISOString();

  if (trendingTopics) {
    for (const t of trendingTopics) {
      if (t.relevance >= 60) {
        triggers.push({
          type: 'trending_topic',
          title: t.title,
          context: t.context,
          relevance: t.relevance,
          urgency: t.relevance >= 85 ? 'immediate' : 'today',
          detected_at: now,
        });
      }
    }
  }

  if (competitorNews) {
    for (const c of competitorNews) {
      if (c.relevance >= 60) {
        triggers.push({
          type: 'competitor_news',
          title: `${c.competitor} news`,
          context: c.news,
          relevance: c.relevance,
          urgency: 'today',
          detected_at: now,
        });
      }
    }
  }

  if (featureRadarAlerts) {
    for (const f of featureRadarAlerts) {
      if (f.mention_count >= 5) {
        triggers.push({
          type: 'feature_radar',
          title: f.pain_point,
          context: `${f.mention_count} people mentioned this need`,
          relevance: f.relevance,
          urgency: 'this_week',
          detected_at: now,
        });
      }
    }
  }

  return triggers.sort((a, b) => b.relevance - a.relevance);
}

export function getOverrideState(): OverrideState {
  return loadState<OverrideState>('opportunistic-override', DEFAULT_STATE);
}
