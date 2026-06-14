/**
 * Landing Page Generator CLI.
 *
 * Usage:
 *   npx tsx scripts/landing-page.ts                    # Generate and save
 *   npx tsx scripts/landing-page.ts --style=bold       # Bold style
 *   npx tsx scripts/landing-page.ts --style=professional
 *   npx tsx scripts/landing-page.ts --preview          # Save to temp and log path
 *   npx tsx scripts/landing-page.ts --no-email         # No email capture form
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'landing-page')) process.exit(0);

import { loadConfig } from '../src/core/persona.js';
import { generateLandingPage } from '../src/intelligence/landing-page-generator.js';

// ─── Formatting ──────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadConfig();

  const args = process.argv.slice(2);
  const styleArg = args.find(a => a.startsWith('--style='));
  const preview = args.includes('--preview');
  const noEmail = args.includes('--no-email');

  const style = (styleArg?.split('=')[1] ?? 'minimal') as 'minimal' | 'bold' | 'professional';
  const validStyles = ['minimal', 'bold', 'professional'];
  if (!validStyles.includes(style)) {
    console.error(`\n  Invalid style "${style}". Choose: ${validStyles.join(', ')}\n`);
    process.exit(1);
  }

  console.log('');
  console.log('\u2550'.repeat(50));
  console.log(`  ${BOLD}PULSE Landing Page Generator${RESET}`);
  console.log('\u2550'.repeat(50));
  console.log('');
  console.log(`  Style: ${style}`);
  console.log(`  Email form: ${noEmail ? 'no' : 'yes'}`);
  console.log('');

  const html = await generateLandingPage({ style, includeEmail: !noEmail });

  if (!html) {
    console.log('  Generation failed. Check your GROQ_API_KEY.\n');
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);

  if (preview) {
    // Save to temp directory and log path
    const tmpPath = path.join(os.tmpdir(), `pulse-landing-${date}.html`);
    fs.writeFileSync(tmpPath, html);
    console.log(`  ${GREEN}${BOLD}Preview ready!${RESET}`);
    console.log(`  Open in browser: ${tmpPath}`);
    console.log('');
  }

  // Always save to data/landing-pages/
  const outDir = path.join(process.cwd(), 'data', 'landing-pages');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filename = `landing-page-${date}.html`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, html);

  const sizeKb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`  ${GREEN}Saved:${RESET} ${outPath}`);
  console.log(`  ${DIM}Size: ${sizeKb} KB | Self-contained HTML, no dependencies${RESET}`);
  console.log('');
}

main().catch((err) => {
  console.error('Landing page error:', err.message || err);
  process.exit(1);
});
