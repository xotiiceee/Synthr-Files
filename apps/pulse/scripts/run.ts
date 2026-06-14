/**
 * Main entry point for PULSE.
 * Parses CLI flags and runs the appropriate mode.
 *
 * Usage:
 *   npx tsx scripts/run.ts                    # Full auto (draft mode — default)
 *   npx tsx scripts/run.ts --outreach         # Outreach only (drafts)
 *   npx tsx scripts/run.ts --outreach --auto  # Outreach with auto-posting (use with caution)
 *   npx tsx scripts/run.ts --content          # Content only
 *   npx tsx scripts/run.ts --monitor          # Monitor only
 *   npx tsx scripts/run.ts --dry-run          # Preview without any actions
 *
 * IMPORTANT: Outreach defaults to DRAFT mode — finds conversations and generates
 * reply suggestions saved to data/outreach-drafts.json. Review and post manually.
 * Use --auto to enable automatic posting (risk of account restrictions on some platforms).
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'run')) process.exit(0);

import { runOutreach } from '../src/modes/outreach.js';
import { runContent } from '../src/modes/content.js';
import { runMonitor } from '../src/modes/monitor.js';
import { runFullAuto } from '../src/modes/full-auto.js';

// ─── CLI Parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = new Set(args.map((a) => a.toLowerCase()));

const dryRun = flags.has('--dry-run');
const autoPost = flags.has('--auto');
const modeOutreach = flags.has('--outreach');
const modeContent = flags.has('--content');
const modeMonitor = flags.has('--monitor');
const modeFullAuto = flags.has('--full-auto') || (!modeOutreach && !modeContent && !modeMonitor);

// ─── Banner ──────────────────────────────────────────────────────────────────

function printBanner(mode: string): void {
  const now = new Date().toLocaleString();
  console.log('');
  console.log('=============================================');
  console.log(`  PULSE -- ${mode}`);
  console.log(`  ${now}`);
  if (dryRun) console.log('  [DRY RUN - no actions will be taken]');
  if (autoPost) {
    console.log('  [AUTO-POST ENABLED]');
    console.log('  ⚠ Warning: Some platforms (X, Reddit) may flag');
    console.log('  automated replies. Use at your own risk.');
  } else if (!dryRun) {
    console.log('  [DRAFT MODE - replies saved for manual review]');
  }
  console.log('=============================================');
  console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (modeOutreach && !modeContent && !modeMonitor) {
    printBanner('Outreach Mode');
    const result = await runOutreach({ dryRun, autoPost });
    if (result.drafts.length > 0) {
      console.log(`\n  Drafts ready for review: data/outreach-drafts.json`);
      console.log(`  Post them manually or re-run with --auto to auto-post.\n`);
    }
  } else if (modeContent && !modeOutreach && !modeMonitor) {
    printBanner('Content Mode');
    const result = await runContent({ dryRun });
    console.log(`\nContent complete. Generated: ${result.postsGenerated}, Published: ${result.postsPublished}`);
  } else if (modeMonitor && !modeOutreach && !modeContent) {
    printBanner('Monitor Mode');
    const result = await runMonitor();
    console.log(`\nMonitor complete. Mentions: ${result.mentions.length}, Alerts: ${result.alerts.length}`);
  } else {
    printBanner('Full Auto Mode');
    await runFullAuto({ dryRun });
    console.log('\nFull auto cycle complete.');
  }
}

main().catch((err) => {
  console.error('PULSE error:', err.message || err);
  process.exit(1);
});
