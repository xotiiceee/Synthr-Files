/**
 * Generate video scripts for YouTube, TikTok, and Instagram Reels.
 *
 * Usage:
 *   npx tsx scripts/video-scripts.ts                  # Generate 5 scripts
 *   npx tsx scripts/video-scripts.ts --count=10       # Generate 10 scripts
 *   npx tsx scripts/video-scripts.ts --platform=tiktok # TikTok only
 *   npx tsx scripts/video-scripts.ts --save            # Save to file
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'videos')) process.exit(0);

import { loadConfig } from '../src/core/persona.js';
import {
  generateVideoScript,
  generateVideoScripts,
  formatVideoScript,
  type VideoScript,
} from '../src/intelligence/video-generator.js';

async function main(): Promise<void> {
  loadConfig();

  const args = process.argv.slice(2);
  const countArg = args.find(a => a.startsWith('--count='));
  const platformArg = args.find(a => a.startsWith('--platform='));
  const save = args.includes('--save');

  const count = countArg ? parseInt(countArg.split('=')[1], 10) : 5;
  const platformFilter = platformArg?.split('=')[1] as 'youtube' | 'tiktok' | 'reels' | undefined;

  console.log('');
  console.log('═'.repeat(50));
  console.log('  PULSE Video Script Generator');
  console.log('═'.repeat(50));
  console.log('');

  let scripts: VideoScript[];

  if (platformFilter) {
    console.log(`  Generating ${count} ${platformFilter} scripts...\n`);
    scripts = [];
    const config2 = loadConfig();
    const themes = [...config2.contentThemes].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(count, themes.length); i++) {
      console.log(`  [${i + 1}/${count}] "${themes[i].slice(0, 40)}..."`);
      const script = await generateVideoScript(themes[i], platformFilter);
      if (script) scripts.push(script);
      if (i < count - 1) await new Promise(r => setTimeout(r, 2000));
    }
  } else {
    scripts = await generateVideoScripts(count);
  }

  if (scripts.length === 0) {
    console.log('  No scripts generated. Check your GROQ_API_KEY and config.\n');
    return;
  }

  // Display
  for (const script of scripts) {
    console.log(formatVideoScript(script));
  }

  // Save
  if (save) {
    const outDir = path.join(process.cwd(), 'data', 'video-scripts');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const filename = `scripts-${new Date().toISOString().slice(0, 10)}.json`;
    const outPath = path.join(outDir, filename);
    fs.writeFileSync(outPath, JSON.stringify(scripts, null, 2));
    console.log(`\n  Saved to: ${outPath}`);
  }

  console.log(`\n  Generated ${scripts.length} video scripts.\n`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
