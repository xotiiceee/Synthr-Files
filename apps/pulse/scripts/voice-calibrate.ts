/**
 * Voice Calibration CLI for PULSE.
 * Usage:
 *   npx tsx scripts/voice-calibrate.ts              Auto-calibrate from recent posts
 *   npx tsx scripts/voice-calibrate.ts --samples=N  Use N sample posts (default 10)
 *   npx tsx scripts/voice-calibrate.ts --manual      Enter sample posts manually
 *   npx tsx scripts/voice-calibrate.ts --show        Show current voice fingerprint
 *   npx tsx scripts/voice-calibrate.ts --reset       Reset to defaults
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'voice-calibrate')) process.exit(0);

import readline from 'readline';
import { getActions, saveState } from '../src/core/state.js';
import {
  calibrateVoice,
  loadVoice,
  type VoiceFingerprint,
  DEFAULT_VOICE,
} from '../src/intelligence/human-behavior.js';

// ─── Formatting Helpers ─────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function displayFingerprint(voice: VoiceFingerprint): void {
  console.log('');
  console.log(`  ${BOLD}Voice Fingerprint Calibrated${RESET}`);
  console.log('  ════════════════════════════');
  console.log(`  Catchphrases:    ${voice.catchphrases.length > 0 ? voice.catchphrases.map(c => `"${c}"`).join(', ') : `${DIM}(none)${RESET}`}`);
  console.log(`  Emoji Use:       ${voice.emojiFrequency}${voice.favoriteEmojis.length > 0 ? ` (${voice.favoriteEmojis.join(' ')})` : ''}`);
  console.log(`  Cap Style:       ${voice.capStyle}`);
  console.log(`  Humor:           ${voice.humorStyle}`);
  console.log(`  Sentence Style:  ${voice.sentenceStyle}`);
  console.log(`  Casualness:      ${voice.casualtyLevel}/1.0`);
  console.log(`  Anecdotes:       ${Math.round(voice.anecdoteFrequency * 100)}% of posts`);
  if (voice.punctuationQuirks.length > 0) {
    console.log(`  Punctuation:     ${voice.punctuationQuirks.join('; ')}`);
  }
  if (voice.strongOpinions.length > 0) {
    console.log(`  Strong Opinions: ${CYAN}${voice.strongOpinions.length} detected${RESET}`);
    for (const op of voice.strongOpinions) {
      console.log(`    ${DIM}- ${op}${RESET}`);
    }
  } else {
    console.log(`  Strong Opinions: ${DIM}(none detected)${RESET}`);
  }
  console.log('');
}

// ─── Modes ──────────────────────────────────────────────────────────────────

async function showMode(): Promise<void> {
  const voice = loadVoice();
  console.log('');
  console.log(`  ${BOLD}Current Voice Fingerprint${RESET}`);
  console.log('  ════════════════════════');
  displayFingerprint(voice);
}

async function resetMode(): Promise<void> {
  saveState('voice', null);
  console.log('');
  console.log(`  ${GREEN}Voice fingerprint reset to defaults.${RESET}`);
  displayFingerprint(DEFAULT_VOICE);
}

async function manualMode(): Promise<void> {
  console.log('');
  console.log(`  ${BOLD}Manual Voice Calibration${RESET}`);
  console.log('  ════════════════════════');
  console.log('');
  console.log(`  Paste your sample posts one at a time.`);
  console.log(`  Press ${CYAN}Enter twice${RESET} after each post to confirm it.`);
  console.log(`  Type ${CYAN}done${RESET} when finished (minimum 5 posts).`);
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const samples: string[] = [];

  const collectPosts = (): Promise<void> => {
    return new Promise((resolve) => {
      let lines: string[] = [];
      let emptyCount = 0;

      const promptNext = (): void => {
        const num = samples.length + 1;
        console.log(`  ${DIM}--- Post #${num} (Enter twice to confirm, "done" to finish) ---${RESET}`);
      };

      promptNext();

      rl.on('line', (line) => {
        if (line.trim().toLowerCase() === 'done') {
          // Save any pending content
          const content = lines.join('\n').trim();
          if (content) samples.push(content);
          rl.close();
          resolve();
          return;
        }

        if (line === '') {
          emptyCount++;
          if (emptyCount >= 2) {
            const content = lines.join('\n').trim();
            if (content) {
              samples.push(content);
              console.log(`  ${GREEN}Post #${samples.length} saved${RESET} (${content.length} chars)\n`);
            }
            lines = [];
            emptyCount = 0;
            promptNext();
            return;
          }
        } else {
          if (emptyCount === 1) lines.push('');
          emptyCount = 0;
        }
        lines.push(line);
      });

      rl.on('close', () => {
        const content = lines.join('\n').trim();
        if (content) samples.push(content);
        resolve();
      });
    });
  };

  await collectPosts();

  if (samples.length < 5) {
    console.log(`\n  ${YELLOW}Only ${samples.length} posts collected -- need at least 5 to calibrate.${RESET}`);
    console.log(`  ${DIM}Voice fingerprint unchanged.${RESET}\n`);
    return;
  }

  console.log(`\n  ${MAGENTA}Calibrating from ${samples.length} sample posts...${RESET}\n`);
  const voice = await calibrateVoice(samples);
  displayFingerprint(voice);
}

async function autoMode(sampleCount: number): Promise<void> {
  console.log('');
  console.log(`  ${BOLD}Auto Voice Calibration${RESET}`);
  console.log('  ══════════════════════');
  console.log('');

  const actions = getActions();
  const posts = actions
    .filter((a) => a.type === 'post')
    .map((a) => a.content)
    .filter((c) => c && c.trim().length > 0);

  if (posts.length === 0) {
    console.log(`  ${YELLOW}No posts found in action history.${RESET}`);
    console.log(`  ${DIM}Use --manual to paste sample posts instead.${RESET}\n`);
    return;
  }

  // Take the last N posts
  const samples = posts.slice(-sampleCount);

  if (samples.length < 5) {
    console.log(`  ${YELLOW}Only ${samples.length} posts found -- need at least 5 to calibrate.${RESET}`);
    console.log(`  ${DIM}Post more content first, or use --manual to paste samples.${RESET}\n`);
    return;
  }

  console.log(`  ${DIM}Found ${posts.length} posts in history, using last ${samples.length} for calibration.${RESET}\n`);
  console.log(`  ${MAGENTA}Calibrating...${RESET}\n`);

  const voice = await calibrateVoice(samples);
  displayFingerprint(voice);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--show')) {
    await showMode();
    return;
  }

  if (args.includes('--reset')) {
    await resetMode();
    return;
  }

  if (args.includes('--manual')) {
    await manualMode();
    return;
  }

  // Auto mode — parse --samples=N
  let sampleCount = 10;
  const samplesArg = args.find((a) => a.startsWith('--samples='));
  if (samplesArg) {
    const n = parseInt(samplesArg.split('=')[1], 10);
    if (!isNaN(n) && n > 0) sampleCount = n;
  }

  await autoMode(sampleCount);
}

main().catch((err) => {
  console.error(`\n  ${YELLOW}Error:${RESET} ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
