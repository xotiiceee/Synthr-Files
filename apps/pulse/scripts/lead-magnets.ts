/**
 * Lead Magnet Generator CLI.
 *
 * Usage:
 *   npx tsx scripts/lead-magnets.ts                      # Generate all 4 types
 *   npx tsx scripts/lead-magnets.ts --type=checklist     # Just checklist
 *   npx tsx scripts/lead-magnets.ts --type=tips          # Just tips
 *   npx tsx scripts/lead-magnets.ts --type=guide         # Just guide
 *   npx tsx scripts/lead-magnets.ts --type=cheatsheet    # Just cheatsheet
 *   npx tsx scripts/lead-magnets.ts --topic="meal prep"  # Custom topic
 *   npx tsx scripts/lead-magnets.ts --save               # Save HTML files to disk
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'lead-magnets')) process.exit(0);

import { loadConfig } from '../src/core/persona.js';
import {
  generateLeadMagnet,
  generateAllLeadMagnets,
  type LeadMagnet,
  type LeadMagnetType,
} from '../src/intelligence/lead-magnet-creator.js';

// ─── Formatting ──────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const HR = '\u2500'.repeat(60);

const VALID_TYPES: LeadMagnetType[] = ['checklist', 'tips', 'guide', 'cheatsheet'];

// ─── Display ─────────────────────────────────────────────────────────────────

function displayMagnet(magnet: LeadMagnet, index: number): void {
  console.log(`  ${CYAN}${BOLD}#${index + 1} ${magnet.title}${RESET}`);
  console.log(`  ${DIM}Type: ${magnet.type} | ${magnet.wordCount} words | ${magnet.sections} sections${RESET}`);
  console.log(`  ${HR}`);

  // Show first ~20 lines of markdown content
  const lines = magnet.content.split('\n');
  const preview = lines.slice(0, 20);
  for (const line of preview) {
    console.log(`  ${line}`);
  }
  if (lines.length > 20) {
    console.log(`  ${DIM}... (${lines.length - 20} more lines)${RESET}`);
  }
  console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadConfig();

  const args = process.argv.slice(2);
  const typeArg = args.find(a => a.startsWith('--type='));
  const topicArg = args.find(a => a.startsWith('--topic='));
  const save = args.includes('--save');

  const type = typeArg?.split('=')[1] as LeadMagnetType | undefined;
  const topic = topicArg?.split('=')[1];

  if (type && !VALID_TYPES.includes(type)) {
    console.error(`\n  Invalid type "${type}". Choose: ${VALID_TYPES.join(', ')}\n`);
    process.exit(1);
  }

  console.log('');
  console.log('\u2550'.repeat(50));
  console.log(`  ${BOLD}PULSE Lead Magnet Generator${RESET}`);
  console.log('\u2550'.repeat(50));
  console.log('');

  let magnets: LeadMagnet[];

  if (type) {
    console.log(`  Generating ${type}${topic ? ` about "${topic}"` : ''}...\n`);
    const magnet = await generateLeadMagnet(type, topic);
    magnets = magnet ? [magnet] : [];
  } else {
    if (topic) {
      // Generate all types for a specific topic
      console.log(`  Generating all 4 types about "${topic}"...\n`);
      magnets = [];
      for (let i = 0; i < VALID_TYPES.length; i++) {
        const t = VALID_TYPES[i];
        console.log(`  [${i + 1}/4] Generating ${t}...`);
        const magnet = await generateLeadMagnet(t, topic);
        if (magnet) magnets.push(magnet);
        if (i < VALID_TYPES.length - 1) await new Promise(r => setTimeout(r, 2000));
      }
    } else {
      console.log('  Generating all 4 types for your niche...\n');
      magnets = await generateAllLeadMagnets();
    }
  }

  if (magnets.length === 0) {
    console.log('  No lead magnets generated. Check your GROQ_API_KEY.\n');
    process.exit(1);
  }

  // Display results
  console.log('');
  for (let i = 0; i < magnets.length; i++) {
    displayMagnet(magnets[i], i);
  }

  // Summary
  console.log(`  ${GREEN}${BOLD}Generated ${magnets.length} lead magnet(s)${RESET}`);
  const totalWords = magnets.reduce((sum, m) => sum + m.wordCount, 0);
  console.log(`  ${DIM}Total: ${totalWords} words${RESET}`);

  // Save HTML files
  if (save) {
    const outDir = path.join(process.cwd(), 'data', 'lead-magnets');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const magnet of magnets) {
      const safeName = magnet.type + '-' + new Date().toISOString().slice(0, 10);
      const htmlPath = path.join(outDir, `${safeName}.html`);
      const mdPath = path.join(outDir, `${safeName}.md`);
      fs.writeFileSync(htmlPath, magnet.htmlVersion);
      fs.writeFileSync(mdPath, magnet.content);
      console.log(`  ${YELLOW}Saved:${RESET} ${htmlPath}`);
      console.log(`  ${YELLOW}Saved:${RESET} ${mdPath}`);
    }
  } else {
    console.log(`\n  ${DIM}Tip: Add --save to write HTML files to data/lead-magnets/${RESET}`);
  }

  console.log('');
}

main().catch((err) => {
  console.error('Lead magnet error:', err.message || err);
  process.exit(1);
});
