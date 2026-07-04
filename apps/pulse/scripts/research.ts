/**
 * Research Tools CLI for PULSE.
 * Combines hashtag research, audience analysis, and swipe file into one CLI.
 *
 * Usage:
 *   npx tsx scripts/research.ts trending               Trending topics in your niche
 *   npx tsx scripts/research.ts hashtags <topic>        Suggest hashtags for a topic
 *   npx tsx scripts/research.ts audience                Analyze your audience from CRM data
 *   npx tsx scripts/research.ts swipe                   Build/update swipe file from best content
 *   npx tsx scripts/research.ts swipe-remix <id>        Generate new variation from swipe entry
 *   npx tsx scripts/research.ts viral                   Find viral content in your niche to model
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'research')) process.exit(0);

import { researchTrending, suggestHashtags, findViralContent } from '../src/intelligence/hashtag-research.js';
import { analyzeAudience, getEngagementPatterns } from '../src/intelligence/audience-analyzer.js';
import { buildSwipeFile, getSwipeFile, generateFromSwipe } from '../src/intelligence/swipe-file.js';
import { getConfig } from '../src/core/persona.js';

// ─── Formatting Helpers ─────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function pad(s: string, n: number): string { return s.padEnd(n); }
function rpad(s: string, n: number): string { return s.padStart(n); }
const HR = '\u2500'.repeat(60);

function platformTag(p: string): string {
  const labels: Record<string, string> = {
    x: 'X',
    reddit: 'Reddit',
    hackernews: 'HN',
    producthunt: 'PH',
    linkedin: 'LinkedIn',
    discord: 'Discord',
  };
  return labels[p] || p;
}

function sentimentColor(s: string): string {
  switch (s) {
    case 'positive': return `${GREEN}${s}${RESET}`;
    case 'negative': return `\x1b[31m${s}${RESET}`;
    case 'mixed':    return `${YELLOW}${s}${RESET}`;
    default:         return `${DIM}${s}${RESET}`;
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdTrending(): Promise<void> {
  console.log('\n  Researching trending topics...\n');

  const report = await researchTrending();

  // Trending Topics
  console.log(`  ${BOLD}TRENDING TOPICS${RESET}`);
  console.log(`  ${HR}`);

  if (report.trendingTopics.length === 0) {
    console.log('  No trending topics found. Try again later or check search API key.\n');
  } else {
    for (let i = 0; i < report.trendingTopics.length; i++) {
      const t = report.trendingTopics[i];
      console.log(`  ${rpad(String(i + 1), 3)}. [${platformTag(t.platform)}] "${t.topic}" \u2014 ${t.mentions} mentions, ${sentimentColor(t.sentiment)} sentiment`);
    }
  }

  // Suggested Content Ideas
  console.log('');
  console.log(`  ${BOLD}SUGGESTED CONTENT IDEAS${RESET}`);
  console.log(`  ${HR}`);

  if (report.suggestedContent.length === 0) {
    console.log('  No content ideas generated.\n');
  } else {
    for (const idea of report.suggestedContent) {
      console.log(`  \u2022 ${idea}`);
    }
  }

  // Hashtags
  console.log('');
  console.log(`  ${BOLD}HASHTAGS${RESET}`);
  console.log(`  ${HR}`);
  console.log(`  ${CYAN}High Volume:${RESET} ${report.hashtags.highVolume.join('  ') || '(none)'}`);
  console.log(`  ${GREEN}Niche:${RESET}       ${report.hashtags.niche.join('  ') || '(none)'}`);
  console.log(`  ${YELLOW}Emerging:${RESET}    ${report.hashtags.emerging.join('  ') || '(none)'}`);

  // Viral Posts
  if (report.viralPosts.length > 0) {
    console.log('');
    console.log(`  ${BOLD}VIRAL POSTS${RESET}`);
    console.log(`  ${HR}`);
    for (let i = 0; i < report.viralPosts.length; i++) {
      const v = report.viralPosts[i];
      console.log(`\n  #${i + 1} [${platformTag(v.platform)}] Engagement: ${v.engagement}`);
      console.log(`  ${DIM}"${v.text}"${RESET}`);
      console.log(`  Why it worked: ${v.whyItWorked}`);
      if (v.url) console.log(`  ${DIM}${v.url}${RESET}`);
    }
  }

  console.log('');
}

async function cmdHashtags(topic: string): Promise<void> {
  console.log(`\n  Researching hashtags for "${topic}"...\n`);

  const tags = await suggestHashtags(topic);

  console.log(`  ${BOLD}HASHTAGS FOR "${topic.toUpperCase()}"${RESET}`);
  console.log(`  ${HR}`);

  if (tags.length === 0) {
    console.log('  No hashtags found.\n');
    return;
  }

  // Display in rows of 5
  for (let i = 0; i < tags.length; i += 5) {
    const row = tags.slice(i, i + 5).join('  ');
    console.log(`  ${row}`);
  }

  console.log(`\n  ${tags.length} hashtag(s) suggested.\n`);
}

async function cmdAudience(): Promise<void> {
  console.log('\n  Analyzing audience...\n');

  const profile = await analyzeAudience();
  const patterns = getEngagementPatterns();

  // Audience Profile
  console.log(`  ${BOLD}AUDIENCE PROFILE${RESET}`);
  console.log(`  ${HR}`);
  console.log(`  Total leads: ${profile.totalLeads}`);

  const platformEntries = Object.entries(profile.byPlatform);
  if (platformEntries.length > 0) {
    const platformStr = platformEntries.map(([p, n]) => `${platformTag(p)} (${n})`).join(', ');
    console.log(`  By platform: ${platformStr}`);
  }

  const statusEntries = Object.entries(profile.byStatus);
  if (statusEntries.length > 0) {
    const statusStr = statusEntries.map(([s, n]) => `${s} (${n})`).join(', ');
    console.log(`  By status:   ${statusStr}`);
  }

  // Top Engagers
  if (profile.topEngagers.length > 0) {
    console.log('');
    console.log(`  ${BOLD}TOP ENGAGERS${RESET}`);
    console.log(`  ${HR}`);
    for (const e of profile.topEngagers.slice(0, 10)) {
      const prefix = e.platform === 'reddit' ? 'u/' : '@';
      console.log(`  ${prefix}${pad(e.username, 22)} (${pad(platformTag(e.platform), 8)}) \u2014 Score: ${rpad(String(e.score), 3)}, ${e.interactionCount} interactions`);
    }
  }

  // Common Traits
  if (profile.commonTraits.length > 0) {
    console.log('');
    console.log(`  ${BOLD}COMMON TRAITS${RESET}`);
    console.log(`  ${HR}`);
    for (const trait of profile.commonTraits) {
      console.log(`  \u2022 ${trait}`);
    }
  }

  // Peak Engagement
  console.log('');
  console.log(`  ${BOLD}PEAK ENGAGEMENT${RESET}`);
  console.log(`  ${HR}`);
  console.log(`  Best day:   ${patterns.bestDay}`);
  console.log(`  Best hour:  ${patterns.bestHour}:00`);
  console.log(`  Best topic: ${patterns.bestTopic}`);

  if (profile.peakEngagementTimes.length > 0) {
    console.log(`  AI times:   ${profile.peakEngagementTimes.join(', ')}`);
  }

  // Recommendations
  if (profile.recommendations.length > 0) {
    console.log('');
    console.log(`  ${BOLD}RECOMMENDATIONS${RESET}`);
    console.log(`  ${HR}`);
    for (const rec of profile.recommendations) {
      console.log(`  \u2022 ${rec}`);
    }
  }

  console.log('');
}

async function cmdSwipe(): Promise<void> {
  console.log('\n  Building swipe file from best content...\n');

  const swipe = await buildSwipeFile();

  console.log(`\n  ${BOLD}SWIPE FILE \u2014 ${swipe.entries.length} entries${RESET}`);
  console.log(`  ${HR}`);

  if (swipe.entries.length === 0) {
    console.log('  No entries yet. Run outreach first to generate content.\n');
    return;
  }

  for (let i = 0; i < swipe.entries.length; i++) {
    const e = swipe.entries[i];
    console.log(`\n  ${BOLD}#${i + 1}${RESET} [${platformTag(e.platform)}] Engagement: ${e.engagementScore}/10`);
    console.log(`  ${DIM}"${e.content.slice(0, 120)}${e.content.length > 120 ? '...' : ''}"${RESET}`);
    console.log(`  Why it worked: ${e.whyItWorked}`);
    console.log(`  Template: ${e.template}`);

    if (e.variations.length > 0) {
      console.log(`\n  Variations:`);
      for (const v of e.variations) {
        console.log(`  \u2022 "${v.slice(0, 100)}${v.length > 100 ? '...' : ''}"`);
      }
    }

    console.log(`  ${DIM}ID: ${e.id}${RESET}`);
  }

  // Patterns
  if (swipe.patterns.length > 0) {
    console.log('');
    console.log(`  ${BOLD}PATTERNS${RESET}`);
    console.log(`  ${HR}`);
    for (const p of swipe.patterns) {
      console.log(`  \u2022 ${p}`);
    }
  }

  console.log('');
}

async function cmdSwipeRemix(id: string): Promise<void> {
  console.log(`\n  Generating new variation for swipe entry ${id}...\n`);

  const variation = await generateFromSwipe(id);

  if (!variation) {
    console.log(`  Entry "${id}" not found or generation failed.\n`);
    console.log(`  Run ${BOLD}npx tsx scripts/research.ts swipe${RESET} to see available entries.\n`);
    return;
  }

  console.log(`  ${BOLD}NEW VARIATION${RESET}`);
  console.log(`  ${HR}`);
  console.log(`  ${variation}`);
  console.log(`\n  ${DIM}Saved to swipe file.${RESET}\n`);
}

async function cmdViral(): Promise<void> {
  const cfg = getConfig();
  const niche = cfg.persona.niche;

  console.log(`\n  Finding viral content in "${niche}"...\n`);

  const posts = await findViralContent(niche);

  console.log(`  ${BOLD}VIRAL CONTENT \u2014 ${niche}${RESET}`);
  console.log(`  ${HR}`);

  if (posts.length === 0) {
    console.log('  No viral content found. Try again later or check search API key.\n');
    return;
  }

  for (let i = 0; i < posts.length; i++) {
    const v = posts[i];
    console.log(`\n  ${BOLD}#${i + 1}${RESET} [${platformTag(v.platform)}] Engagement: ${v.engagement}`);
    console.log(`  ${DIM}"${v.text}"${RESET}`);
    console.log(`  Why it worked: ${v.whyItWorked}`);
    if (v.url) console.log(`  ${DIM}${v.url}${RESET}`);
  }

  console.log('');
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'trending':
      await cmdTrending();
      break;
    case 'hashtags': {
      const topic = args.slice(1).join(' ');
      if (!topic) {
        console.error('\n  Usage: npx tsx scripts/research.ts hashtags <topic>\n');
        process.exit(1);
      }
      await cmdHashtags(topic);
      break;
    }
    case 'audience':
      await cmdAudience();
      break;
    case 'swipe':
      await cmdSwipe();
      break;
    case 'swipe-remix': {
      const id = args[1];
      if (!id) {
        console.error('\n  Usage: npx tsx scripts/research.ts swipe-remix <id>\n');
        process.exit(1);
      }
      await cmdSwipeRemix(id);
      break;
    }
    case 'viral':
      await cmdViral();
      break;
    default:
      console.log(`
  ${BOLD}PULSE Research CLI${RESET}

  Commands:
    trending               Trending topics in your niche
    hashtags <topic>        Suggest hashtags for a topic
    audience               Analyze your audience from CRM data
    swipe                  Build/update swipe file from best content
    swipe-remix <id>       Generate new variation from swipe entry
    viral                  Find viral content in your niche to model
`);
      break;
  }
}

main().catch((err) => {
  console.error('Research error:', err.message || err);
  process.exit(1);
});
