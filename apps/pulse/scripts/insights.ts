/**
 * Weekly Intelligence Brief CLI for PULSE.
 * Usage:
 *   npx tsx scripts/insights.ts                      Generate and display in terminal
 *   npx tsx scripts/insights.ts --email=user@ex.com  Also send via email (if RESEND_API_KEY set)
 *   npx tsx scripts/insights.ts --save               Save HTML report to data/weekly-insights/
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'insights')) process.exit(0);

import fs from 'fs';
import path from 'path';
import {
  generateWeeklyInsights,
  formatInsightsTerminal,
  formatInsightsEmail,
  sendInsightsEmail,
} from '../src/intelligence/weekly-insights.js';

// ─── CLI Parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

let email: string | null = null;
let save = false;

for (const arg of args) {
  if (arg.startsWith('--email=')) {
    email = arg.split('=')[1];
  }
  if (arg === '--save') {
    save = true;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('\u2550'.repeat(38));
  console.log('  PULSE Weekly Intelligence Brief');
  console.log('\u2550'.repeat(38));
  console.log('');
  console.log('  Collecting data and generating insights...\n');

  const insights = await generateWeeklyInsights();

  // Always display in terminal
  console.log(formatInsightsTerminal(insights));

  // Save HTML report if requested
  if (save) {
    const dir = path.join(process.cwd(), 'data', 'weekly-insights');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filename = `insight-${insights.period.end}.html`;
    const filePath = path.join(dir, filename);
    const html = formatInsightsEmail(insights);
    fs.writeFileSync(filePath, html);
    console.log(`  Report saved to: ${filePath}\n`);
  }

  // Send email if requested
  if (email) {
    console.log(`  Sending report to ${email}...\n`);
    const sent = await sendInsightsEmail(email, insights);
    if (!sent) {
      console.log('  Email not sent — check RESEND_API_KEY or see saved HTML report.\n');
    }
  }
}

main().catch((err) => {
  console.error('Insights error:', err.message || err);
  process.exit(1);
});
