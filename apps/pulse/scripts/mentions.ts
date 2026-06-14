/**
 * Mention Monitor CLI for PULSE.
 * Usage:
 *   npx tsx scripts/mentions.ts watch         Scan for new mentions now
 *   npx tsx scripts/mentions.ts review        Review pending mention replies
 *   npx tsx scripts/mentions.ts list          List recent mentions
 *   npx tsx scripts/mentions.ts stats         Show mention stats
 *   npx tsx scripts/mentions.ts block <user>  Add user to blocklist
 *   npx tsx scripts/mentions.ts unblock <user> Remove from blocklist
 *   npx tsx scripts/mentions.ts pause         Pause auto-replies
 *   npx tsx scripts/mentions.ts resume        Resume auto-replies
 *   npx tsx scripts/mentions.ts classify <id> Test classification on a mention
 */

import { config } from 'dotenv';
config();

import { showHelpIfNeeded } from '../src/core/help.js';
if (showHelpIfNeeded(process.argv.slice(2), 'mentions')) process.exit(0);

import readline from 'readline';
import {
  detectMentions,

  getPendingMentions,
  markMentionReplied,
  generateMentionReply,
  type DetectedMention,
  type MentionSentiment,
} from '../src/intelligence/mention-detector.js';
import { loadState, saveState } from '../src/core/state.js';
import { x } from '../src/platforms/x.js';
import type { Conversation } from '../src/platforms/base.js';
import { recordEdit } from '../src/intelligence/learning-engine.js';

// ─── Formatting Helpers ─────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function sentimentBadge(sentiment: MentionSentiment): string {
  switch (sentiment) {
    case 'positive': return `${GREEN}POSITIVE${RESET}`;
    case 'neutral':  return `${CYAN}NEUTRAL${RESET}`;
    case 'negative': return `${RED}NEGATIVE${RESET}`;
    case 'question': return `${YELLOW}QUESTION${RESET}`;
    case 'spam':     return `${DIM}SPAM${RESET}`;
    default:         return String(sentiment).toUpperCase();
  }
}

function sentimentColor(sentiment: MentionSentiment): string {
  switch (sentiment) {
    case 'positive': return GREEN;
    case 'neutral':  return CYAN;
    case 'negative': return RED;
    case 'question': return YELLOW;
    case 'spam':     return DIM;
    default:         return '';
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case 'pending':   return `${YELLOW}PENDING${RESET}`;
    case 'queued':    return `${CYAN}QUEUED${RESET}`;
    case 'replied':   return `${GREEN}REPLIED \u2713${RESET}`;
    case 'skipped':   return `${DIM}SKIPPED${RESET}`;
    case 'escalated': return `${RED}ESCALATED${RESET}`;
    default:          return status.toUpperCase();
  }
}

function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    x: 'X',
    reddit: 'Reddit',
    hackernews: 'HN',
    producthunt: 'PH',
    linkedin: 'LinkedIn',
    discord: 'Discord',
  };
  return labels[platform] || platform;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 3) + '...';
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

// ─── Blocklist State ────────────────────────────────────────────────────────

const BLOCKLIST_KEY = 'mention-blocklist';
const MENTION_CONFIG_KEY = 'mention-config';

interface MentionConfig {
  autoReplyPaused: boolean;
  pausedAt: string | null;
}

function loadBlocklist(): string[] {
  return loadState<string[]>(BLOCKLIST_KEY, []);
}

function saveBlocklist(list: string[]): void {
  saveState(BLOCKLIST_KEY, list);
}

function loadMentionConfig(): MentionConfig {
  return loadState<MentionConfig>(MENTION_CONFIG_KEY, {
    autoReplyPaused: false,
    pausedAt: null,
  });
}

function saveMentionConfig(cfg: MentionConfig): void {
  saveState(MENTION_CONFIG_KEY, cfg);
}

// ─── Mention State (read-only access for stats/list) ────────────────────────

interface MentionStateData {
  processedIds: string[];
  pendingReplies: DetectedMention[];
  dailyCounts: Record<string, number>;
  lastCheckAt: string;
}

function loadMentionState(): MentionStateData {
  return loadState<MentionStateData>('mentions', {
    processedIds: [],
    pendingReplies: [],
    dailyCounts: {},
    lastCheckAt: '',
  });
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function cmdWatch(): Promise<void> {
  const cfg = loadMentionConfig();
  if (cfg.autoReplyPaused) {
    console.log(`\n  ${YELLOW}Auto-replies are paused.${RESET} Scanning will detect mentions but not generate replies.`);
    console.log(`  Run ${BOLD}npx tsx scripts/mentions.ts resume${RESET} to re-enable.\n`);
  }

  console.log('\n  Scanning for new mentions...\n');
  const mentions = await detectMentions();

  if (mentions.length === 0) {
    console.log('  No new mentions found.\n');
    return;
  }

  console.log(`\n  Found ${BOLD}${mentions.length}${RESET} new mention(s):\n`);

  const blocklist = loadBlocklist();
  let escalationCount = 0;

  for (const mention of mentions) {
    const color = sentimentColor(mention.sentiment);
    const badge = sentimentBadge(mention.sentiment);
    const time = relativeTime(mention.detectedAt);
    const plat = platformLabel(mention.platform);

    // Check blocklist
    const blocked = blocklist.includes(mention.author.toLowerCase());
    if (blocked) {
      console.log(`  ${DIM}[BLOCKED] @${mention.author} on ${plat} -- skipped${RESET}`);
      continue;
    }

    console.log(`  ${color}\u2502${RESET} ${badge} on ${plat} -- ${time}`);
    console.log(`  ${color}\u2502${RESET} ${BOLD}@${mention.author}${RESET}`);
    console.log(`  ${color}\u2502${RESET} ${DIM}"${truncate(mention.text, 70)}"${RESET}`);

    // Check for escalation (negative mentions)
    if (mention.sentiment === 'negative') {
      escalationCount++;
      console.log(`  ${color}\u2502${RESET} ${RED}\u26A0 ESCALATION: Negative mention detected${RESET}`);
    }

    // Generate reply if not paused and not spam
    if (!cfg.autoReplyPaused && mention.sentiment !== 'spam' && mention.suggestedReply) {
      console.log(`  ${color}\u2502${RESET} Reply: ${truncate(mention.suggestedReply, 60)}`);
    }

    console.log(`  ${color}\u2502${RESET} ${DIM}${mention.url}${RESET}`);
    console.log('');
  }

  // Summary
  const byType: Record<string, number> = {};
  for (const m of mentions) {
    byType[m.sentiment] = (byType[m.sentiment] ?? 0) + 1;
  }

  console.log('  ' + '\u2500'.repeat(42));
  const parts: string[] = [];
  if (byType['positive'])  parts.push(`${GREEN}${byType['positive']} positive${RESET}`);
  if (byType['question'])  parts.push(`${YELLOW}${byType['question']} question${RESET}`);
  if (byType['neutral'])   parts.push(`${CYAN}${byType['neutral']} neutral${RESET}`);
  if (byType['negative'])  parts.push(`${RED}${byType['negative']} negative${RESET}`);
  if (byType['spam'])      parts.push(`${DIM}${byType['spam']} spam${RESET}`);
  console.log(`  ${parts.join(' / ')}`);

  if (escalationCount > 0) {
    console.log(`\n  ${RED}\u26A0 ${escalationCount} mention(s) need attention (negative sentiment)${RESET}`);
  }

  const pending = getPendingMentions();
  if (pending.length > 0) {
    console.log(`\n  ${pending.length} pending mention(s) awaiting review.`);
    console.log(`  Run ${BOLD}npx tsx scripts/mentions.ts review${RESET} to review replies.\n`);
  } else {
    console.log('');
  }
}

async function cmdReview(): Promise<void> {
  const pending = getPendingMentions();

  if (pending.length === 0) {
    console.log('\n  No pending mentions to review. Run `npx tsx scripts/mentions.ts watch` first.\n');
    return;
  }

  console.log('');
  console.log('\u2550'.repeat(42));
  console.log(`  ${BOLD}PULSE Mention Review${RESET}  (${pending.length} pending)`);
  console.log('\u2550'.repeat(42));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  let reviewed = 0;
  let approved = 0;
  let rejected = 0;

  for (const mention of pending) {
    // Generate reply if not yet generated
    if (!mention.suggestedReply) {
      console.log(`\n  Generating reply for mention ${mention.id}...`);
      const reply = await generateMentionReply(mention);
      if (!reply) {
        console.log(`  ${DIM}No reply generated (LLM declined). Skipping.${RESET}`);
        continue;
      }
      mention.suggestedReply = reply;
    }

    const badge = sentimentBadge(mention.sentiment);
    const plat = platformLabel(mention.platform);
    const time = relativeTime(mention.detectedAt);

    console.log(`\n  ${'\u2500'.repeat(42)}`);
    console.log(`  ${BOLD}#${mention.id}${RESET} [${badge}] ${plat} -- ${time}`);
    console.log(`  ${BOLD}@${mention.author}${RESET}`);
    console.log(`  ${DIM}"${truncate(mention.text, 80)}"${RESET}`);
    console.log(`  ${DIM}${mention.url}${RESET}`);
    console.log('');
    console.log(`  ${MAGENTA}Suggested reply:${RESET}`);
    console.log(`  ${mention.suggestedReply}`);
    console.log('');

    const action = await ask(`  [${GREEN}a${RESET}]pprove  [${CYAN}e${RESET}]dit  [${RED}r${RESET}]eject  [${DIM}s${RESET}]kip  > `);

    switch (action.trim().toLowerCase()) {
      case 'a':
      case 'approve': {
        const conversation: Conversation = {
          id: mention.id,
          platform: mention.platform,
          url: mention.url,
          text: mention.text,
          author: mention.author,
          topicId: '',
          createdAt: mention.detectedAt,
          engagement: { likes: 0, replies: 0, reposts: 0 },
        };
        const result = await x.reply(conversation, mention.suggestedReply!);
        if (!result.ok) {
          console.log(`  ${RED}\u2717 Failed to post reply: ${result.error}${RESET}`);
          break;
        }
        markMentionReplied(mention.id);
        approved++;
        console.log(`  ${GREEN}\u2713 Posted to X.${RESET}${result.url ? ` ${DIM}${result.url}${RESET}` : ''}`);
        break;
      }

      case 'e':
      case 'edit': {
        console.log(`\n  Enter new reply (press Enter twice to finish, Ctrl+C to cancel):\n`);
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
              lines.push(line);
            }
          };
          rl.on('line', lineHandler);
        });

        if (edited) {
          const conversation: Conversation = {
            id: mention.id,
            platform: mention.platform,
            url: mention.url,
            text: mention.text,
            author: mention.author,
            topicId: '',
            createdAt: mention.detectedAt,
            engagement: { likes: 0, replies: 0, reposts: 0 },
          };
          const result = await x.reply(conversation, edited);
          if (!result.ok) {
            console.log(`  ${RED}\u2717 Failed to post reply: ${result.error}${RESET}`);
            break;
          }
          // Update state after successful post
          const state = loadMentionState();
          const found = state.pendingReplies.find(m => m.id === mention.id);
          if (found) {
            found.suggestedReply = edited;
            found.status = 'replied';
            // Enforce caps before saving (match saveMentionState() logic)
            if (state.processedIds.length > 2000) state.processedIds = state.processedIds.slice(-2000);
            if (state.pendingReplies.length > 100) state.pendingReplies = state.pendingReplies.slice(-100);
            saveState('mentions', state);
          }
          recordEdit(mention.suggestedReply || '', edited, 'mention_reply');
          approved++;
          console.log(`  ${GREEN}\u2713 Edited and posted to X.${RESET}${result.url ? ` ${DIM}${result.url}${RESET}` : ''}`);
        } else {
          console.log('  No changes made.');
        }
        break;
      }

      case 'r':
      case 'reject': {
        const state = loadMentionState();
        const found = state.pendingReplies.find(m => m.id === mention.id);
        if (found) {
          found.status = 'skipped';
          // Enforce caps before saving (match saveMentionState() logic)
          if (state.processedIds.length > 2000) state.processedIds = state.processedIds.slice(-2000);
          if (state.pendingReplies.length > 100) state.pendingReplies = state.pendingReplies.slice(-100);
          saveState('mentions', state);
        }
        rejected++;
        console.log(`  ${RED}\u2717 Rejected.${RESET}`);
        break;
      }

      case 's':
      case 'skip':
        console.log(`  ${DIM}Skipped -- will appear again next review.${RESET}`);
        break;

      default:
        console.log(`  ${DIM}Unknown action -- skipping.${RESET}`);
        break;
    }

    reviewed++;
  }

  rl.close();

  console.log(`\n  ${'\u2500'.repeat(42)}`);
  console.log(`  Review complete: ${reviewed} reviewed, ${GREEN}${approved} approved${RESET}, ${RED}${rejected} rejected${RESET}`);
  console.log('');
}

function cmdList(): void {
  const state = loadMentionState();
  const mentions = state.pendingReplies;

  if (mentions.length === 0) {
    console.log('\n  No mentions tracked. Run `npx tsx scripts/mentions.ts watch` first.\n');
    return;
  }

  console.log('');
  console.log('\u2550'.repeat(50));
  console.log(`  ${BOLD}PULSE Mention Monitor${RESET}  (${mentions.length} total)`);
  console.log('\u2550'.repeat(50));

  // Group by day
  const byDay = new Map<string, DetectedMention[]>();
  for (const m of mentions) {
    const dayKey = m.detectedAt.slice(0, 10);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push(m);
  }

  // Sort days descending (newest first)
  const sortedDays = [...byDay.keys()].sort((a, b) => b.localeCompare(a));

  for (const dayKey of sortedDays) {
    const dayMentions = byDay.get(dayKey)!;
    const d = new Date(dayKey + 'T00:00:00Z');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayLabel = `${dayNames[d.getUTCDay()]}, ${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}`;

    console.log(`\n  ${BOLD}${dayLabel}${RESET}  (${dayMentions.length})`);

    for (const mention of dayMentions) {
      const badge = sentimentBadge(mention.sentiment);
      const status = statusBadge(mention.status);
      const plat = platformLabel(mention.platform);
      const time = relativeTime(mention.detectedAt);
      const preview = truncate(mention.text, 50);

      console.log(`\n  ${mention.id.slice(0, 8)} [${badge}] [${status}] ${plat} -- ${time}`);
      console.log(`  ${BOLD}@${mention.author}${RESET}`);
      console.log(`  ${DIM}"${preview}"${RESET}`);

      if (mention.suggestedReply) {
        console.log(`  ${MAGENTA}\u2192${RESET} ${truncate(mention.suggestedReply, 55)}`);
      }
    }
  }

  console.log('');
}

function cmdStats(): void {
  const state = loadMentionState();
  const mentions = state.pendingReplies;
  const cfg = loadMentionConfig();

  // Count by status
  const byStatus: Record<string, number> = {};
  const bySentiment: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};

  for (const m of mentions) {
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    bySentiment[m.sentiment] = (bySentiment[m.sentiment] ?? 0) + 1;
    byPlatform[m.platform] = (byPlatform[m.platform] ?? 0) + 1;
  }

  const total = mentions.length;
  const replied = byStatus['replied'] ?? 0;
  const pending = (byStatus['pending'] ?? 0) + (byStatus['queued'] ?? 0);
  const skipped = byStatus['skipped'] ?? 0;
  const responseRate = total > 0 ? Math.round((replied / total) * 100) : 0;

  // Today's count
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = state.dailyCounts[today] ?? 0;

  console.log('');
  console.log('\u2550'.repeat(42));
  console.log(`  ${BOLD}PULSE Mention Stats${RESET}`);
  console.log('\u2550'.repeat(42));
  console.log('');

  // Auto-reply status
  if (cfg.autoReplyPaused) {
    console.log(`  Auto-reply:  ${RED}PAUSED${RESET}${cfg.pausedAt ? ` (since ${relativeTime(cfg.pausedAt)})` : ''}`);
  } else {
    console.log(`  Auto-reply:  ${GREEN}ACTIVE${RESET}`);
  }

  console.log('');
  console.log(`  ${BOLD}Overview${RESET}`);
  console.log('  ' + '\u2500'.repeat(30));
  console.log(`  Total detected:  ${total}`);
  console.log(`  Today's replies: ${todayCount}`);
  console.log(`  Processed IDs:   ${state.processedIds.length}`);
  console.log(`  Last check:      ${state.lastCheckAt ? relativeTime(state.lastCheckAt) : 'never'}`);
  console.log('');

  console.log(`  ${BOLD}By Status${RESET}`);
  console.log('  ' + '\u2500'.repeat(30));
  console.log(`  Pending:    ${YELLOW}${pending}${RESET}`);
  console.log(`  Replied:    ${GREEN}${replied}${RESET}`);
  console.log(`  Skipped:    ${DIM}${skipped}${RESET}`);
  console.log(`  Response:   ${responseRate}%`);
  console.log('');

  console.log(`  ${BOLD}By Sentiment${RESET}`);
  console.log('  ' + '\u2500'.repeat(30));
  if (bySentiment['positive'])  console.log(`  Positive:   ${GREEN}${bySentiment['positive']}${RESET}`);
  if (bySentiment['neutral'])   console.log(`  Neutral:    ${CYAN}${bySentiment['neutral']}${RESET}`);
  if (bySentiment['negative'])  console.log(`  Negative:   ${RED}${bySentiment['negative']}${RESET}`);
  if (bySentiment['question'])  console.log(`  Question:   ${YELLOW}${bySentiment['question']}${RESET}`);
  if (bySentiment['spam'])      console.log(`  Spam:       ${DIM}${bySentiment['spam']}${RESET}`);
  if (Object.keys(bySentiment).length === 0) console.log(`  ${DIM}No data yet${RESET}`);
  console.log('');

  console.log(`  ${BOLD}By Platform${RESET}`);
  console.log('  ' + '\u2500'.repeat(30));
  for (const [plat, count] of Object.entries(byPlatform).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${platformLabel(plat).padEnd(12)} ${count}`);
  }
  if (Object.keys(byPlatform).length === 0) console.log(`  ${DIM}No data yet${RESET}`);
  console.log('');

  // Daily counts (last 7 days)
  const days = Object.entries(state.dailyCounts).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  if (days.length > 0) {
    console.log(`  ${BOLD}Daily Replies (last 7 days)${RESET}`);
    console.log('  ' + '\u2500'.repeat(30));
    for (const [date, count] of days) {
      const bar = '\u2588'.repeat(Math.min(count, 20));
      console.log(`  ${date}  ${CYAN}${bar}${RESET} ${count}`);
    }
    console.log('');
  }

  // Blocklist
  const blocklist = loadBlocklist();
  if (blocklist.length > 0) {
    console.log(`  ${BOLD}Blocklist${RESET}: ${blocklist.length} user(s)`);
    console.log('');
  }
}

function cmdBlock(args: string[]): void {
  const username = args[0];
  if (!username) {
    console.log('\n  Usage: npx tsx scripts/mentions.ts block <username>\n');
    return;
  }

  const normalized = username.replace(/^@/, '').toLowerCase();
  const blocklist = loadBlocklist();

  if (blocklist.includes(normalized)) {
    console.log(`\n  @${normalized} is already on the blocklist.\n`);
    return;
  }

  blocklist.push(normalized);
  saveBlocklist(blocklist);

  console.log(`\n  ${GREEN}\u2713${RESET} Added ${BOLD}@${normalized}${RESET} to blocklist.`);
  console.log(`  Mentions from this user will be auto-skipped.\n`);
}

function cmdUnblock(args: string[]): void {
  const username = args[0];
  if (!username) {
    console.log('\n  Usage: npx tsx scripts/mentions.ts unblock <username>\n');
    return;
  }

  const normalized = username.replace(/^@/, '').toLowerCase();
  const blocklist = loadBlocklist();
  const idx = blocklist.indexOf(normalized);

  if (idx === -1) {
    console.log(`\n  @${normalized} is not on the blocklist.\n`);
    return;
  }

  blocklist.splice(idx, 1);
  saveBlocklist(blocklist);

  console.log(`\n  ${GREEN}\u2713${RESET} Removed ${BOLD}@${normalized}${RESET} from blocklist.\n`);
}

function cmdPause(): void {
  const cfg = loadMentionConfig();

  if (cfg.autoReplyPaused) {
    console.log(`\n  Auto-replies are already paused${cfg.pausedAt ? ` (since ${relativeTime(cfg.pausedAt)})` : ''}.`);
    console.log(`  Run ${BOLD}npx tsx scripts/mentions.ts resume${RESET} to re-enable.\n`);
    return;
  }

  cfg.autoReplyPaused = true;
  cfg.pausedAt = new Date().toISOString();
  saveMentionConfig(cfg);

  console.log(`\n  ${YELLOW}\u23F8 Auto-replies paused.${RESET}`);
  console.log(`  Mentions will still be detected but no replies will be generated.`);
  console.log(`  Run ${BOLD}npx tsx scripts/mentions.ts resume${RESET} to re-enable.\n`);
}

function cmdResume(): void {
  const cfg = loadMentionConfig();

  if (!cfg.autoReplyPaused) {
    console.log(`\n  Auto-replies are already active.\n`);
    return;
  }

  const wasPaused = cfg.pausedAt ? relativeTime(cfg.pausedAt) : 'unknown';
  cfg.autoReplyPaused = false;
  cfg.pausedAt = null;
  saveMentionConfig(cfg);

  console.log(`\n  ${GREEN}\u25B6 Auto-replies resumed.${RESET} (was paused ${wasPaused})`);
  console.log(`  New mention scans will generate and queue replies.\n`);
}

async function cmdClassify(args: string[]): Promise<void> {
  const targetId = args[0];
  if (!targetId) {
    console.log('\n  Usage: npx tsx scripts/mentions.ts classify <id>\n');
    return;
  }

  const state = loadMentionState();
  const mention = state.pendingReplies.find(m => m.id === targetId || m.id.startsWith(targetId));

  if (!mention) {
    console.log(`\n  Mention "${targetId}" not found.`);
    console.log(`  Run ${BOLD}npx tsx scripts/mentions.ts list${RESET} to see available mentions.\n`);
    return;
  }

  console.log('');
  console.log('\u2550'.repeat(42));
  console.log(`  ${BOLD}Mention Classification${RESET}`);
  console.log('\u2550'.repeat(42));
  console.log('');
  console.log(`  ID:         ${BOLD}${mention.id}${RESET}`);
  console.log(`  Platform:   ${platformLabel(mention.platform)}`);
  console.log(`  Author:     ${BOLD}@${mention.author}${RESET}`);
  console.log(`  Detected:   ${relativeTime(mention.detectedAt)}`);
  console.log(`  Status:     ${statusBadge(mention.status)}`);
  console.log(`  URL:        ${DIM}${mention.url}${RESET}`);
  console.log('');
  console.log(`  ${BOLD}Text:${RESET}`);
  console.log(`  ${DIM}"${mention.text}"${RESET}`);
  console.log('');
  console.log(`  ${BOLD}Classification:${RESET}`);
  console.log(`  Sentiment:  ${sentimentBadge(mention.sentiment)}`);
  const replyDueMs = new Date(mention.replyAfter).getTime() - Date.now();
  console.log(`  Reply due:  ${replyDueMs > 0 ? `in ${Math.ceil(replyDueMs / 60000)}m` : `${GREEN}ready${RESET}`}`);
  console.log('');

  if (mention.suggestedReply) {
    console.log(`  ${BOLD}Suggested Reply:${RESET}`);
    console.log(`  ${mention.suggestedReply}`);
  } else {
    console.log(`  ${DIM}No reply generated yet.${RESET}`);

    // Offer to generate one
    console.log(`\n  Generating test reply...\n`);
    const reply = await generateMentionReply(mention);
    if (reply) {
      console.log(`  ${BOLD}Generated Reply:${RESET}`);
      console.log(`  ${reply}`);
    } else {
      console.log(`  ${DIM}LLM declined to generate a reply for this mention.${RESET}`);
    }
  }

  console.log('');
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'watch':
      await cmdWatch();
      break;
    case 'review':
      await cmdReview();
      break;
    case 'list':
      cmdList();
      break;
    case 'stats':
      cmdStats();
      break;
    case 'block':
      cmdBlock(args.slice(1));
      break;
    case 'unblock':
      cmdUnblock(args.slice(1));
      break;
    case 'pause':
      cmdPause();
      break;
    case 'resume':
      cmdResume();
      break;
    case 'classify':
      await cmdClassify(args.slice(1));
      break;
    default:
      console.log(`
  ${BOLD}PULSE Mention Monitor CLI${RESET}

  Commands:
    watch              Scan for new mentions now
    review             Review pending mention replies
    list               List recent mentions
    stats              Show mention stats
    block <user>       Add user to blocklist
    unblock <user>     Remove from blocklist
    pause              Pause auto-replies
    resume             Resume auto-replies
    classify <id>      Test classification on a mention
`);
      break;
  }
}

main().catch((err) => {
  console.error('Mention monitor error:', err.message || err);
  process.exit(1);
});
