/**
 * Audience Profiler.
 * Analyzes who engages with your content, builds audience profiles,
 * finds engagement patterns, and suggests lookalike targeting strategies.
 */

import { getCRM } from '../crm/database.js';
import { askLLM } from '../core/llm.js';
import { getConfig } from '../core/persona.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AudienceProfile {
  totalLeads: number;
  byPlatform: Record<string, number>;
  byStatus: Record<string, number>;
  topEngagers: Array<{
    username: string;
    platform: string;
    score: number;
    interactionCount: number;
  }>;
  commonTraits: string[];
  peakEngagementTimes: string[];
  topTopics: string[];
  recommendations: string[];
}

export interface EngagementPattern {
  byDayOfWeek: Record<string, number>;
  byHour: Record<string, number>;
  byTopic: Record<string, { sent: number; avgEngagement: number }>;
  bestDay: string;
  bestHour: number;
  bestTopic: string;
}

// ─── Data Queries ────────────────────────────────────────────────────────────

interface LeadRow {
  id: number;
  platform: string;
  username: string;
  score: number;
  interaction_count: number;
  status: string;
  tags: string;
  first_seen_at: string;
  last_interaction_at: string;
  notes: string;
}

interface InteractionRow {
  id: number;
  lead_id: number;
  platform: string;
  type: string;
  our_content: string | null;
  their_content: string | null;
  created_at: string;
}

function queryLeadsByPlatform(): Record<string, number> {
  const rows = getCRM()
    .prepare('SELECT platform, COUNT(*) as cnt FROM leads GROUP BY platform')
    .all() as { platform: string; cnt: number }[];

  const result: Record<string, number> = {};
  for (const row of rows) result[row.platform] = row.cnt;
  return result;
}

function queryLeadsByStatus(): Record<string, number> {
  const rows = getCRM()
    .prepare('SELECT status, COUNT(*) as cnt FROM leads GROUP BY status')
    .all() as { status: string; cnt: number }[];

  const result: Record<string, number> = {};
  for (const row of rows) result[row.status] = row.cnt;
  return result;
}

function queryTopEngagers(limit: number = 20): LeadRow[] {
  return getCRM()
    .prepare(
      'SELECT * FROM leads ORDER BY score DESC, interaction_count DESC LIMIT ?'
    )
    .all(limit) as LeadRow[];
}

function queryAllInteractions(): InteractionRow[] {
  return getCRM()
    .prepare('SELECT * FROM interactions ORDER BY created_at DESC LIMIT 500')
    .all() as InteractionRow[];
}

function queryTotalLeads(): number {
  const row = getCRM()
    .prepare('SELECT COUNT(*) as cnt FROM leads')
    .get() as { cnt: number };
  return row.cnt;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analyze all leads in CRM, group by platform, and extract audience patterns.
 * Uses LLM to identify common traits and generate recommendations.
 */
export async function analyzeAudience(): Promise<AudienceProfile> {
  const config = getConfig();
  const totalLeads = queryTotalLeads();
  const byPlatform = queryLeadsByPlatform();
  const byStatus = queryLeadsByStatus();
  const topEngagerRows = queryTopEngagers(20);

  const topEngagers = topEngagerRows.map((row) => ({
    username: row.username,
    platform: row.platform,
    score: row.score,
    interactionCount: row.interaction_count,
  }));

  // Collect data for LLM analysis
  const interactions = queryAllInteractions();

  const engagerSummary = topEngagerRows
    .slice(0, 15)
    .map(
      (r) =>
        `@${r.username} (${r.platform}) — score ${r.score}, ${r.interaction_count} interactions, status: ${r.status}, tags: ${r.tags}`
    )
    .join('\n');

  const interactionSample = interactions
    .slice(0, 30)
    .map(
      (i) =>
        `[${i.platform}/${i.type}] ${(i.our_content ?? '').slice(0, 80)} → ${(i.their_content ?? '').slice(0, 80)}`
    )
    .join('\n');

  const prompt = `You are an audience analyst for a "${config.persona.niche}" brand.

BRAND: ${config.persona.brandName}
IDEAL CUSTOMER: ${config.persona.idealCustomer || 'not specified'}
PROBLEM SOLVED: ${config.persona.problemSolved || 'not specified'}

AUDIENCE DATA:
- Total leads: ${totalLeads}
- By platform: ${JSON.stringify(byPlatform)}
- By status: ${JSON.stringify(byStatus)}

TOP ENGAGERS:
${engagerSummary || 'No engagers yet.'}

RECENT INTERACTIONS (sample):
${interactionSample || 'No interactions yet.'}

Analyze this audience data and respond in EXACTLY this JSON format (no markdown):
{
  "commonTraits": ["trait 1 — e.g. tech founders", "trait 2 — e.g. mid-career professionals"],
  "peakEngagementTimes": ["Tuesdays 9-11am", "Weekday evenings"],
  "topTopics": ["topic that gets most engagement", "second topic"],
  "recommendations": ["specific recommendation 1", "specific recommendation 2", "specific recommendation 3"]
}

Be specific. Reference actual patterns from the data. If there isn't enough data, say so in recommendations and suggest how to gather more.`;

  const defaults: AudienceProfile = {
    totalLeads,
    byPlatform,
    byStatus,
    topEngagers,
    commonTraits: [],
    peakEngagementTimes: [],
    topTopics: [],
    recommendations: ['Not enough data yet — keep running outreach to build an audience profile.'],
  };

  const raw = await askLLM(prompt, { maxTokens: 800, temperature: 0.5 });
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      commonTraits: parsed.commonTraits ?? [],
      peakEngagementTimes: parsed.peakEngagementTimes ?? [],
      topTopics: parsed.topTopics ?? [],
      recommendations: parsed.recommendations ?? defaults.recommendations,
    };
  } catch {
    console.log('  [Audience] Failed to parse LLM response, using defaults');
    return defaults;
  }
}

/**
 * Suggest keywords and topics to find people similar to a given lead.
 */
export async function findLookalikes(leadId: number): Promise<string[]> {
  const config = getConfig();
  const db = getCRM();

  const lead = db
    .prepare('SELECT * FROM leads WHERE id = ?')
    .get(leadId) as LeadRow | undefined;
  if (!lead) return [];

  const interactions = db
    .prepare(
      'SELECT * FROM interactions WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20'
    )
    .all(leadId) as InteractionRow[];

  const interactionContext = interactions
    .map(
      (i) =>
        `[${i.type}] ${(i.our_content ?? '').slice(0, 80)} | ${(i.their_content ?? '').slice(0, 80)}`
    )
    .join('\n');

  const prompt = `I want to find more people like this lead on ${lead.platform}:

Username: @${lead.username}
Platform: ${lead.platform}
Score: ${lead.score}
Interactions: ${lead.interaction_count}
Tags: ${lead.tags}
Status: ${lead.status}

THEIR INTERACTION HISTORY:
${interactionContext || 'No interactions yet.'}

BRAND NICHE: ${config.persona.niche}
IDEAL CUSTOMER: ${config.persona.idealCustomer || 'not specified'}

Suggest 8-10 search keywords/phrases I could use to find similar people on ${lead.platform} and other platforms. Think about:
- What topics they care about
- What communities they might be in
- What hashtags they might use
- What job titles or roles they might have

Respond with ONLY a JSON array of search strings, like: ["keyword 1", "keyword 2"]
No explanation, no markdown.`;

  const raw = await askLLM(prompt, { maxTokens: 300, temperature: 0.6 });
  if (!raw) return [`${config.persona.niche} ${lead.platform}`];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === 'string');
  } catch {
    // Fallback: split by newlines if JSON parse fails
    return raw
      .split('\n')
      .map((line) => line.replace(/^[-•*\d.)\]]+\s*/, '').trim())
      .filter((line) => line.length > 2 && line.length < 100);
  }

  return [`${config.persona.niche} ${lead.platform}`];
}

/**
 * Analyze when people engage most and what topics resonate.
 * Groups interactions by day of week, hour, and topic.
 */
export function getEngagementPatterns(): EngagementPattern {
  const interactions = queryAllInteractions();

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const byDayOfWeek: Record<string, number> = {};
  const byHour: Record<string, number> = {};
  const byTopic: Record<string, { sent: number; totalEngagement: number }> = {};

  for (const day of DAYS) byDayOfWeek[day] = 0;
  for (let h = 0; h < 24; h++) byHour[String(h)] = 0;

  for (const interaction of interactions) {
    const date = new Date(interaction.created_at);
    const day = DAYS[date.getDay()];
    const hour = date.getHours();

    byDayOfWeek[day] = (byDayOfWeek[day] ?? 0) + 1;
    byHour[String(hour)] = (byHour[String(hour)] ?? 0) + 1;

    // Extract a rough "topic" from content
    const content = interaction.our_content ?? interaction.their_content ?? '';
    if (content) {
      // Use first 3 significant words as a topic key
      const words = content
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 3);
      if (words.length > 0) {
        const topicKey = words.join(' ');
        if (!byTopic[topicKey]) byTopic[topicKey] = { sent: 0, totalEngagement: 0 };
        byTopic[topicKey].sent += 1;
        // Use reply-received interactions as a proxy for engagement
        if (interaction.type === 'reply_received') {
          byTopic[topicKey].totalEngagement += 1;
        }
      }
    }
  }

  // Find best day
  let bestDay = 'Mon';
  let bestDayCount = 0;
  for (const [day, count] of Object.entries(byDayOfWeek)) {
    if (count > bestDayCount) {
      bestDay = day;
      bestDayCount = count;
    }
  }

  // Find best hour
  let bestHour = 9;
  let bestHourCount = 0;
  for (const [hour, count] of Object.entries(byHour)) {
    if (count > bestHourCount) {
      bestHour = Number(hour);
      bestHourCount = count;
    }
  }

  // Format topic stats and find best
  const topicStats: Record<string, { sent: number; avgEngagement: number }> = {};
  let bestTopic = '';
  let bestTopicEngagement = 0;

  for (const [topic, data] of Object.entries(byTopic)) {
    const avg = data.sent > 0 ? data.totalEngagement / data.sent : 0;
    topicStats[topic] = { sent: data.sent, avgEngagement: Math.round(avg * 100) / 100 };
    if (avg > bestTopicEngagement && data.sent >= 2) {
      bestTopic = topic;
      bestTopicEngagement = avg;
    }
  }

  return {
    byDayOfWeek,
    byHour,
    byTopic: topicStats,
    bestDay,
    bestHour,
    bestTopic: bestTopic || 'not enough data',
  };
}
