/**
 * AI Weekly Strategy Brief.
 * Collects all activity data from the past week, sends to LLM for deep analysis,
 * and generates a structured strategy report with actionable recommendations.
 * Can output as HTML email, terminal text, or save to data/weekly-insights/.
 */

import fs from 'fs';
import path from 'path';
import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';
import { getActions } from '../core/state.js';
import { getLeadStats, getHotLeads } from '../crm/leads.js';
import { getRecentInteractions } from '../crm/interactions.js';
import { getROIStats } from '../analytics/roi.js';
import { loadAdaptationState } from '../core/state.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WeeklyInsight {
  period: { start: string; end: string };
  highlights: string[];
  metrics: {
    totalActions: number;
    repliesSent: number;
    contentPublished: number;
    newLeads: number;
    hotLeads: number;
    conversionRate: number;
  };
  topPerformingContent: string[];
  underperformingAreas: string[];
  recommendations: string[];
  competitorActivity: string[];
  trendingTopics: string[];
  aiAnalysis: string;
}

// ─── Data Collection ─────────────────────────────────────────────────────────

function getWeekBounds(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400_000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function collectWeekData() {
  const { start } = getWeekBounds();
  const sinceISO = new Date(start).toISOString();

  const actions = getActions(sinceISO);
  const leadStats = getLeadStats();
  const hotLeads = getHotLeads(10);
  const interactions = getRecentInteractions(200).filter(
    (i) => i.createdAt >= sinceISO
  );
  const roiStats = getROIStats('week');
  const adaptationState = loadAdaptationState();

  const repliesSent = actions.filter((a) => a.type === 'reply').length;
  const contentPublished = actions.filter((a) => a.type === 'post').length;

  // Sort actions by engagement score (descending)
  const actionsWithEngagement = actions
    .filter((a) => a.engagement)
    .sort((a, b) => {
      const scoreA =
        (a.engagement?.likes ?? 0) +
        (a.engagement?.replies ?? 0) * 3 +
        (a.engagement?.reposts ?? 0) * 2;
      const scoreB =
        (b.engagement?.likes ?? 0) +
        (b.engagement?.replies ?? 0) * 3 +
        (b.engagement?.reposts ?? 0) * 2;
      return scoreB - scoreA;
    });

  return {
    actions,
    leadStats,
    hotLeads,
    interactions,
    roiStats,
    adaptationState,
    repliesSent,
    contentPublished,
    actionsWithEngagement,
  };
}

// ─── LLM Analysis ────────────────────────────────────────────────────────────

function buildAnalysisPrompt(data: ReturnType<typeof collectWeekData>): string {
  const config = getConfig();
  const persona = getPersonaPrompt();
  const period = getWeekBounds();

  const topContent = data.actionsWithEngagement
    .slice(0, 5)
    .map(
      (a, i) =>
        `${i + 1}. [${a.platform}/${a.type}] "${a.content.slice(0, 120)}..." — ${a.engagement?.likes ?? 0} likes, ${a.engagement?.replies ?? 0} replies, ${a.engagement?.reposts ?? 0} reposts`
    )
    .join('\n');

  const actionsByPlatform: Record<string, number> = {};
  const actionsByType: Record<string, number> = {};
  for (const a of data.actions) {
    actionsByPlatform[a.platform] = (actionsByPlatform[a.platform] ?? 0) + 1;
    actionsByType[a.type] = (actionsByType[a.type] ?? 0) + 1;
  }

  return `You are a marketing strategist analyzing a week of AI-driven marketing activity.

BRAND CONTEXT:
${persona}
Niche: ${config.persona.niche}
Competitors: ${config.competitors.join(', ') || 'none listed'}

PERIOD: ${period.start} to ${period.end}

ACTIVITY SUMMARY:
- Total actions: ${data.actions.length}
- Replies sent: ${data.repliesSent}
- Content published: ${data.contentPublished}
- By platform: ${JSON.stringify(actionsByPlatform)}
- By type: ${JSON.stringify(actionsByType)}

LEAD STATS:
- Total leads: ${data.leadStats.total}
- New: ${data.leadStats.new}, Warm: ${data.leadStats.warm}, Hot: ${data.leadStats.hot}
- Customers: ${data.leadStats.customer}
- Average score: ${data.leadStats.avgScore}

HOT LEADS (top 10):
${data.hotLeads.map((l) => `- @${l.username} (${l.platform}) — score ${l.score}, ${l.interactionCount} interactions`).join('\n') || 'None yet'}

ROI:
- Total clicks: ${data.roiStats.totalClicks}
- Conversions: ${data.roiStats.totalConversions}
- Conversion rate: ${data.roiStats.conversionRate}%
- Revenue: $${data.roiStats.totalRevenue}
- Top platform: ${data.roiStats.topPlatform}

TOP PERFORMING CONTENT:
${topContent || 'No engagement data yet'}

ADAPTATION STATE:
- Retired topics: ${data.adaptationState.retiredTopics.join(', ') || 'none'}
- Added topics: ${data.adaptationState.addedTopics.map((t) => t.query).join(', ') || 'none'}
- Tone adjustments: ${data.adaptationState.toneAdjustments.join(', ') || 'none'}
- Best time slots: ${data.adaptationState.bestTimeSlots.join(', ') || 'unknown'}
- Previous insights: ${data.adaptationState.insights.join('; ') || 'none'}

Respond in EXACTLY this JSON format (no markdown, no code blocks):
{
  "highlights": ["win 1", "win 2", "win 3"],
  "topPerformingContent": ["description of best content 1", "description 2", "description 3"],
  "underperformingAreas": ["area 1", "area 2"],
  "recommendations": ["specific action 1", "specific action 2", "specific action 3", "specific action 4", "specific action 5"],
  "competitorActivity": ["observation 1", "observation 2"],
  "trendingTopics": ["topic 1", "topic 2", "topic 3"],
  "aiAnalysis": "2-3 paragraph strategic analysis of the week. Be specific about what worked, what didn't, and why. Reference actual numbers. End with the single most important thing to focus on next week."
}

Be SPECIFIC and ACTIONABLE. Reference real numbers from the data. No generic advice like "post more" — say exactly what to post, when, and why.`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Collect all data from the past 7 days, send to LLM for analysis,
 * and return structured weekly insights.
 */
export async function generateWeeklyInsights(): Promise<WeeklyInsight> {
  const data = collectWeekData();
  const period = getWeekBounds();
  const prompt = buildAnalysisPrompt(data);

  const raw = await askLLM(prompt, { maxTokens: 1500, temperature: 0.5 });

  // Defaults if LLM fails
  const defaults: WeeklyInsight = {
    period,
    highlights: [`${data.actions.length} total actions this week`],
    metrics: {
      totalActions: data.actions.length,
      repliesSent: data.repliesSent,
      contentPublished: data.contentPublished,
      newLeads: data.leadStats.new,
      hotLeads: data.leadStats.hot,
      conversionRate: data.roiStats.conversionRate,
    },
    topPerformingContent: [],
    underperformingAreas: [],
    recommendations: ['Continue current strategy — not enough data yet for specific recommendations.'],
    competitorActivity: [],
    trendingTopics: [],
    aiAnalysis: 'Not enough data for AI analysis. Keep running outreach to build a data baseline.',
  };

  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw);
    return {
      period,
      highlights: parsed.highlights ?? defaults.highlights,
      metrics: defaults.metrics,
      topPerformingContent: parsed.topPerformingContent ?? [],
      underperformingAreas: parsed.underperformingAreas ?? [],
      recommendations: parsed.recommendations ?? defaults.recommendations,
      competitorActivity: parsed.competitorActivity ?? [],
      trendingTopics: parsed.trendingTopics ?? [],
      aiAnalysis: parsed.aiAnalysis ?? defaults.aiAnalysis,
    };
  } catch {
    console.log('  [Insights] Failed to parse LLM response, using defaults');
    return defaults;
  }
}

/**
 * Format insights as an HTML email body.
 */
export function formatInsightsEmail(insights: WeeklyInsight): string {
  const config = getConfig();
  const m = insights.metrics;

  const listHtml = (items: string[]) =>
    items.length > 0
      ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
      : '<p style="color:#999;">No data yet.</p>';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; color: #333; background: #f9f9f9; }
    .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; border-radius: 12px 12px 0 0; }
    .header h1 { margin: 0 0 8px; font-size: 24px; }
    .header p { margin: 0; opacity: 0.9; font-size: 14px; }
    .content { background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
    .metric { text-align: center; padding: 16px; background: #f0f4ff; border-radius: 8px; }
    .metric .value { font-size: 28px; font-weight: 700; color: #667eea; }
    .metric .label { font-size: 12px; color: #666; margin-top: 4px; }
    h2 { font-size: 18px; color: #444; border-bottom: 2px solid #eee; padding-bottom: 8px; margin-top: 28px; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; line-height: 1.5; }
    .analysis { background: #f8f9ff; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; margin-top: 20px; line-height: 1.7; }
    .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Weekly Strategy Brief</h1>
    <p>${escapeHtml(config.persona.brandName)} | ${insights.period.start} to ${insights.period.end}</p>
  </div>
  <div class="content">
    <h2>Highlights</h2>
    ${listHtml(insights.highlights)}

    <div class="metrics">
      <div class="metric"><div class="value">${m.totalActions}</div><div class="label">Actions</div></div>
      <div class="metric"><div class="value">${m.repliesSent}</div><div class="label">Replies</div></div>
      <div class="metric"><div class="value">${m.contentPublished}</div><div class="label">Posts</div></div>
      <div class="metric"><div class="value">${m.newLeads}</div><div class="label">New Leads</div></div>
      <div class="metric"><div class="value">${m.hotLeads}</div><div class="label">Hot Leads</div></div>
      <div class="metric"><div class="value">${m.conversionRate}%</div><div class="label">Conv. Rate</div></div>
    </div>

    <h2>Top Performing Content</h2>
    ${listHtml(insights.topPerformingContent)}

    <h2>What Didn't Work</h2>
    ${listHtml(insights.underperformingAreas)}

    <h2>Recommendations for Next Week</h2>
    ${listHtml(insights.recommendations)}

    <h2>Competitor Activity</h2>
    ${listHtml(insights.competitorActivity)}

    <h2>Trending Topics</h2>
    ${listHtml(insights.trendingTopics)}

    <h2>AI Analysis</h2>
    <div class="analysis">
      ${escapeHtml(insights.aiAnalysis).split('\n').map((p) => `<p>${p}</p>`).join('')}
    </div>
  </div>
  <div class="footer">
    Generated by Pulse AI | ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
  </div>
</body>
</html>`;
}

/**
 * Format insights for terminal display.
 */
export function formatInsightsTerminal(insights: WeeklyInsight): string {
  const m = insights.metrics;
  const hr = '─'.repeat(60);
  const bullet = (items: string[]) =>
    items.length > 0
      ? items.map((i) => `  • ${i}`).join('\n')
      : '  (no data)';

  return `
${hr}
  WEEKLY STRATEGY BRIEF
  ${insights.period.start} → ${insights.period.end}
${hr}

HIGHLIGHTS
${bullet(insights.highlights)}

METRICS
  Actions: ${m.totalActions}  |  Replies: ${m.repliesSent}  |  Posts: ${m.contentPublished}
  New Leads: ${m.newLeads}  |  Hot Leads: ${m.hotLeads}  |  Conv Rate: ${m.conversionRate}%

TOP PERFORMING CONTENT
${bullet(insights.topPerformingContent)}

UNDERPERFORMING AREAS
${bullet(insights.underperformingAreas)}

RECOMMENDATIONS
${bullet(insights.recommendations)}

COMPETITOR ACTIVITY
${bullet(insights.competitorActivity)}

TRENDING TOPICS
${bullet(insights.trendingTopics)}

AI ANALYSIS
${insights.aiAnalysis.split('\n').map((p) => `  ${p}`).join('\n')}

${hr}
  Generated by Pulse AI | ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
${hr}
`;
}

/**
 * Save insights as HTML to data/weekly-insights/ and optionally send via Resend.
 * Returns true if email was sent (Resend), false if saved locally only.
 */
export async function sendInsightsEmail(
  email: string,
  insights: WeeklyInsight
): Promise<boolean> {
  const config = getConfig();
  const html = formatInsightsEmail(insights);
  const subject = `[${config.persona.brandName}] Weekly Strategy Brief — ${insights.period.start} to ${insights.period.end}`;

  // Always save locally
  const dir = path.join(process.cwd(), 'data', 'weekly-insights');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `insight-${insights.period.end}.html`;
  fs.writeFileSync(path.join(dir, filename), html);
  console.log(`  [Insights] Saved to data/weekly-insights/${filename}`);

  // Generate mailto link for manual sending
  const mailtoSubject = encodeURIComponent(subject);
  const mailtoBody = encodeURIComponent(
    `Weekly insights report saved at: data/weekly-insights/${filename}\nOpen the HTML file in a browser to view the full report.`
  );
  console.log(
    `  [Insights] mailto:${email}?subject=${mailtoSubject}&body=${mailtoBody}`
  );

  // Try Resend API if key is available.
  const resendKey = process.env.RESEND_API_KEY ?? '';
  if (!resendKey) {
    console.log(
      '  [Insights] No RESEND_API_KEY — set one to auto-send emails'
    );
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: `Pulse AI <pulse@${process.env.RESEND_DOMAIN ?? 'updates.example.com'}>`,
        to: [email],
        subject,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.log(`  [Insights] Resend error ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }

    console.log(`  [Insights] Email sent to ${email} via Resend`);
    return true;
  } catch (err) {
    console.log(
      `  [Insights] Resend failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
