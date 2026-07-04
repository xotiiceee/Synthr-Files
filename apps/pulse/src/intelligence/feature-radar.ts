/**
 * Feature Radar — detects pain points and feature opportunities from social conversations.
 *
 * Scans outreach results for "I wish...", "why doesn't...", "looking for..." patterns.
 * LLM classifies opportunities, clusters demand, suggests features, auto-drafts responses when shipped.
 */

import { askLLMWithSystem } from '../core/llm.js';
import { loadState, saveState } from '../core/state.js';
import crypto from 'node:crypto';
const nanoid = (size?: number) => crypto.randomBytes(size ?? 10).toString('hex').slice(0, size ?? 20);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FeatureOpportunity {
  id: string;
  source_platform: string;
  source_url: string;
  source_author: string;
  source_text: string;
  detected_at: string;
  pain_point: string;
  suggested_feature: string;
  category: 'feature_request' | 'pain_point' | 'comparison_shopping' | 'complaint' | 'question';
  relevance_score: number;
  demand_score: number;
  engagement: number;
  competitors_mentioned: string[];
  status: 'new' | 'reviewed' | 'building' | 'shipped' | 'dismissed';
  response_draft?: string;
}

export interface DemandCluster {
  id: string;
  pain_point: string;
  mention_count: number;
  unique_authors: number;
  first_seen: string;
  last_seen: string;
  avg_engagement: number;
  opportunity_ids: string[];
  suggested_feature?: string;
  priority?: 'high' | 'medium' | 'low';
}

interface FeatureRadarState {
  opportunities: FeatureOpportunity[];
  demand_clusters: DemandCluster[];
  last_scan: string;
}

const DEFAULT_STATE: FeatureRadarState = {
  opportunities: [],
  demand_clusters: [],
  last_scan: '',
};

// Quick-check phrases that suggest a pain point (pre-LLM filter)
const PAIN_INDICATORS = [
  'i wish', 'why doesn\'t', 'why can\'t', 'anyone know a tool',
  'looking for', 'need a way to', 'the problem with', 'is there a',
  'would be great if', 'frustrated with', 'switched from', 'alternative to',
  'better than', 'cheaper than', 'how do you handle', 'struggling with',
  'pain point', 'dealbreaker', 'missing feature', 'feature request',
];

// ─── Core Functions ─────────────────────────────────────────────────────────

export async function scanForOpportunities(
  conversations: Array<{ text: string; author: string; url: string; platform: string; engagement?: { likes?: number; replies?: number } }>,
  brandContext: string,
): Promise<FeatureOpportunity[]> {
  const state = loadState<FeatureRadarState>('feature-radar', DEFAULT_STATE);
  const existingUrls = new Set(state.opportunities.map(o => o.source_url));
  const newOpportunities: FeatureOpportunity[] = [];

  for (const conv of conversations) {
    // Skip already processed
    if (existingUrls.has(conv.url)) continue;

    // Quick pre-filter: does the text contain pain indicators?
    const lower = conv.text.toLowerCase();
    const hasPainIndicator = PAIN_INDICATORS.some(p => lower.includes(p));
    if (!hasPainIndicator && conv.text.length < 50) continue;

    // LLM classification
    const result = await classifyOpportunity(conv.text, brandContext);
    if (!result || !result.is_opportunity) continue;

    const opportunity: FeatureOpportunity = {
      id: nanoid(12),
      source_platform: conv.platform,
      source_url: conv.url,
      source_author: conv.author,
      source_text: conv.text.slice(0, 500),
      detected_at: new Date().toISOString(),
      pain_point: result.pain_point,
      suggested_feature: result.suggested_feature,
      category: result.category,
      relevance_score: result.relevance,
      demand_score: 0, // calculated during clustering
      engagement: (conv.engagement?.likes || 0) + (conv.engagement?.replies || 0),
      competitors_mentioned: result.competitors || [],
      status: 'new',
    };

    newOpportunities.push(opportunity);
  }

  // Save new opportunities
  if (newOpportunities.length > 0) {
    state.opportunities.push(...newOpportunities);
    // Keep last 500 opportunities max
    if (state.opportunities.length > 500) {
      state.opportunities = state.opportunities.slice(-500);
    }
    state.last_scan = new Date().toISOString();
    saveState('feature-radar', state);
  }

  return newOpportunities;
}

async function classifyOpportunity(text: string, brandContext: string): Promise<{
  is_opportunity: boolean;
  category: FeatureOpportunity['category'];
  pain_point: string;
  suggested_feature: string;
  relevance: number;
  competitors: string[];
} | null> {
  const systemPrompt = `You analyze social media posts for product opportunities. Extract pain points and unmet needs. Return JSON only, no markdown.`;

  const userPrompt = `Brand context: ${brandContext}

Post: "${text.slice(0, 800)}"

Is this person expressing a pain point, requesting a feature, comparing products, complaining, or asking a question that our brand could address?

Return JSON: { "is_opportunity": true/false, "category": "feature_request|pain_point|comparison_shopping|complaint|question", "pain_point": "the specific unmet need", "suggested_feature": "what we could build to solve this", "relevance": 0-100, "competitors": ["names mentioned"] }`;

  try {
    const response = await askLLMWithSystem(systemPrompt, userPrompt, { maxTokens: 200, temperature: 0.3 });
    if (!response) return null;

    let json = response.trim();
    const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) json = fence[1].trim();

    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function clusterDemand(opportunities?: FeatureOpportunity[]): DemandCluster[] {
  const state = loadState<FeatureRadarState>('feature-radar', DEFAULT_STATE);
  const opps = opportunities || state.opportunities;

  // Group by similar pain points (simple keyword overlap for now)
  const clusters = new Map<string, FeatureOpportunity[]>();

  for (const opp of opps) {
    const key = opp.pain_point.toLowerCase().split(/\s+/).sort().slice(0, 5).join(' ');
    let matched = false;

    for (const [existingKey, group] of clusters) {
      // Simple overlap check — share 3+ keywords
      const existingWords = new Set(existingKey.split(' '));
      const newWords = key.split(' ');
      const overlap = newWords.filter(w => existingWords.has(w)).length;
      if (overlap >= 2) {
        group.push(opp);
        matched = true;
        break;
      }
    }

    if (!matched) {
      clusters.set(key, [opp]);
    }
  }

  const demandClusters: DemandCluster[] = [];

  for (const [, group] of clusters) {
    if (group.length === 0) continue;

    const uniqueAuthors = new Set(group.map(o => o.source_author));
    const dates = group.map(o => o.detected_at).sort();
    const totalEngagement = group.reduce((sum, o) => sum + o.engagement, 0);

    demandClusters.push({
      id: nanoid(8),
      pain_point: group[0].pain_point,
      mention_count: group.length,
      unique_authors: uniqueAuthors.size,
      first_seen: dates[0],
      last_seen: dates[dates.length - 1],
      avg_engagement: Math.round(totalEngagement / group.length),
      opportunity_ids: group.map(o => o.id),
      priority: group.length >= 5 ? 'high' : group.length >= 2 ? 'medium' : 'low',
    });
  }

  // Sort by mention count * avg engagement
  demandClusters.sort((a, b) => (b.mention_count * b.avg_engagement) - (a.mention_count * a.avg_engagement));

  // Save clusters
  state.demand_clusters = demandClusters;
  saveState('feature-radar', state);

  return demandClusters;
}

export async function generateFeatureSuggestion(cluster: DemandCluster): Promise<string> {
  const state = loadState<FeatureRadarState>('feature-radar', DEFAULT_STATE);
  const opps = state.opportunities.filter(o => cluster.opportunity_ids.includes(o.id));

  const painPoints = opps.map(o => `- "${o.source_text.slice(0, 200)}" (${o.engagement} engagement, ${o.source_platform})`).join('\n');

  const systemPrompt = `You are a product analyst. Given similar pain points from multiple users, synthesize a feature recommendation. Be specific and actionable.`;

  const userPrompt = `${cluster.mention_count} people expressed this need (${cluster.unique_authors} unique authors, avg ${cluster.avg_engagement} engagement):

${painPoints}

Synthesize a feature recommendation. Return JSON: { "feature_name": "...", "description": "...", "user_benefit": "...", "priority": "high|medium|low", "estimated_effort": "hours|days|weeks" }`;

  const response = await askLLMWithSystem(systemPrompt, userPrompt, { maxTokens: 300, temperature: 0.4 });

  if (response) {
    cluster.suggested_feature = response;
    const state2 = loadState<FeatureRadarState>('feature-radar', DEFAULT_STATE);
    const idx = state2.demand_clusters.findIndex(c => c.id === cluster.id);
    if (idx >= 0) state2.demand_clusters[idx] = cluster;
    saveState('feature-radar', state2);
  }

  return response || 'Failed to generate suggestion';
}

export async function markFeatureShipped(painPoint: string): Promise<string[]> {
  const state = loadState<FeatureRadarState>('feature-radar', DEFAULT_STATE);
  const drafts: string[] = [];

  // Find matching opportunities
  const matching = state.opportunities.filter(
    o => o.pain_point.toLowerCase().includes(painPoint.toLowerCase()) && o.status !== 'shipped'
  );

  for (const opp of matching) {
    const systemPrompt = `Write a short, natural reply to someone who asked for a feature that now exists. Be excited but not salesy. 1-2 sentences max.`;
    const userPrompt = `Their original post: "${opp.source_text.slice(0, 300)}"
Their pain point: ${opp.pain_point}
What we built: ${painPoint}

Write a reply:`;

    const draft = await askLLMWithSystem(systemPrompt, userPrompt, { maxTokens: 100, temperature: 0.7 });

    if (draft) {
      opp.status = 'shipped';
      opp.response_draft = draft;
      drafts.push(`@${opp.source_author} (${opp.source_platform}): ${draft}`);
    }
  }

  saveState('feature-radar', state);
  return drafts;
}

export function getFeatureRadarState(): FeatureRadarState {
  return loadState<FeatureRadarState>('feature-radar', DEFAULT_STATE);
}

export function updateOpportunityStatus(id: string, status: FeatureOpportunity['status']): void {
  const state = loadState<FeatureRadarState>('feature-radar', DEFAULT_STATE);
  const opp = state.opportunities.find(o => o.id === id);
  if (opp) {
    opp.status = status;
    saveState('feature-radar', state);
  }
}

export function getHighPriorityClusters(): DemandCluster[] {
  const state = loadState<FeatureRadarState>('feature-radar', DEFAULT_STATE);
  return state.demand_clusters.filter(c => c.priority === 'high');
}
