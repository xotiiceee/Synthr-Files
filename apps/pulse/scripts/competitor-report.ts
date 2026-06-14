/**
 * Competitor Spy Report CLI.
 * Usage:
 *   npx tsx scripts/competitor-report.ts                  # Full report
 *   npx tsx scripts/competitor-report.ts --save           # Save as markdown
 *   npx tsx scripts/competitor-report.ts --competitor=X   # Single competitor
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'competitors')) process.exit(0);

import fs from 'fs';
import path from 'path';
import {
  generateCompetitorReport,
  formatReportTerminal,
  formatReportMarkdown,
} from '../src/intelligence/competitor-reports.js';

// ─── CLI Parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

let save = false;
let competitor: string | undefined;

for (const arg of args) {
  if (arg === '--save') {
    save = true;
  } else if (arg.startsWith('--competitor=')) {
    competitor = arg.split('=')[1];
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Competitor Spy Report — weekly competitive analysis

Usage:
  npx tsx scripts/competitor-report.ts                  Generate full report
  npx tsx scripts/competitor-report.ts --save           Save as markdown
  npx tsx scripts/competitor-report.ts --competitor=X   Single competitor

Competitors are configured in pulse.yaml under "competitors".
`);
    process.exit(0);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Generating competitor report...\n');

  const report = await generateCompetitorReport(competitor);

  if (!report) {
    console.log('No report generated. Check that competitors are configured in pulse.yaml.');
    process.exit(1);
  }

  // Always print to terminal
  console.log(formatReportTerminal(report));

  // Optionally save as markdown
  if (save) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const dir = path.join(process.cwd(), 'data', 'competitor-reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `report-${dateStr}.md`);
    fs.writeFileSync(filePath, formatReportMarkdown(report));
    console.log(`Report saved to: ${filePath}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
