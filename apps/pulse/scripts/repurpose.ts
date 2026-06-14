/**
 * Cross-Platform Content Repurposer CLI.
 *
 * Usage:
 *   npx tsx scripts/repurpose.ts "Your original content here" --from=x
 *   npx tsx scripts/repurpose.ts --file=content.txt --from=linkedin
 *   npx tsx scripts/repurpose.ts "Content here" --from=x --to=linkedin
 *   npx tsx scripts/repurpose.ts "Content here"                          # Default: from x
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'repurpose')) process.exit(0);

import { loadConfig } from '../src/core/persona.js';
import { repurposeContent } from '../src/intelligence/content-repurposer.js';

// ─── Formatting ──────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const HR = '\u2500'.repeat(60);

const PLATFORM_LABELS: Record<string, string> = {
  x: 'X (Tweet)',
  'x-thread': 'X (Thread)',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  discord: 'Discord',
  hackernews: 'Hacker News',
};

// ─── CLI Parsing ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadConfig();

  const args = process.argv.slice(2);
  const fromArg = args.find(a => a.startsWith('--from='));
  const toArg = args.find(a => a.startsWith('--to='));
  const fileArg = args.find(a => a.startsWith('--file='));
  const sourcePlatform = fromArg?.split('=')[1] ?? 'x';
  const targetPlatforms =
    toArg
      ?.split('=')[1]
      ?.split(',')
      .map((platform) => platform.trim())
      .filter(Boolean) ?? [];

  let text: string | undefined;

  if (fileArg) {
    const filePath = fileArg.split('=')[1];
    if (!fs.existsSync(filePath)) {
      console.error(`\n  File not found: ${filePath}\n`);
      process.exit(1);
    }
    text = fs.readFileSync(filePath, 'utf-8').trim();
  } else {
    // First non-flag argument is the content text
    text = args.find(a => !a.startsWith('--'));
  }

  if (!text) {
    console.log(`
  ${BOLD}PULSE Content Repurposer${RESET}

  Usage:
    npx tsx scripts/repurpose.ts "Your content here" --from=x
    npx tsx scripts/repurpose.ts --file=content.txt --from=linkedin

  Options:
    --from=<platform>    Source platform (x, reddit, linkedin, discord, hackernews)
    --to=<platforms>     Draft target platform(s), comma-separated
    --file=<path>        Read content from a file
`);
    process.exit(0);
  }

  console.log('');
  console.log('\u2550'.repeat(50));
  console.log(`  ${BOLD}PULSE Content Repurposer${RESET}`);
  console.log('\u2550'.repeat(50));
  console.log('');
  console.log(`  ${DIM}Source:${RESET} ${PLATFORM_LABELS[sourcePlatform] ?? sourcePlatform}`);
  if (targetPlatforms.length > 0) {
    const labels = targetPlatforms.map((platform) => PLATFORM_LABELS[platform] ?? platform);
    console.log(`  ${DIM}Targets:${RESET} ${labels.join(', ')}`);
  }
  console.log(`  ${DIM}Original:${RESET} "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);
  console.log('');
  console.log(
    targetPlatforms.length > 0
      ? '  Generating draft versions for selected platforms...\n'
      : '  Generating draft versions for configured platforms...\n',
  );

  const result = await repurposeContent(text, sourcePlatform, { targetPlatforms });

  if (!result || result.versions.length === 0) {
    console.log('  No versions generated. Check your GROQ_API_KEY.\n');
    process.exit(1);
  }

  // Display each version
  for (const version of result.versions) {
    const label = PLATFORM_LABELS[version.platform] ?? version.platform;
    console.log(`  ${CYAN}${BOLD}${label}${RESET} ${DIM}(${version.format}, ${version.charCount} chars)${RESET}`);
    console.log(`  ${HR}`);

    // Indent the text for readability
    const lines = version.text.split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }

    if (version.hashtags && version.hashtags.length > 0) {
      console.log(`\n  ${GREEN}Hashtags:${RESET} ${version.hashtags.join(' ')}`);
    }
    if (version.notes) {
      console.log(`  ${YELLOW}Notes:${RESET} ${version.notes}`);
    }
    console.log('');
  }

  // Save to data/repurposed/
  const outDir = path.join(process.cwd(), 'data', 'repurposed');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filename = `repurposed-${Date.now()}.json`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`  ${DIM}Saved to: ${outPath}${RESET}`);
  console.log(`  ${result.versions.length} versions generated.\n`);
}

main().catch((err) => {
  console.error('Repurpose error:', err.message || err);
  process.exit(1);
});
