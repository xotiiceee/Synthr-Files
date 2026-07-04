/**
 * Report generator — terminal + markdown reports for PULSE activity.
 */

import fs from 'fs';
import path from 'path';
import { getStats, type Stats } from './tracker.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function periodLabel(period: 'day' | 'week' | 'month'): string {
  const now = new Date();
  switch (period) {
    case 'day':
      return now.toISOString().slice(0, 10);
    case 'week': {
      const weekAgo = new Date(now.getTime() - 7 * 86400_000);
      return `${weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    case 'month': {
      const monthAgo = new Date(now.getTime() - 30 * 86400_000);
      return `${monthAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
  }
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

function padNum(n: number, len: number): string {
  return String(n).padStart(len);
}

function platformBreakdown(byPlatform: Record<string, number>): string {
  const parts = Object.entries(byPlatform)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p}: ${n}`);
  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

// ─── Terminal Report ────────────────────────────────────────────────────────

export function generateReport(period: 'day' | 'week' | 'month'): string {
  const stats = getStats(period);
  const label = periodLabel(period);
  const periodName = period === 'day' ? 'Daily' : period === 'week' ? 'Weekly' : 'Monthly';

  const replies = stats.byType['reply'] ?? 0;
  const posts = stats.byType['post'] ?? 0;
  const likes = stats.byType['like'] ?? 0;

  const lines: string[] = [
    '',
    '\u2550'.repeat(50),
    `  PULSE ${periodName} Report -- ${label}`,
    '\u2550'.repeat(50),
    '',
    '  ACTIVITY',
    '  ' + '\u2500'.repeat(40),
    `  ${pad('Total actions:', 28)}${padNum(stats.totalActions, 6)}`,
    `  ${pad('Replies posted:', 28)}${padNum(replies, 6)}  ${platformBreakdown(stats.byPlatform)}`,
    `  ${pad('Original posts:', 28)}${padNum(posts, 6)}`,
    `  ${pad('Likes given:', 28)}${padNum(likes, 6)}`,
    '',
    '  ENGAGEMENT',
    '  ' + '\u2500'.repeat(40),
    `  ${pad('Avg engagement/action:', 28)}${padNum(stats.avgEngagement, 6)}`,
    `  ${pad('Best topic:', 28)}  ${stats.bestTopic}`,
    `  ${pad('Worst topic:', 28)}  ${stats.worstTopic}`,
    '',
    '  PLATFORMS',
    '  ' + '\u2500'.repeat(40),
  ];

  for (const [platform, count] of Object.entries(stats.byPlatform).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${pad(platform + ':', 28)}${padNum(count, 6)}`);
  }

  if (Object.keys(stats.byPlatform).length === 0) {
    lines.push('  No platform activity recorded.');
  }

  lines.push('');
  lines.push('  TOPICS');
  lines.push('  ' + '\u2500'.repeat(40));

  const topTopics = Object.entries(stats.byTopic)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [topic, count] of topTopics) {
    lines.push(`  ${pad(topic + ':', 28)}${padNum(count, 6)}`);
  }

  if (topTopics.length === 0) {
    lines.push('  No topic activity recorded.');
  }

  lines.push('');
  lines.push('\u2550'.repeat(50));
  lines.push('');

  return lines.join('\n');
}

// ─── Print to Terminal ──────────────────────────────────────────────────────

export function printReport(period: 'day' | 'week' | 'month'): void {
  console.log(generateReport(period));
}

// ─── Save as Markdown ───────────────────────────────────────────────────────

export function saveReportMarkdown(period: 'day' | 'week' | 'month'): string {
  const stats = getStats(period);
  const label = periodLabel(period);
  const periodName = period === 'day' ? 'Daily' : period === 'week' ? 'Weekly' : 'Monthly';

  const replies = stats.byType['reply'] ?? 0;
  const posts = stats.byType['post'] ?? 0;
  const likes = stats.byType['like'] ?? 0;

  const lines: string[] = [
    `# PULSE ${periodName} Report`,
    `**Period:** ${label}`,
    `**Generated:** ${new Date().toISOString()}`,
    '',
    '## Activity',
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total actions | ${stats.totalActions} |`,
    `| Replies posted | ${replies} |`,
    `| Original posts | ${posts} |`,
    `| Likes given | ${likes} |`,
    '',
    '## Engagement',
    `- **Avg engagement/action:** ${stats.avgEngagement}`,
    `- **Best topic:** ${stats.bestTopic}`,
    `- **Worst topic:** ${stats.worstTopic}`,
    '',
    '## Platform Breakdown',
    `| Platform | Actions |`,
    `|----------|---------|`,
  ];

  for (const [platform, count] of Object.entries(stats.byPlatform).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${platform} | ${count} |`);
  }

  lines.push('');
  lines.push('## Top Topics');
  lines.push(`| Topic | Actions |`);
  lines.push(`|-------|---------|`);

  for (const [topic, count] of Object.entries(stats.byTopic).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    lines.push(`| ${topic} | ${count} |`);
  }

  lines.push('');

  const markdown = lines.join('\n');

  // Save to data/reports/
  const reportsDir = path.join(process.cwd(), 'data', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const filename = `report-${period}-${new Date().toISOString().slice(0, 10)}.md`;
  const filepath = path.join(reportsDir, filename);
  fs.writeFileSync(filepath, markdown);

  console.log(`Report saved: ${filepath}`);
  return filepath;
}
