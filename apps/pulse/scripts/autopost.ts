/**
 * Auto-Post CLI for PULSE.
 * Usage:
 *   npx tsx scripts/autopost.ts generate          Generate content candidates
 *   npx tsx scripts/autopost.ts generate --category=news  Generate for specific category
 *   npx tsx scripts/autopost.ts review             Review pending posts
 *   npx tsx scripts/autopost.ts publish             Publish approved posts
 *   npx tsx scripts/autopost.ts history             Show post history with engagement
 *   npx tsx scripts/autopost.ts history --top       Top performers only
 *   npx tsx scripts/autopost.ts stats               Weekly engagement stats
 *   npx tsx scripts/autopost.ts pause [--hours=24]  Pause auto-posting
 *   npx tsx scripts/autopost.ts resume              Resume auto-posting
 *   npx tsx scripts/autopost.ts voice-check "text"  Score text against voice profile
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'autopost')) process.exit(0);

import readline from 'readline';
import {
  runAutopost,
  getAutopostQueue,
  approveAutopost,
  rejectAutopost,
  editAutopost,
  publishApproved,
  getAutopostStats,
  pauseAutopost,
  resumeAutopost,
  type AutopostEntry,
} from '../src/modes/autopost.js';
import {
  getInsights,
  generateWeeklyDigest,
} from '../src/intelligence/learning-engine.js';
import { buildVoiceBlock } from '../src/intelligence/human-behavior.js';
import { askLLM } from '../src/core/llm.js';
import { loadState, saveState } from '../src/core/state.js';

// ─── Formatting Helpers ─────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

const CATEGORY_LABELS: Record<string, string> = {
  news_commentary: `${CYAN}NEWS${RESET}`,
  product_tips: `${GREEN}TIPS${RESET}`,
  industry_insights: `${MAGENTA}INSIGHTS${RESET}`,
  engagement: `${YELLOW}ENGAGE${RESET}`,
  curated_reshares: `${DIM}RESHARE${RESET}`,
  milestones: `${BOLD}MILESTONE${RESET}`,
};

function categoryBadge(category: string): string {
  return CATEGORY_LABELS[category] || category.toUpperCase();
}

function statusBadge(status: string): string {
  switch (status) {
    case 'pending':   return `${YELLOW}PENDING${RESET}`;
    case 'approved':  return `${CYAN}APPROVED${RESET}`;
    case 'rejected':  return `${RED}REJECTED${RESET}`;
    case 'posted':    return `${GREEN}POSTED \u2713${RESET}`;
    case 'expired':   return `${DIM}EXPIRED${RESET}`;
    default:          return status.toUpperCase();
  }
}

function voiceColor(score: number): string {
  if (score >= 90) return `${GREEN}${score}${RESET}`;
  if (score >= 70) return `${YELLOW}${score}${RESET}`;
  return `${RED}${score}${RESET}`;
}

function engagementColor(value: number, avg: number): string {
  if (value >= avg) return `${GREEN}${value}${RESET}`;
  return `${RED}${value}${RESET}`;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 3) + '...';
}

function riskDisplay(flags: string[]): string {
  if (flags.length === 0) return '';
  return `  ${RED}Risk: ${flags.join(', ')}${RESET}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins} ${ampm}`;
}

function parseFlag(args: string[], name: string): string | null {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) {
      return arg.slice(`--${name}=`.length);
    }
  }
  return null;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdGenerate(args: string[]): Promise<void> {
  const category = parseFlag(args, 'category') ?? undefined;
  const force = hasFlag(args, 'force');

  if (category) {
    const valid = ['news_commentary', 'product_tips', 'industry_insights', 'engagement', 'curated_reshares', 'milestones'];
    // Allow short aliases
    const aliases: Record<string, string> = {
      news: 'news_commentary',
      tips: 'product_tips',
      insights: 'industry_insights',
      engage: 'engagement',
      reshares: 'curated_reshares',
      milestone: 'milestones',
    };
    const resolved = aliases[category] ?? category;
    if (!valid.includes(resolved)) {
      console.log(`\n  Invalid category: ${category}`);
      console.log(`  Valid: ${valid.join(', ')}\n`);
      return;
    }
    console.log(`\n  Generating content for category: ${categoryBadge(resolved)}...${force ? ' (force)' : ''}\n`);
    const result = await runAutopost({ category: resolved, force });
    showGenerateResult(result);
  } else {
    console.log(`\n  Generating content candidates...${force ? ' (force)' : ''}\n`);
    const result = await runAutopost({ force });
    showGenerateResult(result);
  }
}

function showGenerateResult(result: { generated: number; queued: number; published: number; category: string; platform: string; entryId: string | null }): void {
  console.log('');
  console.log('  ' + '\u2550'.repeat(42));
  console.log(`  ${BOLD}Generation Results${RESET}`);
  console.log('  ' + '\u2550'.repeat(42));
  console.log(`  Category:  ${categoryBadge(result.category)}`);
  console.log(`  Platform:  ${result.platform || 'none'}`);
  console.log(`  Generated: ${result.generated}`);
  console.log(`  Queued:    ${result.queued > 0 ? `${CYAN}${result.queued}${RESET}` : '0'}`);
  console.log(`  Published: ${result.published > 0 ? `${GREEN}${result.published}${RESET}` : '0'}`);

  if (result.entryId) {
    console.log(`  Entry ID:  ${DIM}${result.entryId}${RESET}`);
  }

  if (result.queued > 0) {
    console.log(`\n  Run ${BOLD}npx tsx scripts/autopost.ts review${RESET} to approve.`);
  }

  console.log('');
}

async function cmdReview(): Promise<void> {
  const queue = getAutopostQueue();

  if (queue.length === 0) {
    console.log('\n  No pending posts to review.\n');
    console.log(`  Run ${BOLD}npx tsx scripts/autopost.ts generate${RESET} to create content.\n`);
    return;
  }

  // Show streak status
  const stats = getAutopostStats();
  const streakTarget = 20;
  console.log(`\n  Approval streak: ${BOLD}${stats.streakCount}/${streakTarget}${RESET}${stats.streakCount >= streakTarget ? ` ${GREEN}(auto-approve unlocked)${RESET}` : ''}`);

  console.log(`  ${queue.length} pending post(s) to review.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  let approvedCount = 0;
  let rejectedCount = 0;
  let editedCount = 0;
  let skippedCount = 0;
  let deferredCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];

    console.log('  ' + '\u2500'.repeat(50));
    console.log(`  ${BOLD}#${i + 1}/${queue.length}${RESET}  [${categoryBadge(entry.category)}]  ${DIM}${entry.format}${RESET}`);
    console.log(`  Platform: ${entry.platform}  |  Voice: ${voiceColor(entry.voiceScore)}`);
    console.log(`  Created: ${formatDate(entry.createdAt)} ${formatTime(entry.createdAt)}`);

    if (entry.riskFlags.length > 0) {
      console.log(riskDisplay(entry.riskFlags));
    }

    console.log('');
    console.log(`  ${DIM}"${entry.content}"${RESET}`);
    console.log('');

    const answer = await ask(`  [a]pprove  [e]dit  [r]eject  [s]kip  [d]efer (6h) > `);
    const choice = answer.trim().toLowerCase();

    switch (choice) {
      case 'a':
      case 'approve': {
        approveAutopost(entry.id);
        approvedCount++;
        console.log(`  ${GREEN}\u2713 Approved${RESET}\n`);
        break;
      }
      case 'e':
      case 'edit': {
        console.log(`\n  Current content:\n`);
        console.log(`  ${DIM}${entry.content}${RESET}\n`);
        console.log('  Enter new content (press Enter twice to finish, Ctrl+C to cancel):\n');

        const lines: string[] = [];
        let emptyCount = 0;

        const edited = await new Promise<string>((resolve) => {
          const lineHandler = (line: string) => {
            if (line === '') {
              emptyCount++;
              if (emptyCount >= 2) {
                rl.removeListener('line', lineHandler);
                resolve(lines.join('\n').trim());
                return;
              }
            } else {
              if (emptyCount === 1) lines.push('');
              emptyCount = 0;
            }
            lines.push(line);
          };
          rl.on('line', lineHandler);
        });

        if (edited) {
          editAutopost(entry.id, edited);
          approveAutopost(entry.id);
          editedCount++;
          console.log(`  ${CYAN}\u270E Edited + approved${RESET}\n`);
        } else {
          skippedCount++;
          console.log('  No changes made.\n');
        }
        break;
      }
      case 'r':
      case 'reject': {
        const reason = await ask('  Reason (optional): ');
        rejectAutopost(entry.id, reason.trim() || undefined);
        rejectedCount++;
        console.log(`  ${RED}\u2717 Rejected${RESET}\n`);
        break;
      }
      case 'd':
      case 'defer': {
        const deferUntil = new Date(Date.now() + 6 * 3600_000).toISOString();
        const deferQueue = loadState<any[]>('autopost-queue', []);
        const deferItem = deferQueue.find((e: any) => e.id === entry.id);
        if (deferItem) {
          deferItem.deferredUntil = deferUntil;
          saveState('autopost-queue', deferQueue);
        }
        deferredCount++;
        console.log(`  ${YELLOW}\u23F1 Deferred — will reappear after ${new Date(deferUntil).toLocaleTimeString()}${RESET}\n`);
        break;
      }
      case 's':
      case 'skip':
      default: {
        skippedCount++;
        console.log(`  ${DIM}Skipped${RESET}\n`);
        break;
      }
    }
  }

  rl.close();

  const parts: string[] = [];
  if (approvedCount > 0) parts.push(`${GREEN}${approvedCount} approved${RESET}`);
  if (editedCount > 0) parts.push(`${CYAN}${editedCount} edited+approved${RESET}`);
  if (rejectedCount > 0) parts.push(`${RED}${rejectedCount} rejected${RESET}`);
  if (deferredCount > 0) parts.push(`${YELLOW}${deferredCount} deferred${RESET}`);
  if (skippedCount > 0) parts.push(`${DIM}${skippedCount} skipped${RESET}`);
  console.log(`  Review complete: ${parts.join(', ')}.\n`);
}

async function cmdPublish(args: string[]): Promise<void> {
  const force = hasFlag(args, 'force');
  console.log(`\n  Publishing approved posts...${force ? ' (force)' : ''}\n`);
  const result = await publishApproved({ force });

  console.log('');
  console.log('  ' + '\u2550'.repeat(42));
  console.log(`  ${BOLD}Publish Results${RESET}`);
  console.log('  ' + '\u2550'.repeat(42));

  if (result.published === 0 && result.failed === 0) {
    console.log('  No approved posts to publish.');
    console.log(`  Run ${BOLD}npx tsx scripts/autopost.ts review${RESET} to approve posts first.\n`);
    return;
  }

  console.log(`  ${GREEN}\u2713 Published: ${result.published}${RESET}`);

  if (result.failed > 0) {
    console.log(`  ${RED}\u2717 Failed:    ${result.failed}${RESET}`);
  }

  console.log('');
}

function cmdHistory(args: string[]): void {
  const stats = getAutopostStats();
  const topOnly = hasFlag(args, 'top');

  // Get posted entries from autopost state which holds history
  const autopostState = loadState('autopost', {
    postHistory: [],
    streakCount: 0,
    dailyCounts: {},
    recentCategories: [],
    pausedUntil: null,
    categoryWeights: {},
  });
  const queue = loadState('autopost-queue', []) as AutopostEntry[];

  // Combine all entries
  const allEntries: AutopostEntry[] = [
    ...autopostState.postHistory,
    ...queue.filter((e: AutopostEntry) => e.status === 'posted'),
  ];

  // Deduplicate by id
  const seen = new Set<string>();
  const entries = allEntries.filter((e: AutopostEntry) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // Filter to posted only
  let posted = entries.filter((e: AutopostEntry) => e.status === 'posted');

  if (posted.length === 0) {
    console.log('\n  No post history yet.\n');
    console.log(`  Run ${BOLD}npx tsx scripts/autopost.ts generate${RESET} and ${BOLD}publish${RESET} first.\n`);
    return;
  }

  // Compute engagement score
  function engScore(e: AutopostEntry): number {
    if (!e.engagement) return 0;
    return (e.engagement.likes ?? 0) + (e.engagement.replies ?? 0) * 3 + (e.engagement.reposts ?? 0) * 2;
  }

  // Calculate average engagement
  const avgEng = posted.reduce((sum, e) => sum + engScore(e), 0) / posted.length;

  if (topOnly) {
    posted = posted.sort((a, b) => engScore(b) - engScore(a)).slice(0, 10);
    console.log(`\n  ${BOLD}TOP 10 POSTS${RESET} (by engagement score)\n`);
  } else {
    posted = posted.sort((a, b) =>
      new Date(b.postedAt ?? b.createdAt).getTime() - new Date(a.postedAt ?? a.createdAt).getTime()
    ).slice(0, 20);
    console.log(`\n  ${BOLD}POST HISTORY${RESET} (last 20)\n`);
  }

  console.log('  ' + '\u2550'.repeat(60));

  for (const entry of posted) {
    const date = entry.postedAt ?? entry.createdAt;
    const eng = entry.engagement;
    const score = engScore(entry);
    const preview = truncate(entry.content, 55);

    console.log(`\n  ${formatDate(date)} ${formatTime(date)}  [${categoryBadge(entry.category)}]  ${entry.platform}`);
    console.log(`  ${DIM}"${preview}"${RESET}`);

    if (eng) {
      const likeStr = engagementColor(eng.likes, avgEng / 3);
      const replyStr = engagementColor(eng.replies, avgEng / 6);
      const repostStr = engagementColor(eng.reposts, avgEng / 4);
      console.log(`  Likes: ${likeStr}  Replies: ${replyStr}  Reposts: ${repostStr}  Score: ${engagementColor(score, avgEng)}`);
    } else {
      console.log(`  ${DIM}No engagement data yet${RESET}`);
    }
  }

  console.log('\n  ' + '\u2550'.repeat(60));
  console.log(`  Total posts: ${entries.filter((e: AutopostEntry) => e.status === 'posted').length}  |  Avg engagement: ${Math.round(avgEng)}`);
  console.log('');
}

async function cmdStats(): Promise<void> {
  const stats = getAutopostStats();
  const insights = getInsights();
  const digest = await generateWeeklyDigest();

  console.log('');
  console.log('  ' + '\u2550'.repeat(50));
  console.log(`  ${BOLD}WEEKLY AUTOPOST STATS${RESET}`);
  console.log('  ' + '\u2550'.repeat(50));

  // Overview
  console.log(`\n  ${BOLD}Overview${RESET}`);
  console.log('  ' + '-'.repeat(30));
  console.log(`  Total posts:     ${stats.totalPosts}`);
  console.log(`  Today:           ${stats.todayCount}/${stats.dailyLimit}`);
  console.log(`  Queue depth:     ${stats.queueDepth > 0 ? `${YELLOW}${stats.queueDepth}${RESET}` : '0'}`);
  console.log(`  Approval streak: ${BOLD}${stats.streakCount}${RESET}`);
  console.log(`  Avg voice score: ${voiceColor(stats.avgVoiceScore)}`);

  // Weekly digest
  if (digest.totalPosts > 0) {
    console.log(`\n  ${BOLD}This Week${RESET}`);
    console.log('  ' + '-'.repeat(30));
    console.log(`  Posts:          ${digest.totalPosts}`);
    console.log(`  Avg engagement: ${digest.avgEngagement}`);
    if (digest.topPost) {
      console.log(`  Top post:       ${DIM}"${truncate(digest.topPost.content, 45)}"${RESET}`);
      console.log(`                  Score: ${GREEN}${digest.topPost.engagementScore}${RESET}`);
    }
  }

  // By category
  if (Object.keys(stats.byCategory).length > 0) {
    console.log(`\n  ${BOLD}By Category${RESET}`);
    console.log('  ' + '-'.repeat(30));
    const sorted = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
      const catInsight = insights.topCategories.find((c) => c.category === cat);
      const avgStr = catInsight ? `  avg: ${catInsight.avgScore}` : '';
      console.log(`  ${categoryBadge(cat).padEnd(30)} ${count} posts${avgStr}`);
    }
  }

  // By platform
  if (Object.keys(stats.byPlatform).length > 0) {
    console.log(`\n  ${BOLD}By Platform${RESET}`);
    console.log('  ' + '-'.repeat(30));
    for (const [plat, count] of Object.entries(stats.byPlatform).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${plat.padEnd(15)} ${count} posts`);
    }
  }

  // Top categories from learning engine
  if (insights.topCategories.length > 0) {
    console.log(`\n  ${BOLD}Top Categories by Engagement${RESET}`);
    console.log('  ' + '-'.repeat(30));
    for (const cat of insights.topCategories.slice(0, 5)) {
      const bar = '\u2588'.repeat(Math.round(cat.avgScore / 5));
      console.log(`  ${cat.category.padEnd(20)} ${bar} ${cat.avgScore} (${cat.count} samples)`);
    }
  }

  // Top formats
  if (insights.topFormats.length > 0) {
    console.log(`\n  ${BOLD}Top Formats by Engagement${RESET}`);
    console.log('  ' + '-'.repeat(30));
    for (const fmt of insights.topFormats.slice(0, 5)) {
      const bar = '\u2588'.repeat(Math.round(fmt.avgScore / 5));
      console.log(`  ${fmt.format.padEnd(20)} ${bar} ${fmt.avgScore} (${fmt.count} samples)`);
    }
  }

  // Best hours
  if (insights.bestHours.length > 0) {
    console.log(`\n  ${BOLD}Best Posting Hours (UTC)${RESET}`);
    console.log('  ' + '-'.repeat(30));
    for (const h of insights.bestHours.slice(0, 5)) {
      const hour12 = h.hour % 12 || 12;
      const ampm = h.hour >= 12 ? 'PM' : 'AM';
      console.log(`  ${hour12}:00 ${ampm}  avg: ${h.avgScore}`);
    }
  }

  // Recommendations
  if (digest.recommendations.length > 0) {
    console.log(`\n  ${BOLD}Recommendations${RESET}`);
    console.log('  ' + '-'.repeat(30));
    for (const rec of digest.recommendations) {
      console.log(`  \u2022 ${rec}`);
    }
  }

  // By status
  console.log(`\n  ${BOLD}Status Breakdown${RESET}`);
  console.log('  ' + '-'.repeat(30));
  for (const [status, count] of Object.entries(stats.byStatus)) {
    console.log(`  ${statusBadge(status).padEnd(25)} ${count}`);
  }

  console.log('');
}

function cmdPause(args: string[]): void {
  const hoursStr = parseFlag(args, 'hours');
  const hours = hoursStr ? parseInt(hoursStr, 10) : 24;

  if (isNaN(hours) || hours <= 0) {
    console.log('\n  Invalid hours value. Usage: --hours=24\n');
    return;
  }

  pauseAutopost(hours);

  const until = new Date(Date.now() + hours * 3600_000);
  console.log(`\n  ${YELLOW}\u23F8 Auto-posting paused${RESET}`);
  console.log(`  Resumes: ${formatDate(until.toISOString())} ${formatTime(until.toISOString())}`);
  console.log(`  Duration: ${hours} hour(s)`);
  console.log(`\n  Run ${BOLD}npx tsx scripts/autopost.ts resume${RESET} to resume early.\n`);
}

function cmdResume(): void {
  resumeAutopost();
  console.log(`\n  ${GREEN}\u25B6 Auto-posting resumed${RESET}\n`);
}

async function cmdVoiceCheck(args: string[]): Promise<void> {
  const text = args.join(' ').trim();

  if (!text) {
    console.log('\n  Usage: npx tsx scripts/autopost.ts voice-check "Your tweet text here"\n');
    return;
  }

  console.log(`\n  Checking voice alignment...\n`);

  const voiceBlock = buildVoiceBlock();

  const prompt = `You are a brand voice analyst. Given the voice profile and a candidate post,
score how well the text matches the brand voice on a scale of 0-100.

${voiceBlock}

TEXT TO EVALUATE:
"${text}"

Respond in this EXACT JSON format (no markdown, no code blocks):
{
  "score": 85,
  "analysis": "2-3 sentence analysis of voice alignment — what matches and what doesn't",
  "suggestions": ["specific suggestion 1", "specific suggestion 2"]
}`;

  const response = await askLLM(prompt, { maxTokens: 500, temperature: 0.3 });

  if (!response) {
    console.log(`  ${RED}LLM unavailable — cannot score voice alignment.${RESET}\n`);
    return;
  }

  try {
    const parsed = JSON.parse(response);
    const score = parsed.score ?? 0;
    const analysis = parsed.analysis ?? 'No analysis available.';
    const suggestions: string[] = parsed.suggestions ?? [];

    console.log('  ' + '\u2550'.repeat(50));
    console.log(`  ${BOLD}VOICE CHECK${RESET}`);
    console.log('  ' + '\u2550'.repeat(50));
    console.log(`\n  Text:  ${DIM}"${truncate(text, 60)}"${RESET}`);
    console.log(`  Score: ${voiceColor(score)}/100`);
    console.log(`\n  ${BOLD}Analysis${RESET}`);
    console.log(`  ${analysis}`);

    if (suggestions.length > 0) {
      console.log(`\n  ${BOLD}Suggestions${RESET}`);
      for (const s of suggestions) {
        console.log(`  \u2022 ${s}`);
      }
    }

    console.log('');
  } catch {
    console.log(`  ${RED}Failed to parse voice check response.${RESET}`);
    console.log(`  Raw: ${response.slice(0, 200)}\n`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'generate':
      await cmdGenerate(args.slice(1));
      break;
    case 'review':
      await cmdReview();
      break;
    case 'publish':
      await cmdPublish(args.slice(1));
      break;
    case 'history':
      cmdHistory(args.slice(1));
      break;
    case 'stats':
      await cmdStats();
      break;
    case 'pause':
      cmdPause(args.slice(1));
      break;
    case 'resume':
      cmdResume();
      break;
    case 'voice-check':
      await cmdVoiceCheck(args.slice(1));
      break;
    case 'outreach': {
      const auto = hasFlag(args.slice(1), 'auto');
      console.log(`\n  Running outreach${auto ? ' (AUTO MODE)' : ' (draft mode)'}...\n`);
      const { runOutreach } = await import('../src/modes/outreach.js');
      const result = await runOutreach({ dryRun: false, autoPost: auto });
      console.log(`\n  Outreach: ${result.repliedCount} replies, ${result.searchedCount} searches, ${result.candidatesFound} candidates`);
      if (result.drafts.length > 0) {
        console.log(`  ${result.drafts.length} draft(s) saved. Run npm start to review.`);
      }
      break;
    }
    default:
      console.log(`
  ${BOLD}PULSE Auto-Post CLI${RESET}

  Commands:
    generate [--category=TYPE]   Generate content candidates
    outreach                     Find conversations and draft replies
    outreach --auto              Auto-post replies (use with caution)
    review                       Review pending posts interactively
    publish                      Publish all approved posts
    history [--top]              Show post history with engagement
    stats                        Weekly engagement stats
    pause [--hours=N]            Pause auto-posting (default 24h)
    resume                       Resume auto-posting
    voice-check "text"           Score text against voice profile

  Categories:
    news_commentary | product_tips | industry_insights
    engagement | curated_reshares | milestones

  Shortcuts:
    news | tips | insights | engage | reshares | milestone
`);
      break;
  }
}

main().catch((err) => {
  console.error('Autopost error:', err.message || err);
  process.exit(1);
});
