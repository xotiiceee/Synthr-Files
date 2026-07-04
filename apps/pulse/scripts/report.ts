/**
 * Generate PULSE analytics report.
 * Usage: npx tsx scripts/report.ts [--period=day|week|month] [--save]
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'report')) process.exit(0);

import { printReport, saveReportMarkdown } from '../src/analytics/reporter.js';

// ─── CLI Parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

let period: 'day' | 'week' | 'month' = 'week';
let save = false;

for (const arg of args) {
  if (arg.startsWith('--period=')) {
    const val = arg.split('=')[1];
    if (val === 'day' || val === 'week' || val === 'month') {
      period = val;
    } else {
      console.error(`Invalid period: ${val}. Use day, week, or month.`);
      process.exit(1);
    }
  }
  if (arg === '--save') {
    save = true;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

printReport(period);

if (save) {
  const filePath = saveReportMarkdown(period);
  console.log(`\nReport saved to: ${filePath}`);
}
