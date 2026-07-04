/**
 * Competitor Spy Reports — weekly competitive analysis.
 * Searches for competitor activity across platforms, classifies sentiment,
 * extracts themes, and generates actionable insights via LLM.
 */

import { askLLM } from '../core/llm.js';
import { getConfig } from '../core/persona.js';
import { searchPlatform } from '../core/search.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompetitorReport {
  generatedAt: string;
  period: { start: string; end: string };
  competitors: Array<{
    name: string;
    mentions: number;
    sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
    topPosts: Array<{ platform: string; text: string; url: string; engagement: string }>;
    themes: string[];          // What topics they're pushing
    opportunities: string[];   // Where they're weak / where you can differentiate
  }>;
  overallInsights: string[];   // LLM analysis across all competitors
  actionItems: string[];       // Specific things to do this week
}

// ─── Platform mapping ────────────────────────────────────────────────────────

const PLATFORM_SITES: Record<string, 'x.com' | 'reddit.com' | 'news.ycombinator.com' | 'producthunt.com' | 'linkedin.com'> = {
  x: 'x.com',
  reddit: 'reddit.com',
  hackernews: 'news.ycombinator.com',
  producthunt: 'producthunt.com',
  linkedin: 'linkedin.com',
};

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Generate a full competitive analysis report across all configured competitors.
 * Searches X + Reddit (via Serper), classifies sentiment, extracts themes,
 * and produces actionable insights.
 */
export async function generateCompetitorReport(singleCompetitor?: string): Promise<CompetitorReport | null> {
  const config = getConfig();
  let competitors = config.competitors;

  if (competitors.length === 0) {
    console.log('  [CompReport] No competitors configured in pulse.yaml — skipping');
    return null;
  }

  if (singleCompetitor) {
    const match = competitors.find((c) => c.toLowerCase() === singleCompetitor.toLowerCase());
    if (!match) {
      console.log(`  [CompReport] Competitor "${singleCompetitor}" not found in config`);
      return null;
    }
    competitors = [match];
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);

  const report: CompetitorReport = {
    generatedAt: now.toISOString(),
    period: {
      start: weekAgo.toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
    },
    competitors: [],
    overallInsights: [],
    actionItems: [],
  };

  // Collect mentions for each competitor
  for (const competitor of competitors) {
    console.log(`  [CompReport] Analyzing ${competitor}...`);

    const allMentions: Array<{ platform: string; text: string; url: string }> = [];

    // Search X and Reddit via Serper
    const searchPlatforms: Array<{ name: string; site: 'x.com' | 'reddit.com' }> = [
      { name: 'x', site: 'x.com' },
      { name: 'reddit', site: 'reddit.com' },
    ];

    for (const { name, site } of searchPlatforms) {
      const results = await searchPlatform(site, `"${competitor}"`, {
        num: 10,
        timeFilter: 'qdr:w',
      });

      for (const r of results) {
        allMentions.push({
          platform: name,
          text: `${r.title} — ${r.snippet}`,
          url: r.url,
        });
      }
    }

    if (allMentions.length === 0) {
      report.competitors.push({
        name: competitor,
        mentions: 0,
        sentiment: 'neutral',
        topPosts: [],
        themes: [],
        opportunities: ['No recent mentions found — they may be losing visibility'],
      });
      continue;
    }

    // Ask LLM to analyze all mentions for this competitor
    const mentionTexts = allMentions
      .slice(0, 10)
      .map((m, i) => `${i + 1}. [${m.platform}] ${m.text}`)
      .join('\n');

    const analysisPrompt = `Analyze these ${allMentions.length} social media mentions of "${competitor}" (a competitor to ${config.persona.brandName}).

Mentions:
${mentionTexts}

Return ONLY a JSON object (no markdown fences):
{
  "overallSentiment": "positive|negative|neutral|mixed",
  "themes": ["theme1", "theme2", "theme3"],
  "opportunities": ["opportunity1", "opportunity2"],
  "topPostIndexes": [1, 2, 3],
  "engagementNotes": ["note about post 1", "note about post 2", "note about post 3"]
}

"themes" = recurring topics they're pushing (3-5 themes).
"opportunities" = weaknesses or gaps where ${config.persona.brandName} can differentiate (2-3 items).
"topPostIndexes" = indexes of the 3 most notable posts (by engagement signals or controversy).
"engagementNotes" = brief engagement description for each top post (e.g., "lots of discussion", "negative reactions").`;

    const analysisRaw = await askLLM(analysisPrompt, { maxTokens: 500, temperature: 0.3 });
    const analysis = parseAnalysis(analysisRaw);

    // Build top posts list
    const topPosts = (analysis.topPostIndexes ?? [1, 2, 3])
      .filter((idx: number) => idx >= 1 && idx <= allMentions.length)
      .map((idx: number, i: number) => {
        const m = allMentions[idx - 1];
        return {
          platform: m.platform,
          text: m.text.slice(0, 300),
          url: m.url,
          engagement: analysis.engagementNotes?.[i] ?? 'unknown',
        };
      });

    report.competitors.push({
      name: competitor,
      mentions: allMentions.length,
      sentiment: analysis.overallSentiment ?? 'neutral',
      topPosts,
      themes: analysis.themes ?? [],
      opportunities: analysis.opportunities ?? [],
    });
  }

  // Generate cross-competitor insights
  if (report.competitors.length > 0) {
    const { insights, actions } = await generateOverallInsights(report, config.persona.brandName);
    report.overallInsights = insights;
    report.actionItems = actions;
  }

  return report;
}

// ─── LLM Helpers ─────────────────────────────────────────────────────────────

interface AnalysisResult {
  overallSentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
  themes?: string[];
  opportunities?: string[];
  topPostIndexes?: number[];
  engagementNotes?: string[];
}

function parseAnalysis(raw: string | null): AnalysisResult {
  if (!raw) return {};
  try {
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    return JSON.parse(jsonStr) as AnalysisResult;
  } catch {
    return {};
  }
}

async function generateOverallInsights(
  report: CompetitorReport,
  brandName: string
): Promise<{ insights: string[]; actions: string[] }> {
  const summary = report.competitors
    .map((c) => `- ${c.name}: ${c.mentions} mentions, sentiment=${c.sentiment}, themes=[${c.themes.join(', ')}]`)
    .join('\n');

  const prompt = `You are a competitive strategist for ${brandName}. Here is a weekly competitor summary:

${summary}

Based on this data, provide:
1. 3-5 overall insights about the competitive landscape
2. 3-5 specific action items for this week

Return ONLY a JSON object (no markdown fences):
{
  "insights": ["insight1", "insight2", "insight3"],
  "actions": ["action1", "action2", "action3"]
}

Be specific and actionable — no vague advice.`;

  const raw = await askLLM(prompt, { maxTokens: 500, temperature: 0.5 });
  if (!raw) return { insights: [], actions: [] };

  try {
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    const parsed = JSON.parse(jsonStr) as { insights?: string[]; actions?: string[] };
    return {
      insights: parsed.insights ?? [],
      actions: parsed.actions ?? [],
    };
  } catch {
    return { insights: [], actions: [] };
  }
}

// ─── Formatters ──────────────────────────────────────────────────────────────

/**
 * Format report for terminal display with ANSI colors.
 */
export function formatReportTerminal(report: CompetitorReport): string {
  const lines: string[] = [];
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';
  const cyan = '\x1b[36m';
  const reset = '\x1b[0m';

  lines.push(`\n${bold}COMPETITOR SPY REPORT${reset}`);
  lines.push(`${dim}Period: ${report.period.start} to ${report.period.end}${reset}`);
  lines.push(`${dim}Generated: ${report.generatedAt}${reset}\n`);

  const sentimentColor: Record<string, string> = {
    positive: green,
    negative: red,
    neutral: dim,
    mixed: yellow,
  };

  for (const comp of report.competitors) {
    const sColor = sentimentColor[comp.sentiment] ?? dim;
    lines.push(`${bold}${cyan}${comp.name}${reset}`);
    lines.push(`  Mentions: ${comp.mentions}  |  Sentiment: ${sColor}${comp.sentiment}${reset}`);

    if (comp.themes.length > 0) {
      lines.push(`  Themes: ${comp.themes.join(', ')}`);
    }

    if (comp.topPosts.length > 0) {
      lines.push(`  Top posts:`);
      for (const post of comp.topPosts) {
        lines.push(`    [${post.platform}] ${post.text.slice(0, 100)}...`);
        lines.push(`    ${dim}${post.url} (${post.engagement})${reset}`);
      }
    }

    if (comp.opportunities.length > 0) {
      lines.push(`  ${green}Opportunities:${reset}`);
      for (const opp of comp.opportunities) {
        lines.push(`    - ${opp}`);
      }
    }

    lines.push('');
  }

  if (report.overallInsights.length > 0) {
    lines.push(`${bold}INSIGHTS${reset}`);
    for (const insight of report.overallInsights) {
      lines.push(`  - ${insight}`);
    }
    lines.push('');
  }

  if (report.actionItems.length > 0) {
    lines.push(`${bold}${green}ACTION ITEMS${reset}`);
    for (const action of report.actionItems) {
      lines.push(`  - ${action}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format report as clean markdown for saving to file.
 */
export function formatReportMarkdown(report: CompetitorReport): string {
  const lines: string[] = [];

  lines.push(`# Competitor Report`);
  lines.push(`**Period:** ${report.period.start} to ${report.period.end}`);
  lines.push(`**Generated:** ${report.generatedAt}\n`);

  for (const comp of report.competitors) {
    lines.push(`## ${comp.name}`);
    lines.push(`- **Mentions:** ${comp.mentions}`);
    lines.push(`- **Sentiment:** ${comp.sentiment}`);

    if (comp.themes.length > 0) {
      lines.push(`- **Themes:** ${comp.themes.join(', ')}`);
    }

    if (comp.topPosts.length > 0) {
      lines.push(`\n### Top Posts`);
      for (const post of comp.topPosts) {
        lines.push(`- **[${post.platform}]** ${post.text}`);
        lines.push(`  - URL: ${post.url}`);
        lines.push(`  - Engagement: ${post.engagement}`);
      }
    }

    if (comp.opportunities.length > 0) {
      lines.push(`\n### Opportunities`);
      for (const opp of comp.opportunities) {
        lines.push(`- ${opp}`);
      }
    }

    lines.push('');
  }

  if (report.overallInsights.length > 0) {
    lines.push(`## Overall Insights`);
    for (const insight of report.overallInsights) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }

  if (report.actionItems.length > 0) {
    lines.push(`## Action Items`);
    for (const action of report.actionItems) {
      lines.push(`- [ ] ${action}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
