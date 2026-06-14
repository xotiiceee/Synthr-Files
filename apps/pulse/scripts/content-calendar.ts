/**
 * Generate a PULSE content calendar.
 * Usage: npx tsx scripts/content-calendar.ts [--days=N]
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'calendar')) process.exit(0);

import { generateContentCalendar, type ContentDay } from '../src/intelligence/content-generator.js';

// ─── CLI Parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

let days = 7;
for (const arg of args) {
  if (arg.startsWith('--days=')) {
    const val = parseInt(arg.split('=')[1], 10);
    if (val > 0 && val <= 90) {
      days = val;
    } else {
      console.error('Invalid --days value. Use 1-90.');
      process.exit(1);
    }
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const dayName = DAY_NAMES[d.getDay()];
  const month = MONTH_NAMES[d.getMonth()];
  const day = d.getDate();
  return `${dayName}, ${month} ${day}`;
}

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    x: 'X',
    reddit: 'Reddit',
    hackernews: 'HN',
    producthunt: 'PH',
    linkedin: 'LinkedIn',
    discord: 'Discord',
  };
  return labels[platform] || platform;
}

function printCalendar(calendar: ContentDay[]): void {
  if (calendar.length === 0) {
    console.log('  No content days generated.');
    return;
  }

  const startDate = formatDate(calendar[0].date).split(', ')[1];
  const endDate = new Date(calendar[calendar.length - 1].date);
  const endStr = `${MONTH_NAMES[endDate.getMonth()]} ${endDate.getDate()}, ${endDate.getFullYear()}`;

  console.log('');
  console.log('='.repeat(45));
  console.log('  PULSE Content Calendar');
  console.log(`  ${startDate} - ${endStr}`);
  console.log('='.repeat(45));

  for (const day of calendar) {
    console.log('');
    console.log(`  ${formatDate(day.date)}`);

    if (day.posts.length === 0) {
      console.log('    (rest day)');
      continue;
    }

    for (let i = 0; i < day.posts.length; i++) {
      const post = day.posts[i];
      const connector = i === day.posts.length - 1 ? '\u2514\u2500' : '\u251C\u2500';
      const label = platformLabel(post.platform);
      // Truncate draft to 60 chars for display
      const preview = post.draft.length > 60 ? post.draft.slice(0, 57) + '...' : post.draft;
      console.log(`    ${connector} [${label}] ${post.type}: "${preview}"`);
    }
  }

  console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\nGenerating ${days}-day content calendar...\n`);

  const calendar = await generateContentCalendar(days);
  printCalendar(calendar);

  console.log(`  Total posts: ${calendar.reduce((sum, d) => sum + d.posts.length, 0)}`);
  console.log('');
}

main().catch((err) => {
  console.error('Content calendar error:', err.message || err);
  process.exit(1);
});
